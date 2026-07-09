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
use objc2::{define_class, msg_send, sel, AnyThread, DefinedClass, MainThreadMarker, MainThreadOnly};
use objc2_app_kit::{
    NSColor, NSCompositingOperation, NSFont, NSFontWeightRegular, NSImage,
    NSImageSymbolConfiguration, NSImageSymbolScale, NSLayoutConstraint, NSTextAlignment,
    NSTextField, NSTextFieldCell, NSToolbar, NSToolbarDelegate, NSToolbarDisplayMode, NSToolbarItem,
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
/// Per-glyph vertical nudge (points) so off-balance SF Symbols read as centered
/// against the boxy neighbors (Jupyter, Present). POSITIVE = up, NEGATIVE = down.
/// Separate values for normal vs compact since the glyph is smaller in compact.
///   Export (square.and.arrow.up): arrow above the box → box sinks → nudge UP.
///   Save   (square.and.arrow.down): arrow below the box → box rides high → nudge DOWN.
const EXPORT_NUDGE_REGULAR: f64 = 8.0;
const EXPORT_NUDGE_COMPACT: f64 = 4.0;
const SAVE_NUDGE_REGULAR: f64 = 8.0;
const SAVE_NUDGE_COMPACT: f64 = 4.0;

fn nudge_for(symbol: &str, compact: bool) -> f64 {
    match symbol {
        "square.and.arrow.up" => if compact { EXPORT_NUDGE_COMPACT } else { EXPORT_NUDGE_REGULAR },
        "square.and.arrow.down" => if compact { SAVE_NUDGE_COMPACT } else { SAVE_NUDGE_REGULAR },
        _ => 0.0,
    }
}

/// Width (points) of the invisible spacer between the left group (Add Slide / Add
/// Build / Save) and the centered title, per mode. Bump COMPACT to push the left
/// group further from the title in compact mode; REGULAR is normally 0.
const LEAD_GAP_REGULAR: f64 = 0.0;
const LEAD_GAP_COMPACT: f64 = 100.0;
const LEAD_GAP_ID: &str = "lead-gap";

fn lead_gap_for(compact: bool) -> f64 {
    if compact { LEAD_GAP_COMPACT } else { LEAD_GAP_REGULAR }
}

const TITLE_ID: &str = "title";
const TITLE_WIDTH: f64 = 240.0;
const TITLE_FONT_SIZE: f64 = 14.0;
/// Breathing room (points) above AND below the title text, inside the focus ring.
const TITLE_VPAD: f64 = 5.0;
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
        "add-slide", "add-build", "save", LEAD_GAP_ID,
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

/// Return a copy of `src` grown by |dy| points of transparent space so the glyph
/// shifts when the toolbar centers it. dy > 0 pads the BOTTOM (glyph moves UP);
/// dy < 0 pads the TOP (glyph moves DOWN). Preserves template rendering (so it
/// still tints for light/dark). Main thread (lockFocus).
#[allow(deprecated)] // lockFocus/unlockFocus: fine for this small compositing use
fn nudge_image(src: &NSImage, dy: f64) -> Retained<NSImage> {
    let s = src.size();
    let extra = dy.abs();
    let out = NSImage::initWithSize(
        NSImage::alloc(),
        NSSize { width: s.width, height: s.height + extra },
    );
    out.setTemplate(src.isTemplate());
    // Non-flipped image space (origin bottom-left). Up: draw high (pad at bottom).
    // Down: draw at 0 (pad at top).
    let draw_y = if dy >= 0.0 { extra } else { 0.0 };
    out.lockFocus();
    src.drawAtPoint_fromRect_operation_fraction(
        NSPoint { x: 0.0, y: draw_y },
        NSRect::new(NSPoint::new(0.0, 0.0), s),
        NSCompositingOperation::SourceOver,
        1.0,
    );
    out.unlockFocus();
    out
}
struct CellIvars {
    measuring: Cell<bool>,
}

define_class!(
    // Vertically centers single-line text: measures the text's natural height via
    // cellSizeForBounds: and shifts the drawing rect down by half the surplus. Only
    // used for the title (which is deliberately taller than its text for ring room).
    // Editing/selection route through drawingRectForBounds:, so the field editor
    // lands in the same place (no jump on click).
    #[unsafe(super(NSTextFieldCell))]
    #[thread_kind = MainThreadOnly]
    #[name = "EigendeckCenteredCell"]
    #[ivars = CellIvars]
    struct CenteredCell;

    unsafe impl NSObjectProtocol for CenteredCell {}

    impl CenteredCell {
        #[unsafe(method(drawingRectForBounds:))]
        fn drawing_rect_for_bounds(&self, bounds: NSRect) -> NSRect {
            let mut r: NSRect = unsafe { msg_send![super(self), drawingRectForBounds: bounds] };
            // cellSizeForBounds: calls back into drawingRectForBounds: — guard it.
            if !self.ivars().measuring.get() {
                self.ivars().measuring.set(true);
                let text: NSSize = unsafe { msg_send![self, cellSizeForBounds: bounds] };
                self.ivars().measuring.set(false);
                let delta = r.size.height - text.height;
                if delta > 0.0 {
                    r.origin.y += (delta / 2.0).floor();
                    r.size.height -= delta;
                }
            }
            r
        }
    }
);

impl CenteredCell {
    fn make(mtm: MainThreadMarker) -> Retained<Self> {
        let this = Self::alloc(mtm).set_ivars(CellIvars { measuring: Cell::new(false) });
        unsafe { msg_send![super(this), initTextCell: &*NSString::from_str("")] }
    }
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
    // Normal mode shows the label under the icon; compact clears the text (icon
    // only). paletteLabel + toolTip keep the name available regardless.
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
                // Large — the label row is controlled by the toolbar displayMode, not
                // image size (#125), so keep the bigger glyph.
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
        // Nudge off-balance glyphs (Export up, Save down) so their boxes align.
        let dy = nudge_for(symbol, compact);
        let sized = if dy != 0.0 { nudge_image(&sized, dy) } else { sized };
        item.setImage(Some(&sized));
    }
    // Always borderless: a BORDERED plain toolbar item renders icon-only (the label
    // is dropped for the capsule chrome). Borderless is what shows icon+label.
    item.setBordered(false);
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
    /// Invisible leading spacer item (Save→title gap) + its width constraint, whose
    /// constant is updated per mode.
    lead_gap_item: RefCell<Option<Retained<NSToolbarItem>>>,
    lead_gap_width: RefCell<Option<Retained<NSLayoutConstraint>>>,
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
                // Bold, borderless, editable title. Uses the centering cell (set
                // FIRST — setCell replaces the cell wholesale) so the text stays
                // centered inside a field made a touch taller than the text for
                // focus-ring breathing room.
                let field = NSTextField::textFieldWithString(&NSString::from_str(""), mtm);
                field.setCell(Some(&CenteredCell::make(mtm)));
                field.setBezeled(false);
                field.setDrawsBackground(false);
                field.setEditable(true);
                field.setFont(Some(&NSFont::boldSystemFontOfSize(TITLE_FONT_SIZE)));
                field.setAlignment(NSTextAlignment::Center);
                let target: &objc2::runtime::AnyObject = self;
                unsafe {
                    field.setTarget(Some(target));
                    field.setAction(Some(sel!(onTitleEdit:)));
                }
                *self.ivars().title_field.borrow_mut() = Some(field.clone());
                // Pin width AND intrinsic height. Height is required so the toolbar
                // can't stretch the field taller than its text (a single-line field
                // would then top-align). Intrinsic height reflects the bold 14pt font
                // set above.
                field.setTranslatesAutoresizingMaskIntoConstraints(false);
                field.widthAnchor().constraintEqualToConstant(TITLE_WIDTH).setActive(true);
                // Taller than the text (by 2*TITLE_VPAD) for ring room; the centering
                // cell keeps the text centered within it.
                let h = field.intrinsicContentSize().height + 2.0 * TITLE_VPAD;
                field.heightAnchor().constraintEqualToConstant(h).setActive(true);
                let view: &NSView = &field;
                item.setView(Some(view));
                item.setLabel(&NSString::from_str(""));
                Some(item)
            } else if id == AUTHOR_ID || id == VENUE_ID {
                let (placeholder, action, slot): (&str, _, &RefCell<_>) = if id == AUTHOR_ID {
                    ("Author", sel!(onAuthorEdit:), &self.ivars().author_field)
                } else {
                    ("Venue", sel!(onVenueEdit:), &self.ivars().venue_field)
                };
                // Standard bezeled editable field at its natural height (centered by
                // the toolbar) — like Mail's toolbar search field.
                let field = NSTextField::textFieldWithString(&NSString::from_str(""), mtm);
                field.setPlaceholderString(Some(&NSString::from_str(placeholder)));
                let target: &objc2::runtime::AnyObject = self;
                unsafe {
                    field.setTarget(Some(target));
                    field.setAction(Some(action));
                }
                *slot.borrow_mut() = Some(field.clone());
                field.setTranslatesAutoresizingMaskIntoConstraints(false);
                field.widthAnchor().constraintEqualToConstant(FIELD_WIDTH).setActive(true);
                let h = field.intrinsicContentSize().height;
                field.heightAnchor().constraintEqualToConstant(h).setActive(true);
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
            } else if id == LEAD_GAP_ID {
                // Invisible spacer between the left group and the title. An empty
                // NSView has no intrinsic size, so pin both width (per-mode, kept for
                // restyle_lead_gap to update its constant) and height via constraints.
                let view = NSView::initWithFrame(
                    NSView::alloc(mtm),
                    NSRect::new(NSPoint::new(0.0, 0.0), NSSize { width: 0.0, height: FIELD_HEIGHT }),
                );
                view.setTranslatesAutoresizingMaskIntoConstraints(false);
                let width = view
                    .widthAnchor()
                    .constraintEqualToConstant(lead_gap_for(self.ivars().compact.get()));
                width.setActive(true);
                // Only width matters; keep height minimal so it never props the row up.
                view.heightAnchor().constraintEqualToConstant(1.0).setActive(true);
                item.setView(Some(&view));
                item.setLabel(&NSString::from_str(""));
                *self.ivars().lead_gap_item.borrow_mut() = Some(item.clone());
                *self.ivars().lead_gap_width.borrow_mut() = Some(width);
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
            jupyter_item: RefCell::new(None),
            jupyter_status: RefCell::new("gray".to_string()),
            jupyter_tooltip: RefCell::new(String::new()),
            lead_gap_item: RefCell::new(None),
            lead_gap_width: RefCell::new(None),
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
    restyle_jupyter(del);
    restyle_lead_gap(del);
}

