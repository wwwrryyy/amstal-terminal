//! Daemon Supervisor Module for Amstal Engine
//! Manages lifecycle, health checks, and child process supervision of `amstal-engine`
//! over Unix Domain Sockets (`/tmp/amstal.sock`) and WebSocket (`ws://127.0.0.1:8194`).

use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use tokio::net::TcpStream;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EngineStatus {
    pub is_running: bool,
    pub socket_path: String,
    pub socket_exists: bool,
    pub ws_host: String,
    pub ws_port: u16,
    pub ws_alive: bool,
    pub managed_child_pid: Option<u32>,
    pub uptime_secs: u64,
}

pub struct DaemonSupervisor {
    socket_path: String,
    ws_host: String,
    ws_port: u16,
    child_process: Arc<Mutex<Option<Child>>>,
    start_time: Option<Instant>,
}

impl DaemonSupervisor {
    pub fn new(socket_path: String, ws_host: String, ws_port: u16) -> Self {
        Self {
            socket_path,
            ws_host,
            ws_port,
            child_process: Arc::new(Mutex::new(None)),
            start_time: None,
        }
    }

    /// Determines the absolute or relative path to `amstal-engine`.
    fn find_engine_dir() -> PathBuf {
        let candidates = [
            PathBuf::from("../amstal-engine"),
            PathBuf::from("../../amstal-engine"),
            PathBuf::from("amstal-engine"),
            std::env::current_dir()
                .unwrap_or_else(|_| PathBuf::from("."))
                .parent()
                .map(|p| p.join("amstal-engine"))
                .unwrap_or_else(|| PathBuf::from("../amstal-engine")),
        ];

        for candidate in &candidates {
            if candidate.join("pyproject.toml").exists() || candidate.join("src/main.py").exists() {
                return candidate.clone();
            }
        }

        PathBuf::from("../amstal-engine")
    }

    /// Determines the Python interpreter to use (.venv preferred).
    fn find_python_interpreter(engine_dir: &Path) -> PathBuf {
        let venv_python = engine_dir.join(".venv/bin/python3");
        if venv_python.exists() {
            return venv_python;
        }

        let sys_python = PathBuf::from("python3");
        sys_python
    }

    /// Checks whether the WebSocket port is responding to TCP handshake.
    pub async fn check_ws_alive(&self) -> bool {
        let addr = format!("{}:{}", self.ws_host, self.ws_port);
        tokio::time::timeout(Duration::from_millis(500), TcpStream::connect(&addr))
            .await
            .map(|res| res.is_ok())
            .unwrap_or(false)
    }

    /// Computes full diagnostic status of the engine daemon.
    pub async fn get_status(&self) -> EngineStatus {
        let socket_exists = Path::new(&self.socket_path).exists();
        let ws_alive = self.check_ws_alive().await;
        let is_running = socket_exists || ws_alive;

        let pid = self
            .child_process
            .lock()
            .ok()
            .and_then(|guard| guard.as_ref().map(|c| c.id()));

        let uptime_secs = if is_running {
            self.start_time
                .map(|t| t.elapsed().as_secs())
                .unwrap_or(0)
        } else {
            0
        };

        EngineStatus {
            is_running,
            socket_path: self.socket_path.clone(),
            socket_exists,
            ws_host: self.ws_host.clone(),
            ws_port: self.ws_port,
            ws_alive,
            managed_child_pid: pid,
            uptime_secs,
        }
    }

    /// Spawns the engine daemon as a background child process if not already running.
    pub fn start(&mut self) -> Result<String, String> {
        let mut guard = self
            .child_process
            .lock()
            .map_err(|e| format!("Failed to acquire child lock: {}", e))?;

        if let Some(child) = guard.as_mut() {
            match child.try_wait() {
                Ok(None) => return Ok(format!("Engine daemon already running (PID {})", child.id())),
                _ => *guard = None,
            }
        }

        let engine_dir = Self::find_engine_dir();
        let python_bin = Self::find_python_interpreter(&engine_dir);

        let mut cmd = Command::new(python_bin);
        cmd.args(["-m", "src.main"])
            .current_dir(&engine_dir)
            .stdout(Stdio::null())
            .stderr(Stdio::null());

        let child = cmd
            .spawn()
            .map_err(|e| format!("Failed to spawn engine daemon: {}", e))?;

        let pid = child.id();
        *guard = Some(child);
        self.start_time = Some(Instant::now());

        Ok(format!("Amstal engine daemon spawned successfully (PID {})", pid))
    }

    /// Stops the managed engine daemon process.
    pub fn stop(&mut self) -> Result<String, String> {
        let mut guard = self
            .child_process
            .lock()
            .map_err(|e| format!("Failed to acquire child lock: {}", e))?;

        if let Some(mut child) = guard.take() {
            let pid = child.id();
            let _ = child.kill();
            self.start_time = None;
            Ok(format!("Terminated managed engine daemon (PID {})", pid))
        } else {
            // Clean up stale socket if present
            if Path::new(&self.socket_path).exists() {
                let _ = std::fs::remove_file(&self.socket_path);
            }
            Ok("No managed child engine was running. Cleared stale socket if present.".to_string())
        }
    }

    /// Restarts the engine daemon process.
    pub fn restart(&mut self) -> Result<String, String> {
        let _ = self.stop();
        std::thread::sleep(Duration::from_millis(300));
        self.start()
    }
}

// ---------------------------------------------------------------------------
// Tauri Command Handlers
// ---------------------------------------------------------------------------

#[tauri::command]
pub async fn check_engine_status(
    state: tauri::State<'_, Mutex<DaemonSupervisor>>,
) -> Result<EngineStatus, String> {
    let supervisor = state.lock().map_err(|e| e.to_string())?;
    Ok(supervisor.get_status().await)
}

#[tauri::command]
pub fn start_engine(
    state: tauri::State<'_, Mutex<DaemonSupervisor>>,
) -> Result<String, String> {
    let mut supervisor = state.lock().map_err(|e| e.to_string())?;
    supervisor.start()
}

#[tauri::command]
pub fn stop_engine(
    state: tauri::State<'_, Mutex<DaemonSupervisor>>,
) -> Result<String, String> {
    let mut supervisor = state.lock().map_err(|e| e.to_string())?;
    supervisor.stop()
}

#[tauri::command]
pub fn restart_engine(
    state: tauri::State<'_, Mutex<DaemonSupervisor>>,
) -> Result<String, String> {
    let mut supervisor = state.lock().map_err(|e| e.to_string())?;
    supervisor.restart()
}
