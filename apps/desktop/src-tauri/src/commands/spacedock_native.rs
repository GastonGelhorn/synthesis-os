//! spacedock_native.rs — Native macOS SpaceDock with NSVisualEffectView (withinWindow)
//!
//! Architecture:
//!   Layer 1 (bottom): WKWebView (Tauri's webview — renders workspace, cards, everything)
//!   Layer 2 (middle): NSVisualEffectView with .withinWindow blending — blurs webview content
//!   Layer 3 (top):    NSView container with NSButton icons for dock buttons
//!
//! Communication: Tauri commands ↔ React via invoke() and events

use objc2::msg_send;
use objc2::runtime::{AnyClass, AnyObject, Bool};
use objc2_foundation::{NSPoint, NSRect, NSSize};
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, Manager};

// ── State ──────────────────────────────────────────────────────

/// Stored view pointers (as usize for Send+Sync safety)
struct NativeDockState {
    glass_view: usize,
    container_view: usize,
    icon_views: Vec<usize>,
    active_space: String,
    is_visible: bool,
}

unsafe impl Send for NativeDockState {}
unsafe impl Sync for NativeDockState {}

static DOCK_STATE: Mutex<Option<NativeDockState>> = Mutex::new(None);

// ── Constants ──────────────────────────────────────────────────

const DOCK_LEFT: f64 = 24.0;
const DOCK_TOP: f64 = 80.0;
const DOCK_WIDTH: f64 = 64.0;
const DOCK_HEIGHT: f64 = 540.0;
const DOCK_CORNER_RADIUS: f64 = 24.0;

const BLENDING_BEHIND_WINDOW: isize = 0;
const BLENDING_WITHIN_WINDOW: isize = 1;

// NSVisualEffectMaterial
const MATERIAL_SELECTION: isize = 4; // .selection — dense, good for internal blur
                                     // NSVisualEffectState
const STATE_ACTIVE: isize = 1; // .active — always active regardless of window focus

// View Identifiers for Idempotency
const ID_GLASS: &str = "spacedock-glass";
const ID_CONTAINER: &str = "spacedock-container";

// NSWindowOrderingMode
const NS_WINDOW_ABOVE: isize = 1;

// ── Helpers ────────────────────────────────────────────────────

fn make_rect(x: f64, y: f64, w: f64, h: f64) -> NSRect {
    NSRect::new(NSPoint::new(x, y), NSSize::new(w, h))
}

/// Get NSWindow pointer from Tauri window
unsafe fn get_ns_window(app: &AppHandle) -> Result<*mut AnyObject, String> {
    let window = app
        .get_webview_window("main")
        .ok_or("No main window found")?;
    let ns_window = window
        .ns_window()
        .map_err(|e| format!("Failed to get NSWindow: {}", e))?;
    Ok(ns_window as *mut AnyObject)
}

/// Get the content view of the NSWindow
unsafe fn get_content_view(ns_window: *mut AnyObject) -> *mut AnyObject {
    msg_send![ns_window, contentView]
}

/// Convert top-left origin (web convention) to bottom-left origin (AppKit convention)
unsafe fn flip_rect(content_view: *mut AnyObject, x: f64, top: f64, w: f64, h: f64) -> NSRect {
    let frame: NSRect = msg_send![content_view, frame];
    let flipped_y = frame.size.height - top - h;
    make_rect(x, flipped_y, w, h)
}

/// Safely attempt to set the variant property on a view (for NSGlassEffectView)
unsafe fn try_set_variant(view: *mut AnyObject, variant: isize) {
    // Try private selector: set_variant:
    let sel_private = objc2::sel!(set_variant:);
    let responds_private: Bool = msg_send![view, respondsToSelector: sel_private];
    if responds_private.as_bool() {
        let _: () = msg_send![view, set_variant: variant];
        log::info!("[NativeDock] Set glass variant using set_variant:");
        return;
    }

    // Try public selector: setVariant:
    let sel_public = objc2::sel!(setVariant:);
    let responds_public: Bool = msg_send![view, respondsToSelector: sel_public];
    if responds_public.as_bool() {
        let _: () = msg_send![view, setVariant: variant];
        log::info!("[NativeDock] Set glass variant using setVariant:");
        return;
    }

    log::warn!("[NativeDock] NSGlassEffectView does not respond to set_variant: or setVariant:");
}

