//! Native macOS NSToolbar for the main window (unified titlebar material),
//! mirroring the HTML toolbar: Add Slide / Add Build / Save on the left, a
//! centered filename, then Author / Venue / Export / Present on the right. The
//! window's own title is hidden so the three zones lay out cleanly.
//!
//! - BUTTON items post a Rust→JS `toolbar:action` event; the frontend runs the
//!   same action as the HTML button (dispatchToolbarAction).
//! - The Author/Venue TEXT FIELDS post `toolbar:field` {id,value} on edit; the
//!   frontend writes them to config. set_fields() pushes the current values back.
//!
//! SPIKE — behind the `mac-toolbar` cargo feature (off by default). Authored
//! without a macOS compiler; build + iterate with `mac-build.sh --toolbar`.
//!
//! TODO (approach A): nest the editable presentation title under the filename in
//! the centered item, with a custom drag source for the file.

use std::cell::RefCell;

use objc2::rc::Retained;
use objc2::runtime::ProtocolObject;
use objc2::{define_class, msg_send, sel, DefinedClass, MainThreadMarker, MainThreadOnly};
use objc2_app_kit::{
    NSImage, NSTextField, NSToolbar, NSToolbarDelegate, NSToolbarItem, NSView, NSWindow,
    NSWindowTitleVisibility, NSWindowToolbarStyle,
};
use objc2_foundation::{NSArray, NSObjectProtocol, NSSize, NSString};
use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager};

const TITLE_ID: &str = "title";
const AUTHOR_ID: &str = "author";
const VENUE_ID: &str = "venue";
const FLEX_ID: &str = "NSToolbarFlexibleSpaceItem";

#[derive(Clone, Serialize)]
struct ActionPayload {
    id: String,
}

#[derive(Clone, Serialize)]
struct FieldPayload {
    id: String,
    value: String,
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
        AUTHOR_ID, VENUE_ID, "export", "present",
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
    /// Text fields we push values into (set_fields) and read on edit.
    title_field: RefCell<Option<Retained<NSTextField>>>,
    author_field: RefCell<Option<Retained<NSTextField>>>,
    venue_field: RefCell<Option<Retained<NSTextField>>>,
}

