// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod daemon_supervisor;
mod parquet_query;

use daemon_supervisor::DaemonSupervisor;
use std::sync::Mutex;
use tauri::Manager;

fn main() {
    let supervisor = DaemonSupervisor::new(
        "/tmp/amstal.sock".to_string(),
        "127.0.0.1".to_string(),
        8194,
    );

    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .manage(Mutex::new(supervisor))
        .setup(|app| {
            // Automatically launch Amstal quantitative engine daemon on terminal startup
            let state = app.state::<Mutex<DaemonSupervisor>>();
            if let Ok(mut sup) = state.lock() {
                match sup.start() {
                    Ok(msg) => println!("[INFO] Engine Daemon auto-start: {}", msg),
                    Err(e) => eprintln!("[WARN] Engine Daemon auto-start note: {}", e),
                }
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            daemon_supervisor::check_engine_status,
            daemon_supervisor::start_engine,
            daemon_supervisor::stop_engine,
            daemon_supervisor::restart_engine,
            parquet_query::query_parquet,
            parquet_query::get_lakehouse_stats,
        ])
        .build(tauri::generate_context!())
        .expect("error while building amstal-terminal")
        .run(|app_handle, event| {
            if let tauri::RunEvent::Exit = event {
                // Gracefully terminate managed engine child process when terminal exits
                if let Some(state) = app_handle.try_state::<Mutex<DaemonSupervisor>>() {
                    if let Ok(mut sup) = state.lock() {
                        let _ = sup.stop();
                    }
                }
            }
        });
}