/// Create a glass effect view (NSGlassEffectView for macOS 15.1+, fallback to NSVisualEffectView)
unsafe fn create_glass_view(rect: NSRect) -> *mut AnyObject {
    // Try to get NSGlassEffectView (macOS 15.1+ / Tahoe)
    let glass_cls = AnyClass::get(c"NSGlassEffectView");

    let view: *mut AnyObject = if let Some(cls) = glass_cls {
        log::info!("[NativeDock] Using modern NSGlassEffectView");
        let alloc: *mut AnyObject = msg_send![cls, alloc];
        let view: *mut AnyObject = msg_send![alloc, initWithFrame: rect];

        // Configure for "Crystal Glass" look (V18) - Safe version
        let sel_blending = objc2::sel!(setBlendingMode:);
        if msg_send![view, respondsToSelector: sel_blending] {
            let _: () = msg_send![view, setBlendingMode: BLENDING_BEHIND_WINDOW];
        }

        // Private API: Set variant for "Liquid Glass" look
        try_set_variant(view, 2isize); // Dock variant (rich refraction)

        // Disable the white "fog" scrim
        let sel_scrim = objc2::sel!(set_scrimState:);
        if msg_send![view, respondsToSelector: sel_scrim] {
            let _: () = msg_send![view, set_scrimState: 0isize];
        }

        // Enhance refraction (lensing)
        let sel_lensing = objc2::sel!(set_contentLensing:);
        if msg_send![view, respondsToSelector: sel_lensing] {
            let _: () = msg_send![view, set_contentLensing: 2.0f64];
        }

        // Subdued state sometimes helps with transparency
        let sel_subdued = objc2::sel!(set_subduedState:);
        if msg_send![view, respondsToSelector: sel_subdued] {
            let _: () = msg_send![view, set_subduedState: 0isize];
        }

        // Subtle dark tint to ground the glass
        let ns_color = AnyClass::get(c"NSColor").expect("NSColor");
        let tint_color: *mut AnyObject =
            msg_send![ns_color, colorWithWhite: 0.0f64, alpha: 0.05f64];
        let sel_tint = objc2::sel!(setTintColor:);
        if msg_send![view, respondsToSelector: sel_tint] {
            let _: () = msg_send![view, setTintColor: tint_color];
        }
        view
    } else {
        log::info!("[NativeDock] Falling back to NSVisualEffectView");
        let cls = AnyClass::get(c"NSVisualEffectView").expect("NSVisualEffectView not found");
        let alloc: *mut AnyObject = msg_send![cls, alloc];
        let view: *mut AnyObject = msg_send![alloc, initWithFrame: rect];

        // Core visual effect configuration
        let _: () = msg_send![view, setBlendingMode: BLENDING_WITHIN_WINDOW];
        let _: () = msg_send![view, setMaterial: MATERIAL_SELECTION];
        let _: () = msg_send![view, setState: STATE_ACTIVE];
        view
    };

    // Common Configuration for Idempotency and Layering
    let ns_string_cls = AnyClass::get(c"NSString").expect("NSString");
    let id_str: *mut AnyObject = msg_send![ns_string_cls, stringWithUTF8String: ID_GLASS.as_ptr()];
    let _: () = msg_send![view, setIdentifier: id_str];

    let _: () = msg_send![view, setWantsLayer: Bool::YES];

    // Round corners and add "catch-blur" backing color (essential for consistent internal blur)
    let layer: *mut AnyObject = msg_send![view, layer];
    if !layer.is_null() {
        let _: () = msg_send![layer, setCornerRadius: DOCK_CORNER_RADIUS];
        let _: () = msg_send![layer, setMasksToBounds: Bool::YES];

        let ns_color = AnyClass::get(c"NSColor").expect("NSColor");
        let catch_color: *mut AnyObject =
            msg_send![ns_color, colorWithWhite: 0.0f64, alpha: 0.0f64]; // Transparent in V17 (let glass do the work)
        let catch_cg: *mut AnyObject = msg_send![catch_color, CGColor];
        let _: () = msg_send![layer, setBackgroundColor: catch_cg];
    }

    // Fixed position (no autoresizing)
    let _: () = msg_send![view, setAutoresizingMask: 0u64];

    view
}

