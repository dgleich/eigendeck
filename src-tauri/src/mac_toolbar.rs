//! Native macOS NSToolbar for the main window. Uses the Expanded toolbar style,
//! so the window's native title + proxy icon render CENTERED on their own row
//! (the BBEdit/Keynote look) — giving the proxy path popover, drag-to-share, and
//! the edited dot for free — with the toolbar buttons/fields in the row below:
//! Add Slide / Add Build / Save on the left, Author / Venue / Export / Present on
//! the right. The title/proxy are driven from lib.rs `set_window_document`
//! (setRepresentedURL + setTitle + setDocumentEdited).
//!
//! - BUTTON items post a Rust→JS `toolbar:action` event; the frontend runs the
//!   same action as the HTML button (dispatchToolbarAction).
//! - The Author/Venue TEXT FIELDS post `toolbar:field` {id,value} on edit; the
//!   frontend writes them to config. set_fields() pushes current values back.
//!
//! SPIKE — behind the `mac-toolbar` cargo feature (off by default).

use std::cell::RefCell;

use objc2::rc::Retained;
use objc2::runtime::ProtocolObject;
use objc2::{define_class, msg_send, sel, DefinedClass, MainThreadMarker, MainThreadOnly};
use objc2_app_kit::{
    NSFontWeightRegular, NSImage, NSImageSymbolConfiguration, NSImageSymbolScale, NSTextField,
    NSToolbar, NSToolbarDelegate, NSToolbarItem, NSView, NSWindow, NSWindowToolbarStyle,
};
use objc2_foundation::{NSArray, NSObjectProtocol, NSSize, NSString};
use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager};

/// Author/Venue toolbar-item size (logical points); the toolbar centers the item.
const FIELD_WIDTH: f64 = 130.0;
const FIELD_HEIGHT: f64 = 28.0;
/// SF Symbol point size for the button icons (the real lever for icon size in a
/// bordered toolbar item). Bump for larger icons.
const ICON_POINT_SIZE: f64 = 18.0;

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
    // left group | flexible space | right group. The document title is the native
    // centered title row (Expanded style), NOT a toolbar item.
    let order = [
        "add-slide", "add-build", "save",
        FLEX_ID,
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

            if id == AUTHOR_ID || id == VENUE_ID {
                let (placeholder, action, slot): (&str, _, &RefCell<_>) = if id == AUTHOR_ID {
                    ("Author", sel!(onAuthorEdit:), &self.ivars().author_field)
                } else {
                    ("Venue", sel!(onVenueEdit:), &self.ivars().venue_field)
                };
                let field = NSTextField::textFieldWithString(&NSString::from_str(""), mtm);
                field.setPlaceholderString(Some(&NSString::from_str(placeholder)));
                let target: &objc2::runtime::AnyObject = self;
                unsafe {
                    field.setTarget(Some(target));
                    field.setAction(Some(action));
                }
                *slot.borrow_mut() = Some(field.clone());
                // Give the ITEM a fixed size and let the toolbar center the field
                // vertically — the idiomatic path (no container / manual padding).
                #[allow(deprecated)]
                {
                    item.setMinSize(NSSize { width: FIELD_WIDTH, height: FIELD_HEIGHT });
                    item.setMaxSize(NSSize { width: FIELD_WIDTH, height: FIELD_HEIGHT });
                }
                let view: &NSView = &field;
                item.setView(Some(view));
                item.setLabel(&NSString::from_str(""));
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
                            // Enlarge the SF Symbol — a bordered item otherwise
                            // renders it at the small control size.
                            let cfg = unsafe {
                                NSImageSymbolConfiguration::configurationWithPointSize_weight_scale(
                                    ICON_POINT_SIZE,
                                    NSFontWeightRegular,
                                    NSImageSymbolScale::Large,
                                )
                            };
                            let sized = unsafe { image.imageWithSymbolConfiguration(&cfg) }
                                .unwrap_or(image);
                            item.setImage(Some(&sized));
                        }
                        // Bordered → native toolbar-button chrome: hover highlight,
                        // pressed state, standard control sizing (macOS 11+).
                        item.setBordered(true);
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
// keeps it alive (NSToolbar's delegate ref is weak) AND lets set_fields reach it.
thread_local! {
    static DELEGATE: RefCell<Option<Retained<ToolbarDelegate>>> = const { RefCell::new(None) };
}

fn set_string(field: &RefCell<Option<Retained<NSTextField>>>, value: &str) {
    if let Some(f) = field.borrow().as_ref() {
        f.setStringValue(&NSString::from_str(value));
    }
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
    ns_win.setToolbar(Some(&toolbar));
    // Expanded → native title + proxy centered on their own row (BBEdit/Keynote),
    // toolbar items on the row below. The native title provides the proxy path
    // popover + drag + edited dot for free (driven by setRepresentedURL in lib.rs).
    ns_win.setToolbarStyle(NSWindowToolbarStyle::Expanded);

    DELEGATE.with(|d| *d.borrow_mut() = Some(delegate));
}
