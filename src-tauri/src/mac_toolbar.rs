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

use std::cell::{Cell, RefCell};

use objc2::rc::Retained;
use objc2::runtime::ProtocolObject;
use objc2::{define_class, msg_send, sel, DefinedClass, MainThreadMarker, MainThreadOnly};
use objc2_app_kit::{
    NSColor, NSFont, NSFontWeightRegular, NSImage, NSImageSymbolConfiguration, NSImageSymbolScale,
    NSLayoutConstraint, NSTextAlignment, NSTextField, NSToolbar, NSToolbarDelegate, NSToolbarItem,
    NSView, NSWindow, NSWindowToolbarStyle,
};
use objc2_foundation::{NSArray, NSObjectProtocol, NSPoint, NSRect, NSSize, NSString};
use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager};

/// Author/Venue toolbar-item size (logical points); the toolbar centers the item.
const FIELD_WIDTH: f64 = 130.0;
const FIELD_HEIGHT: f64 = 28.0;
/// SF Symbol point size for the button icons. 18 clipped the taller glyphs
/// (Export's up-arrow) against the button; 15 stays comfortably inside. Compact
/// mode (labels off) drops to a smaller glyph to reclaim vertical space.
const ICON_POINT_SIZE_REGULAR: f64 = 15.0;
const ICON_POINT_SIZE_COMPACT: f64 = 12.0;

const TITLE_ID: &str = "title";
const TITLE_WIDTH: f64 = 240.0;
const TITLE_FONT_SIZE: f64 = 14.0;
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

/// Apply the visible chrome for a BUTTON item. Shared by the initial build
/// (item_for) and the live toggles (set_compact / set_save_dirty) so all three
/// produce identical styling.
///
/// - `compact`: hide the visible label and shrink the icon (paletteLabel + toolTip
///   keep the name available for a11y/hover).
/// - `dirty`: tint the glyph with the system accent color — used on the Save item
///   to flag unsaved changes (mirrors the title-bar edited dot).
fn style_button(item: &NSToolbarItem, label: &str, symbol: &str, compact: bool, dirty: bool) {
    let ns_label = NSString::from_str(label);
    // Expanded style ignores displayMode(IconOnly); an EMPTY visible label is
    // what gives icon-only. Regular mode shows the label under the icon.
    item.setLabel(&NSString::from_str(if compact { "" } else { label }));
    item.setPaletteLabel(&ns_label);
    item.setToolTip(Some(&ns_label));
    if let Some(image) = NSImage::imageWithSystemSymbolName_accessibilityDescription(
        &NSString::from_str(symbol),
        Some(&ns_label),
    ) {
        let point = if compact { ICON_POINT_SIZE_COMPACT } else { ICON_POINT_SIZE_REGULAR };
        let cfg = unsafe {
            NSImageSymbolConfiguration::configurationWithPointSize_weight_scale(
                point,
                NSFontWeightRegular,
                NSImageSymbolScale::Large,
            )
        };
        // Accent-tint the dirty Save icon; otherwise leave it template (adapts to
        // light/dark). Combine the size + color configs.
        let cfg = if dirty {
            let color = unsafe { NSColor::controlAccentColor() };
            let color_cfg =
                unsafe { NSImageSymbolConfiguration::configurationWithHierarchicalColor(&color) };
            unsafe { cfg.configurationByApplyingConfiguration(&color_cfg) }
        } else {
            cfg
        };
        let sized = unsafe { image.imageWithSymbolConfiguration(&cfg) }.unwrap_or(image);
        item.setImage(Some(&sized));
    }
    // Bordered and label-beneath are mutually exclusive on a plain NSToolbarItem:
    // a bordered item is icon-only (capsule hover/press chrome, label in tooltip),
    // a borderless item shows the icon with the label beneath (Keynote/Xcode look).
    // So: compact → bordered (icon-only capsule), normal → borderless (icon+label).
    item.setBordered(compact);
}

