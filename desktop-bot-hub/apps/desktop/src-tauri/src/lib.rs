use std::collections::{HashMap, HashSet};
use std::sync::Mutex;
use std::thread;
use std::time::Duration;
use tauri::menu::{Menu, MenuItem};
use tauri::{
  LogicalPosition, LogicalSize, Manager, Position, Size, State, WebviewUrl,
  WebviewWindowBuilder, WindowEvent,
  tray::{MouseButton, TrayIconBuilder, TrayIconEvent},
};

#[derive(Default)]
struct BubbleFollowState {
  anchors: Mutex<HashMap<String, String>>,      // bubble_label -> anchor_label
  offsets: Mutex<HashMap<String, (f64, f64)>>,  // bubble_label -> (dx, dy)
  anchor_sizes: Mutex<HashMap<String, (f64, f64)>>, // bubble_label -> (anchor_w, anchor_h)
}

const DEFAULT_CHARACTER_WINDOW_WIDTH: f64 = 362.0;
const DEFAULT_CHARACTER_WINDOW_HEIGHT: f64 = 276.0;
const MIN_CHARACTER_WINDOW_WIDTH: f64 = 220.0;
const MIN_CHARACTER_WINDOW_HEIGHT: f64 = 180.0;

fn is_character_label(label: &str) -> bool {
  label == "character" || label.starts_with("character-")
}

fn is_bubble_label(label: &str) -> bool {
  label == "bubble" || label.starts_with("bubble-")
}

fn bubble_label_for_character(character_id: &str) -> String {
  format!("bubble-{character_id}")
}

fn resolve_bubble_and_anchor_position(
  app_handle: &tauri::AppHandle,
  bubble_label: &str,
  anchor_label: &str,
  anchor_size: Option<(f64, f64)>,
) -> Option<(LogicalPosition<f64>, LogicalPosition<f64>)> {
  let Some(character) = app_handle
    .get_webview_window(anchor_label)
    .or_else(|| app_handle.get_webview_window("character"))
  else {
    return None;
  };
  let Some(bubble) = app_handle.get_webview_window(bubble_label) else {
    return None;
  };

  let Ok(char_pos_physical) = character.outer_position() else {
    return None;
  };
  let Ok(char_size_physical) = character.outer_size() else {
    return None;
  };
  let Ok(bubble_size_physical) = bubble.outer_size() else {
    return None;
  };

  let margin = 12_i32;
  let gap = -10.0_f64;
  let scale = character.scale_factor().unwrap_or(1.0);
  let char_pos = char_pos_physical.to_logical::<f64>(scale);
  let char_w = char_size_physical.width as f64 / scale;
  let char_h = char_size_physical.height as f64 / scale;
  let measured_bubble_w = bubble_size_physical.width as f64 / scale;
  let measured_bubble_h = bubble_size_physical.height as f64 / scale;
  // On some macOS states, hidden windows can transiently report near-zero size.
  let bubble_w = if measured_bubble_w < 100.0 {
    360.0
  } else {
    measured_bubble_w
  };
  let bubble_h = if measured_bubble_h < 100.0 {
    520.0
  } else {
    measured_bubble_h
  };
  let char_left = char_pos.x;
  let char_top = char_pos.y;
  let char_right = char_left + char_w;
  let char_bottom = char_top + char_h;

  let monitor = character
    .current_monitor()
    .ok()
    .flatten()
    .or_else(|| app_handle.primary_monitor().ok().flatten());

  let (min_x, min_y, max_x, max_y): (f64, f64, f64, f64) = if let Some(m) = monitor {
    let m_scale = m.scale_factor();
    let m_pos = m.position().to_logical::<f64>(m_scale);
    let m_size = m.size();
    (
      m_pos.x + margin as f64,
      m_pos.y + margin as f64,
      m_pos.x + m_size.width as f64 / m_scale - bubble_w - margin as f64,
      m_pos.y + m_size.height as f64 / m_scale - bubble_h - margin as f64,
    )
  } else {
    (
      char_left - bubble_w * 3.0,
      char_top - bubble_h * 3.0,
      char_right + bubble_w * 3.0,
      char_bottom + bubble_h * 3.0,
    )
  };

  let clamp_xy = |x: f64, y: f64| {
    (
      x.clamp(min_x, max_x.max(min_x)),
      y.clamp(min_y, max_y.max(min_y)),
    )
  };
  let (anchor_w, anchor_h) = match anchor_size {
    Some((w, h)) if w.is_finite() && h.is_finite() && w > 0.0 && h > 0.0 => {
      (w.min(char_w).max(24.0), h.min(char_h).max(24.0))
    }
    _ => (char_w.min(92.0), char_h.min(92.0)),
  };
  let anchor_x = char_left + ((char_w - anchor_w) / 2.0).max(0.0);
  let anchor_y = char_top + (char_h - anchor_h - 6.0).max(0.0);

  let center_y = anchor_y + (anchor_h - bubble_h) / 2.0;
  let right_x = anchor_x + anchor_w + gap;
  let left_x = anchor_x - bubble_w - gap;
  let max_left = max_x.max(min_x);

  // Default right-side placement; flip to left if it would overflow.
  let mut bubble_x = right_x;
  if bubble_x > max_left {
    bubble_x = left_x;
  }
  bubble_x = bubble_x.clamp(min_x, max_left);

  let (_, bubble_y) = clamp_xy(bubble_x, center_y);

  Some((
    LogicalPosition {
      x: char_pos.x,
      y: char_pos.y,
    },
    LogicalPosition {
      x: bubble_x.round(),
      y: bubble_y.round(),
    },
  ))
}

