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
    NSColor, NSControlStateValueOff, NSControlStateValueOn, NSFont, NSFontWeightRegular, NSImage,
    NSImageSymbolConfiguration, NSImageSymbolScale, NSLayoutConstraint, NSMenu, NSMenuItem,
    NSTextAlignment, NSTextField, NSToolbar, NSToolbarDelegate, NSToolbarItem, NSView, NSWindow,
    NSWindowToolbarStyle,
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
const JUPYTER_ID: &str = "jupyter";
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

// left group | flexible space | right group. The document title is the native
// centered title row (Expanded style), NOT a toolbar item. The Jupyter item is
// ALLOWED but not DEFAULT: it's inserted/removed live by set_jupyter() so it only
// shows when the deck actually uses a Jupyter kernel (mirrors the HTML pill).
fn build_ids(with_jupyter: bool) -> Retained<NSArray<NSString>> {
    let mut order: Vec<&str> = vec![
        "add-slide", "add-build", "save",
        FLEX_ID, TITLE_ID, FLEX_ID,
        AUTHOR_ID, VENUE_ID,
    ];
    if with_jupyter {
        order.push(JUPYTER_ID);
    }
    order.push("export");
    order.push("present");
    let ids: Vec<Retained<NSString>> = order.iter().map(|id| NSString::from_str(id)).collect();
    let refs: Vec<&NSString> = ids.iter().map(|r| &**r).collect();
    NSArray::from_slice(&refs)
}

fn default_identifiers() -> Retained<NSArray<NSString>> {
    build_ids(false)
}

fn allowed_identifiers() -> Retained<NSArray<NSString>> {
    build_ids(true)
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
            let color = NSColor::controlAccentColor();
            let color_cfg = NSImageSymbolConfiguration::configurationWithHierarchicalColor(&color);
            cfg.configurationByApplyingConfiguration(&color_cfg)
        } else {
            cfg
        };
        let sized = image.imageWithSymbolConfiguration(&cfg).unwrap_or(image);
        item.setImage(Some(&sized));
    }
    // Bordered and label-beneath are mutually exclusive on a plain NSToolbarItem:
    // a bordered item is icon-only (capsule hover/press chrome, label in tooltip),
    // a borderless item shows the icon with the label beneath (Keynote/Xcode look).
    // So: compact → bordered (icon-only capsule), normal → borderless (icon+label).
    item.setBordered(compact);
}

/// Map the aggregate Jupyter-health status to a system color for the icon tint.
fn jupyter_color(status: &str) -> Retained<NSColor> {
    match status {
        "green" => NSColor::systemGreenColor(),
        "yellow" => NSColor::systemYellowColor(),
        "red" => NSColor::systemRedColor(),
        _ => NSColor::systemGrayColor(),
    }
}

/// Style the Jupyter server-status item: a `server.rack` glyph tinted by the
/// aggregate health (green/yellow/red, gray = nothing to report). Mirrors the
/// HTML ServerStatusPill. Follows the same compact bordered/label rules as the
/// other buttons.
fn style_jupyter(item: &NSToolbarItem, status: &str, tooltip: &str, compact: bool) {
    let ns_label = NSString::from_str("Jupyter servers");
    item.setLabel(&NSString::from_str(if compact { "" } else { "Jupyter" }));
    item.setPaletteLabel(&ns_label);
    item.setToolTip(Some(&NSString::from_str(tooltip)));
    if let Some(image) = NSImage::imageWithSystemSymbolName_accessibilityDescription(
        &NSString::from_str("server.rack"),
        Some(&ns_label),
    ) {
        let point = if compact { ICON_POINT_SIZE_COMPACT } else { ICON_POINT_SIZE_REGULAR };
        let size_cfg = unsafe {
            NSImageSymbolConfiguration::configurationWithPointSize_weight_scale(
                point,
                NSFontWeightRegular,
                NSImageSymbolScale::Large,
            )
        };
        let color_cfg =
            NSImageSymbolConfiguration::configurationWithHierarchicalColor(&jupyter_color(status));
        let cfg = size_cfg.configurationByApplyingConfiguration(&color_cfg);
        let sized = image.imageWithSymbolConfiguration(&cfg).unwrap_or(image);
        item.setImage(Some(&sized));
    }
    item.setBordered(compact);
}

