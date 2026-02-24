use tauri::{LogicalPosition, LogicalSize, Manager, Position, Size};

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

      let window = app.get_webview_window("main").expect("main window not found");
      let target_w = 420.0;
      let target_h = 620.0;

      let _ = window.set_size(Size::Logical(LogicalSize::new(target_w, target_h)));
      let _ = window.set_always_on_top(true);

      if let Some(monitor) = window.current_monitor()? {
        let m_pos = monitor.position();
        let m_size = monitor.size();
        let x = m_pos.x as f64 + (m_size.width as f64 - target_w - 24.0);
        let y = m_pos.y as f64 + (m_size.height as f64 - target_h - 56.0);
        let _ = window.set_position(Position::Logical(LogicalPosition::new(x, y)));
      }

      Ok(())
    })
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
