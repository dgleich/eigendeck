//! Native macOS NSToolbar for the main window (unified titlebar material),
//! laid out to mirror the HTML toolbar: Add Slide / Add Build / Save on the
//! left, a centered filename, then Export / Present on the right. The window's
//! own title is hidden so the three zones lay out cleanly (flexible spaces on
//! both sides of the centered item). Button items post a Rust→JS
//! `toolbar:action` event; the frontend runs the same action as the HTML button.
//!
//! SPIKE — behind the `mac-toolbar` cargo feature (off by default). Authored
//! without a macOS compiler, so a Mac build pass is expected. Build + iterate
//! with `bash tools/mac-build.sh --toolbar`. See docs/mac-smoke.md §B.
//!
//! TODO (approach A, next): make the centered item nested (filename + editable
//! presentation title) with a custom drag source, and add Author/Venue fields.

use std::cell::RefCell;

use objc2::rc::Retained;
use objc2::runtime::ProtocolObject;
use objc2::{define_class, msg_send, sel, DefinedClass, MainThreadMarker, MainThreadOnly};
use objc2_app_kit::{
    NSImage, NSTextField, NSToolbar, NSToolbarDelegate, NSToolbarItem, NSView, NSWindow,
    NSWindowTitleVisibility, NSWindowToolbarStyle,
};
use objc2_foundation::{NSArray, NSObjectProtocol, NSString};
use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager};

const TITLE_ID: &str = "title";
const FLEX_ID: &str = "NSToolbarFlexibleSpaceItem";

#[derive(Clone, Serialize)]
struct ToolbarPayload {
    id: String,
}

/// (identifier, visible label, SF Symbol name) per BUTTON item.
const ITEMS: &[(&str, &str, &str)] = &[
    ("add-slide", "Add Slide", "plus.rectangle"),
    ("add-build", "Add Build", "plus.square.on.square"),
    ("save", "Save", "square.and.arrow.down"),
    ("export", "Export", "square.and.arrow.up"),
    ("present", "Present", "play.fill"),
];

fn identifiers() -> Retained<NSArray<NSString>> {
    // left group | flex | centered filename | flex | right group.
    let order = [
        "add-slide", "add-build", "save",
        FLEX_ID, TITLE_ID, FLEX_ID,
        "export", "present",
    ];
    let ids: Vec<Retained<NSString>> = order.iter().map(|id| NSString::from_str(id)).collect();
    let refs: Vec<&NSString> = ids.iter().map(|r| &**r).collect();
    NSArray::from_slice(&refs)
}

fn meta_for(identifier: &NSString) -> Option<(&'static str, &'static str)> {
    let id = identifier.to_string();
    ITEMS
        .iter()
        .find(|(i, _, _)| *i == id)
        .map(|(_, label, sym)| (*label, *sym))
}

struct Ivars {
    app: AppHandle,
    /// The centered filename label, stored so set_document_title can update it.
    title_field: RefCell<Option<Retained<NSTextField>>>,
}

