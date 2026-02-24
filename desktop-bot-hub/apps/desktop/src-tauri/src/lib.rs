use tauri::{
  LogicalPosition, Manager, Position, WindowEvent,
  tray::{MouseButton, TrayIconBuilder, TrayIconEvent},
};
use tauri::menu::{Menu, MenuItem};

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

fn hide_all_windows(app_handle: &tauri::AppHandle) {
  for label in ["character", "bubble"] {
    if let Some(window) = app_handle.get_webview_window(label) {
      let _ = window.hide();
    }
  }
}

fn show_character_only(app_handle: &tauri::AppHandle) {
  if let Some(character) = app_handle.get_webview_window("character") {
    let _ = character.show();
    let _ = character.set_focus();
  }
  if let Some(bubble) = app_handle.get_webview_window("bubble") {
    let _ = bubble.hide();
  }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .setup(|app| {
      if cfg!(debug_assertions) {
        app.handle().plugin(
          tauri_plugin_log::Builder::default()
            .level(log::LevelFilter::Info)
            .build(),
        )?;
      }

      if let Some(character) = app.get_webview_window("character") {
        let _ = character.set_always_on_top(true);
        let _ = character.set_decorations(false);
      }

      if let Some(bubble) = app.get_webview_window("bubble") {
        let _ = bubble.set_always_on_top(true);
        let _ = bubble.set_decorations(false);
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
        .on_menu_event(|app, event| {
          match event.id() {
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
          }
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
    .invoke_handler(tauri::generate_handler![move_window, set_window_visible])
    .on_window_event(|window, event| {
      if let WindowEvent::CloseRequested { api, .. } = event {
        api.prevent_close();
        let app_handle = window.app_handle();
        hide_all_windows(&app_handle);
      }
    })
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