fn ensure_bubble_window(
  app_handle: &tauri::AppHandle,
  bubble_label: &str,
  character_id: &str,
) -> Option<tauri::WebviewWindow> {
  if let Some(window) = app_handle.get_webview_window(bubble_label) {
    return Some(window);
  }

  let url = format!(
    "index.html?mode=bubble&characterId={character_id}&bubbleLabel={bubble_label}"
  );

  let window = WebviewWindowBuilder::new(app_handle, bubble_label, WebviewUrl::App(url.into()))
    .title("OpenClaw Bubble")
    .inner_size(360.0, 520.0)
    .resizable(false)
    .decorations(false)
    .transparent(true)
    .accept_first_mouse(true)
    .skip_taskbar(true)
    .always_on_top(true)
    .build()
    .ok()?;

  let _ = window.hide();
  Some(window)
}

fn hide_all_windows(app_handle: &tauri::AppHandle) {
  for (label, window) in app_handle.webview_windows() {
    if is_character_label(&label) || is_bubble_label(&label) {
      let _ = window.hide();
    }
  }
}

fn show_character_only(app_handle: &tauri::AppHandle) {
  for (label, window) in app_handle.webview_windows() {
    if is_character_label(&label) {
      let _ = window.show();
    }
    if is_bubble_label(&label) {
      let _ = window.hide();
    }
  }

  if let Some(character) = app_handle.get_webview_window("character") {
    let _ = character.set_focus();
  }
}

fn start_bubble_follow_loop(app_handle: tauri::AppHandle) {
  thread::spawn(move || {
    loop {
      let state = app_handle.state::<BubbleFollowState>();
      let anchors = state
        .anchors
        .lock()
        .ok()
        .map(|m| m.clone())
        .unwrap_or_default();
      let anchor_sizes = state
        .anchor_sizes
        .lock()
        .ok()
        .map(|m| m.clone())
        .unwrap_or_default();

      for (bubble_label, anchor_label) in anchors {
        let Some(bubble_window) = app_handle.get_webview_window(&bubble_label) else {
          continue;
        };

        if bubble_window.is_visible().ok() != Some(true) {
          continue;
        }

        let size = anchor_sizes.get(&bubble_label).copied();
        if let Some((anchor_pos, bubble_pos)) =
          resolve_bubble_and_anchor_position(&app_handle, &bubble_label, &anchor_label, size)
        {
          let _ = bubble_window.set_position(Position::Logical(bubble_pos));

          if let Ok(mut offsets) = state.offsets.lock() {
            offsets.insert(
              bubble_label.clone(),
              (bubble_pos.x - anchor_pos.x, bubble_pos.y - anchor_pos.y),
            );
          }
        }
      }

      thread::sleep(Duration::from_millis(16));
    }
  });
}

#[tauri::command]
fn move_window(app_handle: tauri::AppHandle, label: String, x: f64, y: f64) {
  if let Some(window) = app_handle.get_webview_window(&label) {
    let _ = window.set_position(Position::Logical(LogicalPosition { x, y }));
  }
}

#[tauri::command]
fn set_window_visible(app_handle: tauri::AppHandle, label: String, visible: bool) {
  if let Some(window) = app_handle.get_webview_window(&label) {
    if visible {
      let _ = window.show();
      let _ = window.set_focus();
    } else {
      let _ = window.hide();
    }
  }
}