/// Create a transparent overlay NSView for icon buttons
unsafe fn create_container_view(rect: NSRect) -> *mut AnyObject {
    let cls = AnyClass::get(c"NSView").expect("NSView class not found");
    let alloc: *mut AnyObject = msg_send![cls, alloc];
    let view: *mut AnyObject = msg_send![alloc, initWithFrame: rect];

    // Set identifier for idempotency
    let ns_string_cls = AnyClass::get(c"NSString").expect("NSString");
    let id_str: *mut AnyObject =
        msg_send![ns_string_cls, stringWithUTF8String: ID_CONTAINER.as_ptr()];
    let _: () = msg_send![view, setIdentifier: id_str];

    let _: () = msg_send![view, setWantsLayer: Bool::YES];

    let layer: *mut AnyObject = msg_send![view, layer];
    if !layer.is_null() {
        let _: () = msg_send![layer, setCornerRadius: DOCK_CORNER_RADIUS];
    }

    view
}

/// Create an SF Symbol icon button
unsafe fn create_icon_button(rect: NSRect, symbol_name: &str, tag: isize) -> *mut AnyObject {
    let cls = AnyClass::get(c"NSButton").expect("NSButton class not found");
    let alloc: *mut AnyObject = msg_send![cls, alloc];
    let btn: *mut AnyObject = msg_send![alloc, initWithFrame: rect];

    // Borderless transparent button
    let _: () = msg_send![btn, setBordered: Bool::NO];
    let _: () = msg_send![btn, setWantsLayer: Bool::YES];
    let _: () = msg_send![btn, setTag: tag];

    // Load SF Symbol image
    let ns_image_cls = AnyClass::get(c"NSImage").expect("NSImage class not found");
    let ns_string_cls = AnyClass::get(c"NSString").expect("NSString class not found");

    let sym_alloc: *mut AnyObject = msg_send![ns_string_cls, alloc];
    let sym_nsstr: *mut AnyObject = msg_send![
        sym_alloc,
        initWithBytes: symbol_name.as_ptr(),
        length: symbol_name.len(),
        encoding: 4usize // NSUTF8StringEncoding
    ];

    let image: *mut AnyObject = msg_send![
        ns_image_cls,
        imageWithSystemSymbolName: sym_nsstr,
        accessibilityDescription: std::ptr::null::<AnyObject>()
    ];

    if !image.is_null() {
        let _: () = msg_send![btn, setImage: image];
        let _: () = msg_send![btn, setImagePosition: 1isize]; // NSImageOnly

        // Symbol configuration for sizing
        let cfg_cls =
            AnyClass::get(c"NSImageSymbolConfiguration").expect("NSImageSymbolConfiguration");
        let cfg: *mut AnyObject =
            msg_send![cfg_cls, configurationWithPointSize: 16.0f64, weight: 0.0f64];
        let _: () = msg_send![btn, setSymbolConfiguration: cfg];
    }

    // Default tint: light grey for high contrast against glassy background (V17)
    let ns_color = AnyClass::get(c"NSColor").expect("NSColor");
    let tint: *mut AnyObject = msg_send![ns_color, colorWithWhite: 0.9f64, alpha: 1.0f64];
    let _: () = msg_send![btn, setContentTintColor: tint];

    btn
}