struct Ivars {
    app: AppHandle,
    title_field: RefCell<Option<Retained<NSTextField>>>,
    author_field: RefCell<Option<Retained<NSTextField>>>,
    venue_field: RefCell<Option<Retained<NSTextField>>>,
    /// Built BUTTON items, kept so the live toggles can re-style them in place.
    buttons: RefCell<Vec<Retained<NSToolbarItem>>>,
    /// Compact view (labels off + smaller icons). Read at build time; toggled live
    /// by set_compact().
    compact: Cell<bool>,
    /// Whether the deck has unsaved changes — accent-tints the Save icon.
    save_dirty: Cell<bool>,
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
                // Bold, borderless, editable presentation title — centered in the
                // toolbar row (centeredItemIdentifier). Two-way synced to
                // presentation.title (onTitleEdit → toolbar:field; set_fields pushes back).
                let field = NSTextField::textFieldWithString(&NSString::from_str(""), mtm);
                field.setBezeled(false);
                field.setDrawsBackground(false);
                field.setFont(Some(&NSFont::boldSystemFontOfSize(TITLE_FONT_SIZE)));
                field.setAlignment(NSTextAlignment::Center);
                let target: &objc2::runtime::AnyObject = self;
                unsafe {
                    field.setTarget(Some(target));
                    field.setAction(Some(sel!(onTitleEdit:)));
                }
                *self.ivars().title_field.borrow_mut() = Some(field.clone());
                // A bare single-line NSTextField top-aligns its text when the item
                // stretches it to a fixed height. Wrap it in a container and pin
                // centerY (no height constraint → the field uses its intrinsic text
                // height) so the text — and the focus ring — sit centered in the row.
                let container = NSView::initWithFrame(
                    NSView::alloc(mtm),
                    NSRect::new(
                        NSPoint::new(0.0, 0.0),
                        NSSize { width: TITLE_WIDTH, height: FIELD_HEIGHT },
                    ),
                );
                unsafe {
                    field.setTranslatesAutoresizingMaskIntoConstraints(false);
                    container.addSubview(&field);
                    let leading = field
                        .leadingAnchor()
                        .constraintEqualToAnchor(&container.leadingAnchor());
                    let trailing = field
                        .trailingAnchor()
                        .constraintEqualToAnchor(&container.trailingAnchor());
                    let center_y = field
                        .centerYAnchor()
                        .constraintEqualToAnchor(&container.centerYAnchor());
                    let refs: [&NSLayoutConstraint; 3] = [&leading, &trailing, &center_y];
                    NSLayoutConstraint::activateConstraints(&NSArray::from_slice(&refs));
                }
                #[allow(deprecated)]
                {
                    item.setMinSize(NSSize { width: TITLE_WIDTH, height: FIELD_HEIGHT });
                    item.setMaxSize(NSSize { width: TITLE_WIDTH, height: FIELD_HEIGHT });
                }
                let view: &NSView = &container;
                item.setView(Some(view));
                item.setLabel(&NSString::from_str(""));
                Some(item)
            } else if id == AUTHOR_ID || id == VENUE_ID {
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
                        let compact = self.ivars().compact.get();
                        let dirty = id == "save" && self.ivars().save_dirty.get();
                        style_button(&item, label, symbol, compact, dirty);
                        let target: &objc2::runtime::AnyObject = self;
                        unsafe {
                            item.setTarget(Some(target));
                            item.setAction(Some(sel!(onItem:)));
                        }
                        // Remember the item so the live toggles can restyle it.
                        let mut buttons = self.ivars().buttons.borrow_mut();
                        buttons.retain(|it| it.itemIdentifier().to_string() != id);
                        buttons.push(item.clone());
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

        #[unsafe(method(onTitleEdit:))]
        fn on_title(&self, sender: &NSTextField) {
            self.emit_field(TITLE_ID, sender);
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
            buttons: RefCell::new(Vec::new()),
            compact: Cell::new(false),
            save_dirty: Cell::new(false),
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

/// Push the current title/author/venue into the toolbar fields (main thread).
pub fn set_fields(title: &str, author: &str, venue: &str) {
    DELEGATE.with(|d| {
        if let Some(del) = d.borrow().as_ref() {
            set_string(&del.ivars().title_field, title);
            set_string(&del.ivars().author_field, author);
            set_string(&del.ivars().venue_field, venue);
        }
    });
}

/// Re-apply styling to every built button from the delegate's current
/// compact/dirty flags. Main thread.
fn restyle_buttons(del: &ToolbarDelegate) {
    let compact = del.ivars().compact.get();
    let dirty = del.ivars().save_dirty.get();
    for item in del.ivars().buttons.borrow().iter() {
        let ident = item.itemIdentifier();
        if let Some((label, symbol)) = meta_for(&ident) {
            style_button(item, label, symbol, compact, ident.to_string() == "save" && dirty);
        }
    }
}

/// Toggle compact view live. Compact = labels off + smaller icons AND a shorter
/// toolbar: switch the window's toolbar style from Expanded (a dedicated centered
/// title row PLUS a per-item label row — tall) to UnifiedCompact (one short row,
/// title inline). Labels-off alone can't reclaim height because Expanded always
/// reserves the label row. Main thread.
pub fn set_compact(compact: bool) {
    DELEGATE.with(|d| {
        if let Some(del) = d.borrow().as_ref() {
            del.ivars().compact.set(compact);
            restyle_buttons(del);
            if let Some(win) = del.ivars().app.get_webview_window("main") {
                if let Ok(ptr) = win.ns_window() {
                    // Safety: Tauri owns a valid NSWindow for "main" for its lifetime.
                    let ns_win: &NSWindow = unsafe { &*(ptr as *const NSWindow) };
                    let style = if compact {
                        NSWindowToolbarStyle::UnifiedCompact
                    } else {
                        NSWindowToolbarStyle::Expanded
                    };
                    ns_win.setToolbarStyle(style);
                }
            }
        }
    });
}

/// Accent-tint the Save icon when the deck has unsaved changes. Main thread.
pub fn set_save_dirty(dirty: bool) {
    DELEGATE.with(|d| {
        if let Some(del) = d.borrow().as_ref() {
            del.ivars().save_dirty.set(dirty);
            restyle_buttons(del);
        }
    });
}

// The toolbar itself, kept so we can show/hide it (welcome screen + present mode).
thread_local! {
    static TOOLBAR: RefCell<Option<Retained<NSToolbar>>> = const { RefCell::new(None) };
}

/// Show or hide the whole toolbar (hidden on the welcome screen and while
/// presenting). Main thread.
pub fn set_visible(visible: bool) {
    TOOLBAR.with(|t| {
        if let Some(tb) = t.borrow().as_ref() {
            tb.setVisible(visible);
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
    // (Icon-only is achieved per-item via empty labels — Expanded style ignores
    // displayMode, so we don't set it.)
    // Center the editable presentation-title item in the toolbar row. (Singular
    // API is deprecated on 13+ but works on 11+; the native title lives on the
    // separate Expanded row, so this only centers our title field.)
    #[allow(deprecated)]
    toolbar.setCenteredItemIdentifier(Some(&NSString::from_str(TITLE_ID)));
    ns_win.setToolbar(Some(&toolbar));
    // Expanded → native title + proxy centered on their own row (BBEdit/Keynote),
    // toolbar items on the row below. The native title provides the proxy path
    // popover + drag + edited dot for free (driven by setRepresentedURL in lib.rs).
    ns_win.setToolbarStyle(NSWindowToolbarStyle::Expanded);

    TOOLBAR.with(|t| *t.borrow_mut() = Some(toolbar));
    DELEGATE.with(|d| *d.borrow_mut() = Some(delegate));
}
