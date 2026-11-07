// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod daemon_supervisor;
mod keyboard;
mod parquet_query;

use daemon_supervisor::DaemonSupervisor;
use std::sync::Mutex;

fn main() {
    let supervisor = DaemonSupervisor::new(
        "/tmp/amstal.sock".to_string(),
        "127.0.0.1".to_string(),
        8194,
    );

    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .manage(Mutex::new(supervisor))
        .invoke_handler(tauri::generate_handler![
            daemon_supervisor::check_engine_status,
            daemon_supervisor::start_engine,
            daemon_supervisor::stop_engine,
            daemon_supervisor::restart_engine,
            parquet_query::query_parquet,
            parquet_query::get_lakehouse_stats,
            keyboard::get_starboard_layout,
            keyboard::process_hardware_macro,
        ])
        .run(tauri::generate_context!())
        .expect("error while running amstal-terminal");
}