#[tauri::command]
fn start_window_drag(app_handle: tauri::AppHandle, label: String) {
  if let Some(window) = app_handle.get_webview_window(&label) {
    let _ = window.start_dragging();
  }
}

#[tauri::command]
fn set_window_size(app_handle: tauri::AppHandle, label: String, width: f64, height: f64) {
  let bounded_width = width.clamp(MIN_CHARACTER_WINDOW_WIDTH, 1280.0);
  let bounded_height = height.clamp(MIN_CHARACTER_WINDOW_HEIGHT, 1280.0);

  if let Some(window) = app_handle.get_webview_window(&label) {
    let _ = window.set_size(Size::Logical(LogicalSize {
      width: bounded_width,
      height: bounded_height,
    }));
  }
}

#[tauri::command]
fn sync_character_windows(
  app_handle: tauri::AppHandle,
  character_ids: Vec<String>,
  primary_character_id: String,
  follow_state: State<'_, BubbleFollowState>,
) {
  let desired_labels: HashSet<String> = character_ids
    .iter()
    .filter(|id| *id != &primary_character_id)
    .map(|id| format!("character-{id}"))
    .collect();

  for (label, window) in app_handle.webview_windows() {
    if label.starts_with("character-") && !desired_labels.contains(&label) {
      let _ = window.close();

      let bubble_label = label.replacen("character-", "bubble-", 1);
      if let Some(bubble) = app_handle.get_webview_window(&bubble_label) {
        let _ = bubble.close();
      }

      if let Ok(mut anchors) = follow_state.anchors.lock() {
        anchors.remove(&bubble_label);
      }
      if let Ok(mut offsets) = follow_state.offsets.lock() {
        offsets.remove(&bubble_label);
      }
      if let Ok(mut sizes) = follow_state.anchor_sizes.lock() {
        sizes.remove(&bubble_label);
      }
    }
  }

  for (index, character_id) in character_ids.iter().enumerate() {
    if character_id == &primary_character_id {
      continue;
    }

    let label = format!("character-{character_id}");
    if app_handle.get_webview_window(&label).is_some() {
      continue;
    }

    let url = format!(
      "index.html?mode=character&characterId={character_id}&label={label}&index={index}"
    );

    let _ = WebviewWindowBuilder::new(&app_handle, label, WebviewUrl::App(url.into()))
      .title("OpenClaw Character")
      .inner_size(DEFAULT_CHARACTER_WINDOW_WIDTH, DEFAULT_CHARACTER_WINDOW_HEIGHT)
      .resizable(false)
      .decorations(false)
      .transparent(true)
      .accept_first_mouse(true)
      .skip_taskbar(true)
      .always_on_top(true)
      .build();
  }
}

#[tauri::command]
fn open_character_bubble(
  app_handle: tauri::AppHandle,
  anchor_label: String,
  character_id: String,
  anchor_width: Option<f64>,
  anchor_height: Option<f64>,
  follow_state: State<'_, BubbleFollowState>,
) {
  let bubble_label = bubble_label_for_character(&character_id);
  let Some(bubble) = ensure_bubble_window(&app_handle, &bubble_label, &character_id) else {
    return;
  };
  let anchor_size = match (anchor_width, anchor_height) {
    (Some(w), Some(h)) if w.is_finite() && h.is_finite() && w > 0.0 && h > 0.0 => Some((w, h)),
    _ => None,
  };

  if let Some(size) = anchor_size {
    if let Ok(mut sizes) = follow_state.anchor_sizes.lock() {
      sizes.insert(bubble_label.clone(), size);
    }
  }

  if let Some((anchor_pos, bubble_pos)) =
    resolve_bubble_and_anchor_position(&app_handle, &bubble_label, &anchor_label, anchor_size)
  {
    if let Ok(mut anchors) = follow_state.anchors.lock() {
      anchors.insert(bubble_label.clone(), anchor_label);
    }
    if let Ok(mut offsets) = follow_state.offsets.lock() {
      offsets.insert(
        bubble_label.clone(),
        (bubble_pos.x - anchor_pos.x, bubble_pos.y - anchor_pos.y),
      );
    }
    let _ = bubble.set_position(Position::Logical(bubble_pos));
  }

  let _ = bubble.show();
  let _ = bubble.set_focus();
}