define_class!(
    #[unsafe(super(objc2::runtime::NSObject))]
    // NSToolbarDelegate requires the delegate class to be main-thread-only.
    #[thread_kind = MainThreadOnly]
    #[name = "EigendeckToolbarDelegate"]
    #[ivars = Ivars]
    struct ToolbarDelegate;

    unsafe impl NSObjectProtocol for ToolbarDelegate {}

    unsafe impl NSToolbarDelegate for ToolbarDelegate {
        // Object (`Retained<T>`) returns use method_id, not method.
        #[unsafe(method_id(toolbarDefaultItemIdentifiers:))]
        fn default_ids(&self, _toolbar: &NSToolbar) -> Retained<NSArray<NSString>> {
            identifiers()
        }

        #[unsafe(method_id(toolbarAllowedItemIdentifiers:))]
        fn allowed_ids(&self, _toolbar: &NSToolbar) -> Retained<NSArray<NSString>> {
            identifiers()
        }

        #[unsafe(method_id(toolbar:itemForItemIdentifier:willBeInsertedIntoToolbar:))]
        fn item_for(
            &self,
            _toolbar: &NSToolbar,
            identifier: &NSString,
            _will_insert: bool,
        ) -> Option<Retained<NSToolbarItem>> {
            // NOTE: method_id's raw return is RetainedReturnValue, so no early
            // `return` — the whole body is one tail expression yielding Option.
            let mtm = self.mtm();
            let id = identifier.to_string();
            if id == TITLE_ID {
                // Centered filename label. Starts empty; set_document_title fills it.
                let item = unsafe {
                    NSToolbarItem::initWithItemIdentifier(NSToolbarItem::alloc(mtm), identifier)
                };
                let field = unsafe { NSTextField::labelWithString(&NSString::from_str(""), mtm) };
                *self.ivars().title_field.borrow_mut() = Some(field.clone());
                let view: &NSView = &field;
                unsafe { item.setView(Some(view)) };
                Some(item)
            } else {
                match meta_for(identifier) {
                    None => None, // built-in identifiers (flexible space) are system-provided
                    Some((label, symbol)) => {
                        let item = unsafe {
                            NSToolbarItem::initWithItemIdentifier(
                                NSToolbarItem::alloc(mtm),
                                identifier,
                            )
                        };
                        let ns_label = NSString::from_str(label);
                        unsafe {
                            item.setLabel(&ns_label);
                            item.setPaletteLabel(&ns_label);
                            if let Some(image) =
                                NSImage::imageWithSystemSymbolName_accessibilityDescription(
                                    &NSString::from_str(symbol),
                                    Some(&ns_label),
                                )
                            {
                                item.setImage(Some(&image));
                            }
                            let target: &objc2::runtime::AnyObject = self;
                            item.setTarget(Some(target));
                            item.setAction(Some(sel!(onItem:)));
                        }
                        Some(item)
                    }
                }
            }
        }
    }

    impl ToolbarDelegate {
        #[unsafe(method(onItem:))]
        fn on_item(&self, sender: &NSToolbarItem) {
            let id = sender.itemIdentifier().to_string();
            let _ = self.ivars().app.emit("toolbar:action", ToolbarPayload { id });
        }
    }
);

impl ToolbarDelegate {
    fn new(mtm: MainThreadMarker, app: AppHandle) -> Retained<Self> {
        let this = Self::alloc(mtm).set_ivars(Ivars {
            app,
            title_field: RefCell::new(None),
        });
        unsafe { msg_send![super(this), init] }
    }
}

// The delegate is MainThreadOnly (so !Send/!Sync — can't be a Sync static). Keep
// it in a main-thread thread-local: this both keeps it alive (NSToolbar's
// delegate ref is weak) AND lets set_document_title reach its title field.
thread_local! {
    static DELEGATE: RefCell<Option<Retained<ToolbarDelegate>>> = const { RefCell::new(None) };
}

/// Update the centered filename label. Called (on the main thread) from
/// set_window_document whenever the open file changes.
pub fn set_document_title(title: &str) {
    DELEGATE.with(|d| {
        if let Some(del) = d.borrow().as_ref() {
            if let Some(field) = del.ivars().title_field.borrow().as_ref() {
                unsafe { field.setStringValue(&NSString::from_str(title)) };
                field.sizeToFit();
            }
        }
    });
}

/// Install the native toolbar on the main window. Call from the Tauri setup hook.
pub fn install(app: &AppHandle) {
    let Some(mtm) = MainThreadMarker::new() else { return };
    let Some(window) = app.get_webview_window("main") else { return };
    let Ok(ns_win_ptr) = window.ns_window() else { return };
    // Safety: Tauri owns a valid NSWindow for "main" for its lifetime.
    let ns_win: &NSWindow = unsafe { &*(ns_win_ptr as *const NSWindow) };

    let delegate = ToolbarDelegate::new(mtm, app.clone());
    let toolbar = NSToolbar::initWithIdentifier(
        NSToolbar::alloc(mtm),
        &NSString::from_str("EigendeckMainToolbar"),
    );
    let proto: &ProtocolObject<dyn NSToolbarDelegate> = ProtocolObject::from_ref(&*delegate);
    toolbar.setDelegate(Some(proto));
    unsafe { toolbar.setCenteredItemIdentifier(Some(&NSString::from_str(TITLE_ID))) };
    ns_win.setToolbar(Some(&toolbar));
    ns_win.setToolbarStyle(NSWindowToolbarStyle::Unified);
    // Hide the window's own title so the three toolbar zones lay out cleanly.
    ns_win.setTitleVisibility(NSWindowTitleVisibility::Hidden);

    DELEGATE.with(|d| *d.borrow_mut() = Some(delegate));
}
