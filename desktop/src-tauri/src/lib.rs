use std::fs::File;
use std::io::Write;
use std::path::PathBuf;
use std::process::Command;
use std::sync::Mutex;
use std::time::Duration;
use serde::Serialize;
use tauri_plugin_opener::OpenerExt;

mod local_cache;
mod local_tts;

const ALLOWED_URL_PREFIX: &str = "https://github.com/YangJin-Lei/my-whale/";
const ALLOWED_RELEASE_PATH: &str = "https://github.com/YangJin-Lei/my-whale/releases/download/";
const MIN_VALID_INSTALLER_BYTES: u64 = 500_000;

fn is_allowed_release_url(raw: &str) -> bool {
    let url = raw.trim();
    if !url.starts_with("https://") || url.contains('?') || url.contains(' ') {
        return false;
    }
    let valid_ext = url.ends_with(".exe") || url.ends_with(".msi") || url.ends_with(".dmg");
    if !valid_ext {
        return false;
    }
    if url.starts_with(ALLOWED_URL_PREFIX) {
        return true;
    }
    if let Some(idx) = url.find(ALLOWED_RELEASE_PATH) {
        return idx > "https://".len() && url.as_bytes().get(idx - 1) == Some(&b'/');
    }
    false
}

#[derive(Clone, Serialize, Default)]
struct UpdateProgressState {
    active: bool,
    progress: i32,
    received: u64,
    total: u64,
}

struct UpdateProgressHolder(Mutex<UpdateProgressState>);

#[tauri::command]
fn open_external_url(app: tauri::AppHandle, url: String) -> Result<(), String> {
    if !url.starts_with("https://") && !url.starts_with("http://") {
        return Err("Only http/https URLs are allowed".to_string());
    }
    app.opener()
        .open_url(url, None::<&str>)
        .map_err(|err| err.to_string())
}

#[tauri::command]
fn get_desktop_target() -> &'static str {
    if cfg!(target_os = "windows") {
        "windows"
    } else if cfg!(target_os = "macos") {
        "macos"
    } else {
        "linux"
    }
}

#[tauri::command]
fn get_update_progress(state: tauri::State<'_, UpdateProgressHolder>) -> UpdateProgressState {
    state
        .0
        .lock()
        .map(|guard| guard.clone())
        .unwrap_or_default()
}

fn is_safe_installer_name(name: &str) -> bool {
    if name.is_empty() || name.contains('/') || name.contains('\\') || name.contains("..") {
        return false;
    }
    name.ends_with(".exe") || name.ends_with(".msi") || name.ends_with(".dmg")
}

fn set_progress(holder: &UpdateProgressHolder, next: UpdateProgressState) {
    if let Ok(mut guard) = holder.0.lock() {
        *guard = next;
    }
}

async fn download_candidate(
    client: &reqwest::Client,
    url: &str,
    dest_path: &PathBuf,
    holder: &UpdateProgressHolder,
) -> Result<(), String> {
    let part_path = dest_path.with_extension("part");
    let mut response = client
        .get(url)
        .header("User-Agent", "my-whale-desktop-updater")
        .send()
        .await
        .map_err(|err| err.to_string())?;

    if !response.status().is_success() {
        return Err(format!("HTTP {}", response.status()));
    }

    let total = response.content_length().unwrap_or(0);
    let mut received: u64 = 0;
    let mut file = File::create(&part_path).map_err(|err| err.to_string())?;

    while let Some(chunk) = response.chunk().await.map_err(|err| err.to_string())? {
        file.write_all(&chunk).map_err(|err| err.to_string())?;
        received += chunk.len() as u64;
        let progress = if total > 0 {
            ((received.saturating_mul(100)) / total).min(100) as i32
        } else {
            -1
        };
        set_progress(
            holder,
            UpdateProgressState {
                active: true,
                progress,
                received,
                total,
            },
        );
    }

    file.flush().map_err(|err| err.to_string())?;
    drop(file);

    if received < MIN_VALID_INSTALLER_BYTES {
        let _ = std::fs::remove_file(&part_path);
        return Err("Downloaded installer is smaller than expected".to_string());
    }

    if dest_path.exists() {
        let _ = std::fs::remove_file(dest_path);
    }
    std::fs::rename(&part_path, dest_path).map_err(|err| err.to_string())?;
    Ok(())
}

#[tauri::command]
async fn download_and_install_update(
    app: tauri::AppHandle,
    state: tauri::State<'_, UpdateProgressHolder>,
    urls: Vec<String>,
    file_name: String,
) -> Result<(), String> {
    if !is_safe_installer_name(&file_name) {
        return Err("Invalid installer filename".to_string());
    }

    let candidates: Vec<String> = urls
        .into_iter()
        .map(|u| u.trim().to_string())
        .filter(|u| is_allowed_release_url(u))
        .collect();
    if candidates.is_empty() {
        return Err("No valid release URL provided".to_string());
    }

    if let Ok(guard) = state.0.lock() {
        if guard.active {
            return Err("Update download already in progress".to_string());
        }
    }

    set_progress(
        &state,
        UpdateProgressState {
            active: true,
            progress: 0,
            received: 0,
            total: 0,
        },
    );

    let dest_dir = std::env::temp_dir().join("my-whale-updates");
    if let Err(err) = std::fs::create_dir_all(&dest_dir) {
        set_progress(&state, UpdateProgressState::default());
        return Err(err.to_string());
    }
    let dest_path = dest_dir.join(&file_name);

    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(180))
        .build()
        .map_err(|err| {
            set_progress(&state, UpdateProgressState::default());
            err.to_string()
        })?;

    let mut last_err = String::from("Download failed");
    let mut downloaded = false;

    for url in candidates {
        match download_candidate(&client, &url, &dest_path, &state).await {
            Ok(()) => {
                downloaded = true;
                break;
            }
            Err(err) => {
                last_err = err;
            }
        }
    }

    if !downloaded {
        set_progress(&state, UpdateProgressState::default());
        return Err(last_err);
    }

    set_progress(
        &state,
        UpdateProgressState {
            active: false,
            progress: 100,
            received: 0,
            total: 0,
        },
    );

    #[cfg(target_os = "macos")]
    {
        Command::new("open")
            .arg(&dest_path)
            .spawn()
            .map_err(|err| err.to_string())?;
        return Ok(());
    }

    #[cfg(not(target_os = "macos"))]
    {
        Command::new(&dest_path)
            .spawn()
            .map_err(|err| err.to_string())?;
        app.exit(0);
        Ok(())
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(UpdateProgressHolder(Mutex::new(UpdateProgressState::default())))
        .manage(local_cache::CacheServerHolder::default())
        .manage(local_tts::LocalTtsHolder::default())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            open_external_url,
            get_desktop_target,
            get_update_progress,
            download_and_install_update,
            local_cache::start_cache_server,
            local_cache::stop_cache_server,
            local_cache::get_cache_server_status,
            local_tts::tts_get_status,
            local_tts::tts_prewarm,
            local_tts::tts_synthesize,
            local_tts::tts_download_model,
            local_tts::tts_delete_model
        ])
        .run(tauri::generate_context!())
        .expect("error while running my-whale desktop application");
}