// ── Dock Item Definitions ──────────────────────────────────────

struct DockItem {
    symbol: &'static str,
    id: &'static str,
    tag: isize,
}

const SPACE_ITEMS: &[DockItem] = &[
    DockItem {
        symbol: "briefcase.fill",
        id: "work",
        tag: 100,
    },
    DockItem {
        symbol: "gamecontroller.fill",
        id: "entertainment",
        tag: 101,
    },
    DockItem {
        symbol: "flask.fill",
        id: "research",
        tag: 102,
    },
];

const SYSTEM_ITEMS: &[DockItem] = &[
    DockItem {
        symbol: "message.fill",
        id: "chat",
        tag: 200,
    },
    DockItem {
        symbol: "clock.arrow.circlepath",
        id: "recall",
        tag: 201,
    },
    DockItem {
        symbol: "gearshape.fill",
        id: "settings",
        tag: 202,
    },
    DockItem {
        symbol: "cpu",
        id: "hud",
        tag: 203,
    },
];

// ── Tauri Commands ─────────────────────────────────────────────

#[tauri::command]
pub fn create_native_dock(app: AppHandle) -> Result<(), String> {
    log::info!("[NativeDock] Creating native SpaceDock...");

    let app_clone = app.clone();
    let window = app.get_webview_window("main").ok_or("No main window")?;

    window
        .run_on_main_thread(move || {
            unsafe {
                let ns_window = match get_ns_window(&app_clone) {
                    Ok(w) => w,
                    Err(e) => {
                        log::error!("[NativeDock] {}", e);
                        return;
                    }
                };

                let content_view = get_content_view(ns_window);
                if content_view.is_null() {
                    log::error!("[NativeDock] contentView is null");
                    return;
                }

                // 1. Robust Idempotency: Remove any views with our identifiers
                let subviews: *mut AnyObject = msg_send![content_view, subviews];
                let count: usize = msg_send![subviews, count];

                let ns_string_cls = AnyClass::get(c"NSString").expect("NSString");
                let id_glass_ns: *mut AnyObject =
                    msg_send![ns_string_cls, stringWithUTF8String: ID_GLASS.as_ptr()];
                let id_cont_ns: *mut AnyObject =
                    msg_send![ns_string_cls, stringWithUTF8String: ID_CONTAINER.as_ptr()];

                for i in (0..count).rev() {
                    let subview: *mut AnyObject = msg_send![subviews, objectAtIndex: i];
                    let id: *mut AnyObject = msg_send![subview, identifier];

                    if !id.is_null() {
                        let is_glass: bool = msg_send![id, isEqualToString: id_glass_ns];
                        let is_cont: bool = msg_send![id, isEqualToString: id_cont_ns];

                        if is_glass || is_cont {
                            let _: () = msg_send![subview, removeFromSuperview];
                            log::info!("[NativeDock] Removed orphaned view with identifier");
                        }
                    }
                }

                // Clean up global state if syncing with manual removal
                {
                    let mut state = DOCK_STATE.lock().unwrap();
                    *state = None;
                }

                // Convert CSS coords (top-left origin) → AppKit coords (bottom-left origin)
                let rect = flip_rect(content_view, DOCK_LEFT, DOCK_TOP, DOCK_WIDTH, DOCK_HEIGHT);

                // Layer 2: NSVisualEffectView — glass that blurs webview content
                let glass = create_glass_view(rect);

                // Layer 3: Transparent container for icon buttons
                let container = create_container_view(rect);

                // ── Layout icon buttons inside container ──
                let padding: f64 = 12.0;
                let icon_sz: f64 = 40.0;
                let gap: f64 = 12.0;
                let icon_x = (DOCK_WIDTH - icon_sz) / 2.0;

                let mut icon_views: Vec<usize> = Vec::new();
                // AppKit y is bottom-up, so start from the TOP of the container
                let mut cy = DOCK_HEIGHT - padding - icon_sz;

                // Space buttons: Work, Play, Research
                for item in SPACE_ITEMS {
                    let r = make_rect(icon_x, cy, icon_sz, icon_sz);
                    let btn = create_icon_button(r, item.symbol, item.tag);
                    let _: () = msg_send![container, addSubview: btn];
                    icon_views.push(btn as usize);
                    cy -= icon_sz + gap;
                }

                // Divider gap
                cy -= 8.0;

                // Context tools area — reserved, dynamic later
                cy -= (icon_sz + gap) * 3.0;

                // Divider gap
                cy -= 8.0;

                // System buttons: Chat, Recall, Settings, HUD
                for item in SYSTEM_ITEMS {
                    let r = make_rect(icon_x, cy, icon_sz, icon_sz);
                    let btn = create_icon_button(r, item.symbol, item.tag);
                    let _: () = msg_send![container, addSubview: btn];
                    icon_views.push(btn as usize);
                    cy -= icon_sz + gap;
                }

                // Insert into view hierarchy:
                //   webview (existing) → glass (above) → container (above glass)

                // Find the webview to ensure we stay above it
                let mut webview_ptr: *mut AnyObject = std::ptr::null_mut();
                let subviews: *mut AnyObject = msg_send![content_view, subviews];
                let count: usize = msg_send![subviews, count];

                for i in 0..count {
                    let subview: *mut AnyObject = msg_send![subviews, objectAtIndex: i];

                    // Safely get the class name as an NSString
                    let class_name: *mut AnyObject = msg_send![subview, className];
                    if !class_name.is_null() {
                        let name_ptr: *const i8 = msg_send![class_name, UTF8String];
                        if !name_ptr.is_null() {
                            let name_str = std::ffi::CStr::from_ptr(name_ptr).to_string_lossy();
                            if name_str.contains("WebView") {
                                // Catches WKWebView or WryWebView
                                webview_ptr = subview;
                                break;
                            }
                        }
                    }
                }

                // Add glass directly above the webview if found, else just add at top
                let relative_to = if webview_ptr.is_null() {
                    std::ptr::null_mut()
                } else {
                    webview_ptr
                };

                let _: () = msg_send![
                    content_view,
                    addSubview: glass,
                    positioned: NS_WINDOW_ABOVE,
                    relativeTo: relative_to
                ];
                let _: () = msg_send![
                    content_view,
                    addSubview: container,
                    positioned: NS_WINDOW_ABOVE,
                    relativeTo: glass
                ];

                // Persist state
                let mut state = DOCK_STATE.lock().unwrap();
                *state = Some(NativeDockState {
                    glass_view: glass as usize,
                    container_view: container as usize,
                    icon_views,
                    active_space: "work".to_string(),
                    is_visible: true,
                });

                log::info!(
                    "[NativeDock] Created — rect({:.0},{:.0},{:.0},{:.0})",
                    rect.origin.x,
                    rect.origin.y,
                    rect.size.width,
                    rect.size.height
                );

                let _ = app_clone.emit("native-dock-ready", true);
            }
        })
        .map_err(|e| format!("Failed to run on main thread: {}", e))?;

    Ok(())
}

