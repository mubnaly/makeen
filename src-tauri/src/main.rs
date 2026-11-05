// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::fs;
use std::path::Path;

#[derive(serde::Serialize)]
struct PdfPayload {
    ok: bool,
    name: String,
    path: String,
    bytes: Vec<u8>,
    error: Option<String>,
}

#[tauri::command]
fn read_pdf_file(file_path: String) -> PdfPayload {
    let p = Path::new(&file_path);
    if !p.exists() || !p.is_file() {
        return PdfPayload {
            ok: false,
            name: String::new(),
            path: file_path,
            bytes: Vec::new(),
            error: Some("File does not exist or is not a regular file".to_string()),
        };
    }

    match fs::read(&file_path) {
        Ok(bytes) => {
            let name = p
                .file_name()
                .map(|s| s.to_string_lossy().into_owned())
                .unwrap_or_else(|| "document.pdf".to_string());
            PdfPayload {
                ok: true,
                name,
                path: file_path,
                bytes,
                error: None,
            }
        }
        Err(e) => PdfPayload {
            ok: false,
            name: String::new(),
            path: file_path,
            bytes: Vec::new(),
            error: Some(e.to_string()),
        },
    }
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .invoke_handler(tauri::generate_handler![read_pdf_file])
        .run(tauri::generate_context!())
        .expect("error while running Makeen tauri application");
}