define_class!(
    #[unsafe(super(objc2::runtime::NSObject))]
    #[thread_kind = MainThreadOnly]
    #[name = "EigendeckToolbarDelegate"]
    #[ivars = Ivars]
    struct ToolbarDelegate;

    unsafe impl NSObjectProtocol for ToolbarDelegate {}

    unsafe impl NSToolbarDelegate for ToolbarDelegate {
        #[unsafe(method_id(toolbarDefaultItemIdentifiers:))]
        fn default_ids(&self, _t: &NSToolbar) -> Retained<NSArray<NSString>> {
            identifiers()
        }

        #[unsafe(method_id(toolbarAllowedItemIdentifiers:))]
        fn allowed_ids(&self, _t: &NSToolbar) -> Retained<NSArray<NSString>> {
            identifiers()
        }

        #[unsafe(method_id(toolbar:itemForItemIdentifier:willBeInsertedIntoToolbar:))]
        fn item_for(
            &self,
            _t: &NSToolbar,
            identifier: &NSString,
            _insert: bool,
        ) -> Option<Retained<NSToolbarItem>> {
            // method_id's raw return is RetainedReturnValue → no early `return`;
            // the whole body is one tail expression yielding Option.
            let mtm = self.mtm();
            let id = identifier.to_string();
            let item = NSToolbarItem::initWithItemIdentifier(NSToolbarItem::alloc(mtm), identifier);

            if id == TITLE_ID {
                let field = NSTextField::labelWithString(&NSString::from_str(""), mtm);
                *self.ivars().title_field.borrow_mut() = Some(field.clone());
                let view: &NSView = &field;
                item.setView(Some(view));
                Some(item)
            } else if id == AUTHOR_ID || id == VENUE_ID {
                let (placeholder, action, slot): (&str, _, &RefCell<_>) = if id == AUTHOR_ID {
                    ("Author", sel!(onAuthorEdit:), &self.ivars().author_field)
                } else {
                    ("Venue", sel!(onVenueEdit:), &self.ivars().venue_field)
                };
                let field = NSTextField::textFieldWithString(&NSString::from_str(""), mtm);
                field.setPlaceholderString(Some(&NSString::from_str(placeholder)));
                field.setFrameSize(NSSize { width: 140.0, height: 22.0 });
                let target: &objc2::runtime::AnyObject = self;
                unsafe {
                    field.setTarget(Some(target));
                    field.setAction(Some(action));
                }
                *slot.borrow_mut() = Some(field.clone());
                let view: &NSView = &field;
                item.setView(Some(view));
                item.setLabel(&NSString::from_str(placeholder));
                Some(item)
            } else {
                match meta_for(identifier) {
                    None => None, // system-provided (flexible space)
                    Some((label, symbol)) => {
                        let ns_label = NSString::from_str(label);
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
                        unsafe {
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
            let _ = self.ivars().app.emit("toolbar:action", ActionPayload { id });
        }

        #[unsafe(method(onAuthorEdit:))]
        fn on_author(&self, sender: &NSTextField) {
            self.emit_field(AUTHOR_ID, sender);
        }

        #[unsafe(method(onVenueEdit:))]
        fn on_venue(&self, sender: &NSTextField) {
            self.emit_field(VENUE_ID, sender);
        }
    }
);

impl ToolbarDelegate {
    fn new(mtm: MainThreadMarker, app: AppHandle) -> Retained<Self> {
        let this = Self::alloc(mtm).set_ivars(Ivars {
            app,
            title_field: RefCell::new(None),
            author_field: RefCell::new(None),
            venue_field: RefCell::new(None),
        });
        unsafe { msg_send![super(this), init] }
    }

    fn emit_field(&self, id: &str, sender: &NSTextField) {
        let value = sender.stringValue().to_string();
        let _ = self.ivars().app.emit(
            "toolbar:field",
            FieldPayload { id: id.to_string(), value },
        );
    }
}

// Delegate is MainThreadOnly (!Send/!Sync). Keep it in a main-thread thread-local:
// keeps it alive (NSToolbar's delegate ref is weak) AND lets the setters reach it.
thread_local! {
    static DELEGATE: RefCell<Option<Retained<ToolbarDelegate>>> = const { RefCell::new(None) };
}

fn set_string(field: &RefCell<Option<Retained<NSTextField>>>, value: &str) {
    if let Some(f) = field.borrow().as_ref() {
        unsafe { f.setStringValue(&NSString::from_str(value)) };
        f.sizeToFit();
    }
}

/// Update the centered filename label. Called on the main thread from
/// set_window_document whenever the open file changes.
pub fn set_document_title(title: &str) {
    DELEGATE.with(|d| {
        if let Some(del) = d.borrow().as_ref() {
            set_string(&del.ivars().title_field, title);
        }
    });
}

/// Push the current author/venue into the toolbar fields (main thread).
pub fn set_fields(author: &str, venue: &str) {
    DELEGATE.with(|d| {
        if let Some(del) = d.borrow().as_ref() {
            set_string(&del.ivars().author_field, author);
            set_string(&del.ivars().venue_field, venue);
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
    // centeredItemIdentifier (singular) is deprecated on macOS 13 but works on 11+.
    #[allow(deprecated)]
    toolbar.setCenteredItemIdentifier(Some(&NSString::from_str(TITLE_ID)));
    ns_win.setToolbar(Some(&toolbar));
    ns_win.setToolbarStyle(NSWindowToolbarStyle::Unified);
    ns_win.setTitleVisibility(NSWindowTitleVisibility::Hidden);

    DELEGATE.with(|d| *d.borrow_mut() = Some(delegate));
}
