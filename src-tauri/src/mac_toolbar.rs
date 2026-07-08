//! Native macOS NSToolbar for the main window (unified titlebar material). Each
//! toolbar item posts a Rust→JS `toolbar:action` event; the frontend
//! (`src/lib/toolbarActions.ts` `dispatchToolbarAction`) then runs the SAME
//! action as the HTML toolbar button, so the two never drift.
//!
//! SPIKE — behind the `mac-toolbar` cargo feature (off by default). Authored in
//! the Linux dev container, which has no macOS compiler, so a Mac build pass is
//! expected: the objc2 `define_class!` details (ivars, method signatures,
//! `target`/`action`, retaining the delegate, the exact `NSImage` /
//! `setToolbarStyle` symbols) are the parts most likely to need a small tweak.
//! Feature-gating means any such error can't break the default build. Build +
//! iterate with `bash tools/mac-build.sh --toolbar`. See docs/mac-smoke.md §B.

use objc2::rc::Retained;
use objc2::runtime::ProtocolObject;
use objc2::{define_class, msg_send, sel, DefinedClass, MainThreadMarker, MainThreadOnly};
use objc2_app_kit::{
    NSImage, NSToolbar, NSToolbarDelegate, NSToolbarItem, NSWindow, NSWindowToolbarStyle,
};
use objc2_foundation::{NSArray, NSObjectProtocol, NSString};
use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager};

#[derive(Clone, Serialize)]
struct ToolbarPayload {
    id: String,
}

/// (identifier, visible label, SF Symbol name) per toolbar item. The identifier
/// is exactly the id the frontend's dispatchToolbarAction expects.
const ITEMS: &[(&str, &str, &str)] = &[
    ("add-slide", "Add Slide", "plus.rectangle"),
    ("add-build", "Add Build", "plus.square.on.square"),
    ("present", "Present", "play.fill"),
    ("save", "Save", "square.and.arrow.down"),
];

fn identifiers() -> Retained<NSArray<NSString>> {
    let ids: Vec<Retained<NSString>> = ITEMS.iter().map(|(id, _, _)| NSString::from_str(id)).collect();
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
            // `self` is MainThreadOnly, so we're provably on the main thread.
            let mtm = self.mtm();
            let item = unsafe {
                NSToolbarItem::initWithItemIdentifier(NSToolbarItem::alloc(mtm), identifier)
            };
            if let Some((label, symbol)) = meta_for(identifier) {
                let ns_label = NSString::from_str(label);
                unsafe {
                    item.setLabel(&ns_label);
                    item.setPaletteLabel(&ns_label);
                    if let Some(image) = NSImage::imageWithSystemSymbolName_accessibilityDescription(
                        &NSString::from_str(symbol),
                        Some(&ns_label),
                    ) {
                        item.setImage(Some(&image));
                    }
                    // Coerce &ToolbarDelegate → &AnyObject (deref chain) for the
                    // target/action click callback.
                    let target: &objc2::runtime::AnyObject = self;
                    item.setTarget(Some(target));
                    item.setAction(Some(sel!(onItem:)));
                }
            }
            Some(item)
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
        let this = Self::alloc(mtm).set_ivars(Ivars { app });
        unsafe { msg_send![super(this), init] }
    }
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
    // Unified titlebar material (macOS 11+); keeps the title centered.
    ns_win.setToolbarStyle(NSWindowToolbarStyle::Unified);
    // NSToolbar's delegate ref is weak and the class is MainThreadOnly (so it
    // can't live in a Sync static). It's a per-app singleton on the main thread,
    // so leak it to keep it alive for the process lifetime.
    std::mem::forget(delegate);
}