/// A Keynote-style right-click menu for the toolbar's non-button areas (title,
/// Author, Venue): "Icon and Text" / "Icon Only" with a checkmark on the current
/// mode. Selecting posts `toolbar:action` {id: "compact-on"|"compact-off"} so the
/// frontend flips the `compactToolbar` preference (single source of truth — keeps
/// the Settings checkbox in sync), which drives set_compact back here.
fn build_display_menu(delegate: &ToolbarDelegate, compact: bool, mtm: MainThreadMarker) -> Retained<NSMenu> {
    let menu = NSMenu::new(mtm);
    menu.setAutoenablesItems(false);
    let target: &objc2::runtime::AnyObject = delegate;
    // (title, tag, checked-when). tag 0 = Icon and Text (not compact), 1 = Icon Only.
    for (title, tag, checked) in [("Icon and Text", 0isize, !compact), ("Icon Only", 1isize, compact)] {
        let item = unsafe {
            NSMenuItem::initWithTitle_action_keyEquivalent(
                NSMenuItem::alloc(mtm),
                &NSString::from_str(title),
                Some(sel!(onDisplayMode:)),
                &NSString::from_str(""),
            )
        };
        item.setTag(tag);
        unsafe { item.setTarget(Some(target)) };
        item.setState(if checked { NSControlStateValueOn } else { NSControlStateValueOff });
        menu.addItem(&item);
    }
    menu
}

/// True if the view's runtime Obj-C class is the (private) toolbar background view.
/// Matched by class NAME only — we never call private API on it, just setMenu:.
fn is_toolbar_view(view: &NSView) -> bool {
    let name = view.class().name();
    let s = name.to_str().unwrap_or("");
    s == "NSToolbarView" || s == "NSToolbarItemViewer" || s == "_NSToolbarViewClipView"
}

/// Depth-first search for the toolbar background view (owned Retained in/out so
/// no manual retain is needed).
fn search_toolbar_view(view: Retained<NSView>) -> Option<Retained<NSView>> {
    if is_toolbar_view(&view) {
        return Some(view);
    }
    let subs = unsafe { view.subviews() };
    for i in 0..subs.count() {
        if let Some(found) = search_toolbar_view(subs.objectAtIndex(i)) {
            return Some(found);
        }
    }
    None
}

/// Find the NSToolbarView behind the window's native toolbar. It's a sibling of
/// contentView under the window's private frame view, so climb to the root first.
fn find_toolbar_background(ns_win: &NSWindow) -> Option<Retained<NSView>> {
    let content = unsafe { ns_win.contentView() }?;
    let mut root = content;
    while let Some(sv) = unsafe { root.superview() } {
        root = sv;
    }
    search_toolbar_view(root)
}

/// Set `menu` on a view AND every descendant. Right-clicks are hit-tested to the
/// deepest view (each item's NSToolbarItemViewer, the _NSToolbarFlexibleSpace in
/// the gaps, etc.) and menuForEvent: does NOT bubble to the NSToolbarView's menu —
/// so to get a Keynote-style right-click anywhere on the strip we set it on all of
/// them.
fn set_menu_recursive(view: &NSView, menu: &NSMenu) {
    unsafe { view.setMenu(Some(menu)) };
    let subs = unsafe { view.subviews() };
    for i in 0..subs.count() {
        set_menu_recursive(&subs.objectAtIndex(i), menu);
    }
}