/// Resize the leading spacer to the current mode's gap width by updating its width
/// constraint's constant (relayouts properly). In place.
fn restyle_lead_gap(del: &ToolbarDelegate) {
    if let Some(width) = del.ivars().lead_gap_width.borrow().as_ref() {
        width.setConstant(lead_gap_for(del.ivars().compact.get()));
    }
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

/// Toggle compact view live, IN PLACE (no item rebuild). Compact = labels off +
/// smaller icons via a shorter toolbar style (UnifiedCompact vs Expanded). We
/// restyle the existing items (label/image) and switch the window toolbar style;
/// setLabel/setImage relayout the items, and validateVisibleItems nudges a
/// re-measure. Main thread.
pub fn set_compact(compact: bool) {
    DELEGATE.with(|d| {
        let Some(del) = d.borrow().as_ref().cloned() else { return };
        del.ivars().compact.set(compact);

        // Switch the window toolbar style (Expanded = tall w/ centered title row;
        // UnifiedCompact = short single row).
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

        // Restyle the existing items in place (label text + image size).
        restyle_buttons(&del);

        // THE label-row toggle: displayMode. UnifiedCompact forces the toolbar to
        // IconOnly and switching back to Expanded does NOT restore it — so set it
        // explicitly. IconAndLabel turns the label row back on (#125).
        TOOLBAR.with(|t| {
            if let Some(tb) = t.borrow().as_ref() {
                tb.setDisplayMode(if compact {
                    NSToolbarDisplayMode::IconOnly
                } else {
                    NSToolbarDisplayMode::IconAndLabel
                });
                tb.validateVisibleItems();
            }
        });
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
    // Label row on by default (the label-row toggle set_compact drives). See #125.
    toolbar.setDisplayMode(NSToolbarDisplayMode::IconAndLabel);

    TOOLBAR.with(|t| *t.borrow_mut() = Some(toolbar));
    DELEGATE.with(|d| *d.borrow_mut() = Some(delegate));
}