#[tauri::command]
pub fn destroy_native_dock(app: AppHandle) -> Result<(), String> {
    log::info!("[NativeDock] Destroying native dock...");

    let window = app.get_webview_window("main").ok_or("No main window")?;

    window
        .run_on_main_thread(move || {
            let mut state = DOCK_STATE.lock().unwrap();
            if let Some(dock) = state.take() {
                unsafe {
                    let glass = dock.glass_view as *mut AnyObject;
                    let container = dock.container_view as *mut AnyObject;
                    let _: () = msg_send![container, removeFromSuperview];
                    let _: () = msg_send![glass, removeFromSuperview];
                }
                log::info!("[NativeDock] Destroyed");
            }
        })
        .map_err(|e| format!("Failed to run on main thread: {}", e))?;

    Ok(())
}

#[tauri::command]
pub fn set_native_dock_visible(visible: bool, app: AppHandle) -> Result<(), String> {
    let window = app.get_webview_window("main").ok_or("No main window")?;

    window
        .run_on_main_thread(move || {
            let mut state = DOCK_STATE.lock().unwrap();
            if let Some(dock) = state.as_mut() {
                unsafe {
                    let hidden = if visible { Bool::NO } else { Bool::YES };
                    let glass = dock.glass_view as *mut AnyObject;
                    let container = dock.container_view as *mut AnyObject;
                    let _: () = msg_send![glass, setHidden: hidden];
                    let _: () = msg_send![container, setHidden: hidden];
                }
                dock.is_visible = visible;
            }
        })
        .map_err(|e| format!("Failed to run on main thread: {}", e))?;

    Ok(())
}