/// Attach the right-click display menu to the toolbar BACKGROUND (the empty strip,
/// Keynote-style) — the item views already carry the same menu as a fallback. The
/// background view exists only after first layout, so this is idempotent and
/// retried from each state push until it succeeds. Main thread.
fn attach_toolbar_menu_once() {
    let Some(mtm) = MainThreadMarker::new() else { return };
    DELEGATE.with(|d| {
        let Some(del) = d.borrow().as_ref().cloned() else { return };
        if del.ivars().menu_attached.get() {
            return;
        }
        let Some(win) = del.ivars().app.get_webview_window("main") else { return };
        let Ok(ptr) = win.ns_window() else { return };
        // Safety: Tauri owns a valid NSWindow for "main" for its lifetime.
        let ns_win: &NSWindow = unsafe { &*(ptr as *const NSWindow) };
        if let Some(tbview) = find_toolbar_background(ns_win) {
            let menu = build_display_menu(&del, del.ivars().compact.get(), mtm);
            set_menu_recursive(&tbview, &menu);
            del.ivars().menu_attached.set(true);
        }
    });
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
    /// Jupyter server-status item + its current health/tooltip (pushed from JS).
    jupyter_item: RefCell<Option<Retained<NSToolbarItem>>>,
    jupyter_status: RefCell<String>,
    jupyter_tooltip: RefCell<String>,
    /// Whether the right-click display menu has been attached to the toolbar
    /// background view yet (that private view exists only after first layout, so
    /// we attach lazily on the first state push and retry until it's found).
    menu_attached: Cell<bool>,
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
            default_identifiers()
        }

        #[unsafe(method_id(toolbarAllowedItemIdentifiers:))]
        fn allowed_ids(&self, _t: &NSToolbar) -> Retained<NSArray<NSString>> {
            allowed_identifiers()
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
                // Right-click the title area → the Icon/Text display menu.
                let menu = build_display_menu(self, self.ivars().compact.get(), mtm);
                unsafe {
                    container.setMenu(Some(&menu));
                    field.setMenu(Some(&menu));
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
                // Right-click the Author/Venue field → the Icon/Text display menu.
                let menu = build_display_menu(self, self.ivars().compact.get(), mtm);
                unsafe { field.setMenu(Some(&menu)) };
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
            } else if id == JUPYTER_ID {
                let compact = self.ivars().compact.get();
                style_jupyter(
                    &item,
                    &self.ivars().jupyter_status.borrow(),
                    &self.ivars().jupyter_tooltip.borrow(),
                    compact,
                );
                let target: &objc2::runtime::AnyObject = self;
                unsafe {
                    item.setTarget(Some(target));
                    item.setAction(Some(sel!(onItem:)));
                }
                *self.ivars().jupyter_item.borrow_mut() = Some(item.clone());
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

        #[unsafe(method(onDisplayMode:))]
        fn on_display_mode(&self, sender: &NSMenuItem) {
            // tag 1 = "Icon Only" = compact. Route through the frontend so the
            // compactToolbar preference (and the Settings checkbox) stays in sync;
            // the pref change drives set_compact back here.
            let id = if sender.tag() == 1 { "compact-on" } else { "compact-off" };
            let _ = self.ivars().app.emit("toolbar:action", ActionPayload { id: id.to_string() });
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
            jupyter_item: RefCell::new(None),
            jupyter_status: RefCell::new("gray".to_string()),
            jupyter_tooltip: RefCell::new(String::new()),
            menu_attached: Cell::new(false),
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
    // First push after the deck loads is reliably after first layout — a good
    // moment to (lazily) attach the toolbar-background right-click menu.
    attach_toolbar_menu_once();
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
    restyle_jupyter(del);
}

/// Re-apply the Jupyter item's tint/label from the delegate's current state.
fn restyle_jupyter(del: &ToolbarDelegate) {
    if let Some(item) = del.ivars().jupyter_item.borrow().as_ref() {
        style_jupyter(
            item,
            &del.ivars().jupyter_status.borrow(),
            &del.ivars().jupyter_tooltip.borrow(),
            del.ivars().compact.get(),
        );
    }
}

/// Toggle compact view live. Compact = labels off + smaller icons AND a shorter
/// toolbar: switch the window's toolbar style from Expanded (a dedicated centered
/// title row PLUS a per-item label row — tall) to UnifiedCompact (one short row,
/// title inline). Labels-off alone can't reclaim height because Expanded always
/// reserves the label row. Main thread.
pub fn set_compact(compact: bool) {
    DELEGATE.with(|d| {
        let Some(del) = d.borrow().as_ref().cloned() else { return };

        // Snapshot the editable field values — the rebuild below recreates the
        // fields empty (item_for makes fresh NSTextFields), so we restore after.
        let read = |slot: &RefCell<Option<Retained<NSTextField>>>| {
            slot.borrow().as_ref().map(|f| f.stringValue().to_string()).unwrap_or_default()
        };
        let title = read(&del.ivars().title_field);
        let author = read(&del.ivars().author_field);
        let venue = read(&del.ivars().venue_field);

        // Flip the flag first so item_for builds each item in the new mode.
        del.ivars().compact.set(compact);

        // Rebuild the toolbar rather than mutating items in place: an in-place
        // setLabel/setBordered doesn't relayout the label row (that was #125 —
        // turning compact OFF left the labels hidden). Setting the identifiers to
        // empty then back forces the delegate to rebuild every item fresh. Keep
        // the Jupyter item iff it's currently live.
        let with_jupyter = del.ivars().jupyter_item.borrow().is_some()
            || del.ivars().jupyter_status.borrow().as_str() != "gray";
        TOOLBAR.with(|t| {
            if let Some(tb) = t.borrow().as_ref() {
                let empty: Retained<NSArray<NSString>> = NSArray::from_slice(&[]);
                tb.setItemIdentifiers(&empty);
                tb.setItemIdentifiers(&build_ids(with_jupyter));
            }
        });

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

        // Restore the field values into the freshly-created fields.
        set_fields(&title, &author, &venue);

        // The style switch can swap the toolbar container, so re-attach the
        // background menu (set_fields already tried, but with the pre-rebuild flag).
        del.ivars().menu_attached.set(false);
    });
    attach_toolbar_menu_once();
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

/// Index of the item with the given identifier in the toolbar, if present.
fn item_index(tb: &NSToolbar, id: &str) -> Option<usize> {
    let items = tb.items();
    (0..items.count()).find(|&i| items.objectAtIndex(i).itemIdentifier().to_string() == id)
}

/// Update the Jupyter server-status icon. status "gray" = the deck has no live
/// notebooks → the item is REMOVED entirely (mirrors the HTML pill hiding). Any
/// other status inserts it (before Export) if absent and tints it. Main thread.
pub fn set_jupyter(status: &str, tooltip: &str) {
    DELEGATE.with(|d| {
        let Some(del) = d.borrow().as_ref().cloned() else { return };
        *del.ivars().jupyter_status.borrow_mut() = status.to_string();
        *del.ivars().jupyter_tooltip.borrow_mut() = tooltip.to_string();
        let visible = status != "gray";
        TOOLBAR.with(|t| {
            let Some(tb) = t.borrow().as_ref().cloned() else { return };
            match (visible, item_index(&tb, JUPYTER_ID)) {
                // Show: insert before Export (item_for styles it from the status
                // we just stored). Fall back to the end if Export isn't found.
                (true, None) => {
                    let idx = item_index(&tb, "export").unwrap_or_else(|| tb.items().count());
                    tb.insertItemWithItemIdentifier_atIndex(&NSString::from_str(JUPYTER_ID), idx as isize);
                    // New viewer subtree → re-apply the right-click menu.
                    del.ivars().menu_attached.set(false);
                }
                // Already shown: just re-tint.
                (true, Some(_)) => restyle_jupyter(&del),
                // Hide: remove it and drop the stale ref.
                (false, Some(i)) => {
                    tb.removeItemAtIndex(i as isize);
                    *del.ivars().jupyter_item.borrow_mut() = None;
                }
                (false, None) => {}
            }
        });
    });
    // Also a good post-layout moment to (lazily) attach the background menu.
    attach_toolbar_menu_once();
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
