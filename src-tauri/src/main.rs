// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::fs;
use std::path::Path;
use tauri::{Emitter, Manager};

#[derive(serde::Serialize, Clone)]
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

#[tauri::command]
fn get_initial_pdf() -> Option<PdfPayload> {
    for arg in std::env::args().skip(1) {
        let clean = arg.trim_matches('"');
        if clean.to_lowercase().ends_with(".pdf") {
            let res = read_pdf_file(clean.to_string());
            if res.ok {
                return Some(res);
            }
        }
    }
    None
}

#[tauri::command]
fn show_item_in_folder(item_path: String) -> bool {
    #[cfg(target_os = "windows")]
    {
        use std::process::Command;
        let _ = Command::new("explorer")
            .arg(format!("/select,{}", item_path))
            .spawn();
        true
    }
    #[cfg(not(target_os = "windows"))]
    {
        false
    }
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_single_instance::init(|app, args, _cwd| {
            if let Some(w) = app.get_webview_window("main") {
                let _ = w.show();
                let _ = w.unminimize();
                let _ = w.set_focus();
            }
            for arg in args.into_iter().skip(1) {
                let clean = arg.trim_matches('"');
                if clean.to_lowercase().ends_with(".pdf") {
                    let res = read_pdf_file(clean.to_string());
                    if res.ok {
                        let _ = app.emit("open-pdf-file", res);
                    }
                }
            }
        }))
        .invoke_handler(tauri::generate_handler![read_pdf_file, get_initial_pdf, show_item_in_folder])
        .run(tauri::generate_context!())
        .expect("error while running Makeen tauri application");
}