#[tauri::command]
fn toggle_character_bubble(
  app_handle: tauri::AppHandle,
  anchor_label: String,
  character_id: String,
  anchor_width: Option<f64>,
  anchor_height: Option<f64>,
  follow_state: State<'_, BubbleFollowState>,
) {
  let bubble_label = bubble_label_for_character(&character_id);
  if let Some(bubble) = app_handle.get_webview_window(&bubble_label) {
    if bubble.is_visible().ok() == Some(true) {
      let _ = bubble.hide();
      return;
    }
  }

  open_character_bubble(
    app_handle,
    anchor_label,
    character_id,
    anchor_width,
    anchor_height,
    follow_state,
  );
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .manage(BubbleFollowState::default())
    .setup(|app| {
      if cfg!(debug_assertions) {
        app.handle().plugin(
          tauri_plugin_log::Builder::default()
            .level(log::LevelFilter::Info)
            .build(),
        )?;
      }

      start_bubble_follow_loop(app.handle().clone());

      if let Some(character) = app.get_webview_window("character") {
        let _ = character.set_always_on_top(true);
        let _ = character.set_decorations(false);
        let _ = character.set_size(Size::Logical(LogicalSize {
          width: DEFAULT_CHARACTER_WINDOW_WIDTH,
          height: DEFAULT_CHARACTER_WINDOW_HEIGHT,
        }));
      }

      if let Some(bubble) = app.get_webview_window("bubble") {
        let _ = bubble.hide();
      }

      let tray_menu = Menu::with_items(
        app,
        &[
          &MenuItem::with_id(app, "open", "Open", true, None::<&str>)?,
          &MenuItem::with_id(app, "hide", "Hide", true, None::<&str>)?,
          &MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?,
        ],
      )?;

      let mut tray_builder = TrayIconBuilder::new()
        .tooltip("OpenClaw")
        .show_menu_on_left_click(false)
        .menu(&tray_menu)
        .on_menu_event(|app, event| match event.id() {
          id if id == "open" => {
            show_character_only(&app);
          }
          id if id == "hide" => {
            hide_all_windows(&app);
          }
          id if id == "quit" => {
            app.exit(0);
          }
          _ => {}
        })
        .on_tray_icon_event(|tray, event| {
          let is_left_click = matches!(
            event,
            TrayIconEvent::DoubleClick { .. }
              | TrayIconEvent::Click {
                button: MouseButton::Left,
                ..
              }
          );

          if !is_left_click {
            return;
          }

          if let Some(character) = tray.app_handle().get_webview_window("character") {
            if let Ok(visible) = character.is_visible() {
              if visible {
                hide_all_windows(&tray.app_handle());
              } else {
                show_character_only(&tray.app_handle());
              }
            }
          }
        });

      if let Some(icon) = app.default_window_icon().cloned() {
        tray_builder = tray_builder.icon(icon);
      }

      let _tray = tray_builder.build(app)?;

      if let Some(character) = app.get_webview_window("character") {
        let _ = character.show();
      }

      Ok(())
    })
    .invoke_handler(tauri::generate_handler![
      move_window,
      set_window_visible,
      start_window_drag,
      set_window_size,
      sync_character_windows,
      open_character_bubble,
      toggle_character_bubble
    ])
    .on_window_event(|window, event| match event {
      WindowEvent::CloseRequested { api, .. } => {
        api.prevent_close();
        let label = window.label();
        if is_bubble_label(label) {
          let _ = window.hide();
        } else {
          let app_handle = window.app_handle();
          hide_all_windows(&app_handle);
        }
      }
      WindowEvent::Moved(_) => {
        let label = window.label();
        if !is_character_label(label) {
          return;
        }

        let app_handle = window.app_handle();
        let state = app_handle.state::<BubbleFollowState>();
        let anchors = state
          .anchors
          .lock()
          .ok()
          .map(|m| m.clone())
          .unwrap_or_default();
        let anchor_sizes = state
          .anchor_sizes
          .lock()
          .ok()
          .map(|m| m.clone())
          .unwrap_or_default();

        for (bubble_label, anchor_label) in anchors {
          if anchor_label != label {
            continue;
          }

          let Some(bubble) = app_handle.get_webview_window(&bubble_label) else {
            continue;
          };
          if bubble.is_visible().ok() != Some(true) {
            continue;
          }

          let size = anchor_sizes.get(&bubble_label).copied();
          if let Some((anchor_pos, bubble_pos)) =
            resolve_bubble_and_anchor_position(&app_handle, &bubble_label, &anchor_label, size)
          {
            let _ = bubble.set_position(Position::Logical(bubble_pos));
            if let Ok(mut offsets) = state.offsets.lock() {
              offsets.insert(
                bubble_label.clone(),
                (bubble_pos.x - anchor_pos.x, bubble_pos.y - anchor_pos.y),
              );
            }
          }
        }
      }
      _ => {}
    })
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
