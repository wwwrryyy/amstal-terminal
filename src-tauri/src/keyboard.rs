//! Starboard Hardware Keyboard & Macro Controller Module
//! Parses Starboard QMK/VIA keymaps and dispatches hardware macro keycodes (PRD Section 3.3).

use serde::{Deserialize, Serialize};
use std::path::PathBuf;

#[allow(dead_code)]
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CustomKeycodeInfo {
    pub name: String,
    pub code: String,
    pub description: String,
    pub macro_action: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StarboardLayoutResponse {
    pub name: String,
    pub vendor_id: String,
    pub product_id: String,
    pub version: String,
    pub custom_keycodes_count: usize,
    pub raw_json: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MacroDispatchResult {
    pub key_code: String,
    pub routed_action: String,
    pub mnemonic: Option<String>,
    pub handled: bool,
}

fn locate_keymap_file() -> PathBuf {
    let candidates = [
        PathBuf::from("hardware/starboard_qmk_keymap.json"),
        PathBuf::from("../hardware/starboard_qmk_keymap.json"),
        PathBuf::from("../../hardware/starboard_qmk_keymap.json"),
    ];

    for c in &candidates {
        if c.exists() {
            return c.clone();
        }
    }

    PathBuf::from("hardware/starboard_qmk_keymap.json")
}

// ---------------------------------------------------------------------------
// Tauri Command Handlers
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn get_starboard_layout() -> Result<StarboardLayoutResponse, String> {
    let file_path = locate_keymap_file();
    if !file_path.exists() {
        return Err(format!("Starboard keymap file not found at {:?}", file_path));
    }

    let contents = std::fs::read_to_string(&file_path)
        .map_err(|e| format!("Failed to read starboard keymap: {}", e))?;

    let parsed: serde_json::Value = serde_json::from_str(&contents)
        .map_err(|e| format!("Failed to parse starboard keymap JSON: {}", e))?;

    let name = parsed["name"].as_str().unwrap_or("Amstal Starboard").to_string();
    let vendor_id = parsed["vendorId"].as_str().unwrap_or("0x414D").to_string();
    let product_id = parsed["productId"].as_str().unwrap_or("0x5354").to_string();
    let version = parsed["version"].as_str().unwrap_or("1.3.0").to_string();
    let count = parsed["custom_keycodes"].as_array().map_or(0, |a| a.len());

    Ok(StarboardLayoutResponse {
        name,
        vendor_id,
        product_id,
        version,
        custom_keycodes_count: count,
        raw_json: contents,
    })
}

#[tauri::command]
pub fn process_hardware_macro(key_code: String) -> Result<MacroDispatchResult, String> {
    let kc = key_code.to_uppercase();

    let (action, mnemonic) = match kc.as_str() {
        "AM_GO" | "0X5B00" => ("EXECUTE_GO", None),
        "AM_CANCEL" | "0X5B01" => ("CANCEL_COMMAND", None),
        "AM_HELP" | "0X5B02" => ("OPEN_HELP", Some("HELP".to_string())),
        "AM_COPILOT" | "0X5B03" => ("OPEN_COPILOT", Some("COPILOT".to_string())),
        "AM_GP" | "0X5B04" => ("NAVIGATE_PANEL", Some("GP".to_string())),
        "AM_PORT" | "0X5B05" => ("NAVIGATE_PANEL", Some("PORT".to_string())),
        "AM_HMM" | "0X5B06" => ("NAVIGATE_PANEL", Some("HMM".to_string())),
        "AM_FA" | "0X5B07" => ("NAVIGATE_PANEL", Some("FA".to_string())),
        "AM_DES" | "0X5B08" => ("NAVIGATE_PANEL", Some("DES".to_string())),
        "AM_SPLC" | "0X5B09" => ("NAVIGATE_PANEL", Some("SPLC".to_string())),
        "AM_EDGAR" | "0X5B0A" => ("NAVIGATE_PANEL", Some("EDGAR".to_string())),
        "AM_NEWS" | "0X5B0B" => ("NAVIGATE_PANEL", Some("NEWS".to_string())),
        "AM_HP" | "0X5B0C" => ("NAVIGATE_PANEL", Some("HP".to_string())),
        "AM_ANR" | "0X5B0D" => ("NAVIGATE_PANEL", Some("ANR".to_string())),
        "AM_GRID" | "0X5B0E" => ("CYCLE_GRID_LAYOUT", None),
        "AM_ENC0_CW" => ("SCRUB_TIMELINE_FORWARD", None),
        "AM_ENC0_CCW" => ("SCRUB_TIMELINE_BACKWARD", None),
        "AM_ENC1_CW" => ("ZOOM_RESOLUTION_IN", None),
        "AM_ENC1_CCW" => ("ZOOM_RESOLUTION_OUT", None),
        _ => ("UNKNOWN_KEY", None),
    };

    Ok(MacroDispatchResult {
        key_code: kc,
        routed_action: action.to_string(),
        mnemonic,
        handled: action != "UNKNOWN_KEY",
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_process_hardware_macro() {
        let go = process_hardware_macro("AM_GO".to_string()).unwrap();
        assert_eq!(go.routed_action, "EXECUTE_GO");
        assert!(go.handled);

        let cancel = process_hardware_macro("AM_CANCEL".to_string()).unwrap();
        assert_eq!(cancel.routed_action, "CANCEL_COMMAND");

        let port = process_hardware_macro("AM_PORT".to_string()).unwrap();
        assert_eq!(port.routed_action, "NAVIGATE_PANEL");
        assert_eq!(port.mnemonic, Some("PORT".to_string()));

        let enc0 = process_hardware_macro("AM_ENC0_CW".to_string()).unwrap();
        assert_eq!(enc0.routed_action, "SCRUB_TIMELINE_FORWARD");

        let unknown = process_hardware_macro("UNKNOWN_KEY_CODE".to_string()).unwrap();
        assert_eq!(unknown.routed_action, "UNKNOWN_KEY");
        assert!(!unknown.handled);
    }

    #[test]
    fn test_get_starboard_layout() {
        let layout = get_starboard_layout().unwrap();
        assert_eq!(layout.vendor_id, "0x414D");
        assert_eq!(layout.product_id, "0x5354");
        assert!(layout.custom_keycodes_count > 0);
    }
}