#[tauri::command]
pub fn update_native_dock_active_space(space_id: String, app: AppHandle) -> Result<(), String> {
    let window = app.get_webview_window("main").ok_or("No main window")?;

    window
        .run_on_main_thread(move || {
            let mut state = DOCK_STATE.lock().unwrap();
            if let Some(dock) = state.as_mut() {
                dock.active_space = space_id.clone();

                unsafe {
                    let ns_color = AnyClass::get(c"NSColor").expect("NSColor");

                    for (i, item) in SPACE_ITEMS.iter().enumerate() {
                        if i >= dock.icon_views.len() {
                            break;
                        }
                        let btn = dock.icon_views[i] as *mut AnyObject;

                        let (r, g, b): (f64, f64, f64) = if item.id == space_id {
                            match item.id {
                                "work" => (0.376, 0.647, 0.98),           // #60a5fa
                                "entertainment" => (0.957, 0.447, 0.718), // #f472b6
                                "research" => (0.204, 0.827, 0.6),        // #34d399
                                _ => (1.0, 1.0, 1.0),
                            }
                        } else {
                            (0.4, 0.4, 0.4) // Darkened inactive icons for visibility
                        };

                        let color: *mut AnyObject = msg_send![
                            ns_color,
                            colorWithRed: r,
                            green: g,
                            blue: b,
                            alpha: 1.0f64
                        ];
                        let _: () = msg_send![btn, setContentTintColor: color];
                    }
                }

                log::info!("[NativeDock] Active space → {}", space_id);
            }
        })
        .map_err(|e| format!("Failed to run on main thread: {}", e))?;

    Ok(())
}

#[tauri::command]
pub fn is_native_dock_active() -> bool {
    DOCK_STATE.lock().unwrap().is_some()
}

/// Reposition the dock on window resize
#[tauri::command]
pub fn reposition_native_dock(app: AppHandle) -> Result<(), String> {
    let window = app.get_webview_window("main").ok_or("No main window")?;

    let app_clone = app.clone();
    window
        .run_on_main_thread(move || {
            let state = DOCK_STATE.lock().unwrap();
            if let Some(dock) = state.as_ref() {
                unsafe {
                    let ns_window = match get_ns_window(&app_clone) {
                        Ok(w) => w,
                        Err(_) => return,
                    };
                    let content_view = get_content_view(ns_window);
                    let rect =
                        flip_rect(content_view, DOCK_LEFT, DOCK_TOP, DOCK_WIDTH, DOCK_HEIGHT);

                    let glass = dock.glass_view as *mut AnyObject;
                    let container = dock.container_view as *mut AnyObject;
                    let _: () = msg_send![glass, setFrame: rect];
                    let _: () = msg_send![container, setFrame: rect];
                }
            }
        })
        .map_err(|e| format!("Failed to run on main thread: {}", e))?;

    Ok(())
}
