use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::Duration;

use futures_util::StreamExt;
use tauri::Emitter;
use tokio::io::AsyncWriteExt;

const BASE: &str = "http://trove-update.dyn.triongames.com";
const PREFIX: &str = "/kiwi-live-client-patch";

const STAGING_DIR_NAME: &str = "_update_staging";

fn pointer_name(channel: &str) -> &'static str {
    if channel.eq_ignore_ascii_case("pts") { "kiwi-pts.txt" } else { "kiwi-live-us.txt" }
}

pub struct UpdaterState {
    cancel_requested: Mutex<HashSet<String>>,
    paused: Mutex<HashSet<String>>,
}

impl UpdaterState {
    pub fn new() -> Self {
        Self { cancel_requested: Mutex::new(HashSet::new()), paused: Mutex::new(HashSet::new()) }
    }
}

fn is_cancel_requested(state: &UpdaterState, channel: &str) -> bool {
    state.cancel_requested.lock().map(|s| s.contains(&channel.to_lowercase())).unwrap_or(false)
}

fn clear_cancel(state: &UpdaterState, channel: &str) {
    if let Ok(mut s) = state.cancel_requested.lock() {
        s.remove(&channel.to_lowercase());
    }
}

fn is_paused(state: &UpdaterState, channel: &str) -> bool {
    state.paused.lock().map(|s| s.contains(&channel.to_lowercase())).unwrap_or(false)
}

fn clear_paused(state: &UpdaterState, channel: &str) {
    if let Ok(mut s) = state.paused.lock() {
        s.remove(&channel.to_lowercase());
    }
}

#[tauri::command]
pub fn cancel_trove_update(state: tauri::State<'_, UpdaterState>, channel: String) {
    if let Ok(mut set) = state.cancel_requested.lock() {
        set.insert(channel.to_lowercase());
    }
}

#[tauri::command]
pub fn pause_trove_update(state: tauri::State<'_, UpdaterState>, channel: String) {
    if let Ok(mut set) = state.paused.lock() {
        set.insert(channel.to_lowercase());
    }
}

#[tauri::command]
pub fn resume_trove_update(state: tauri::State<'_, UpdaterState>, channel: String) {
    if let Ok(mut set) = state.paused.lock() {
        set.remove(&channel.to_lowercase());
    }
}

async fn wait_while_paused(app: &tauri::AppHandle, state: &UpdaterState, channel: &str) -> bool {
    if !is_paused(state, channel) {
        return false;
    }
    let _ = app.emit("update-progress", UpdateProgress::phase(channel, "paused"));
    loop {
        if is_cancel_requested(state, channel) {
            return true;
        }
        if !is_paused(state, channel) {
            return false;
        }
        tokio::time::sleep(Duration::from_millis(250)).await;
    }
}

#[tauri::command]
pub fn has_local_manifest(trove_exe_path: String) -> bool {
    read_local_manifest(&trove_exe_path).is_some()
}

#[derive(Debug, Clone)]
struct ManifestEntry {
    path: String,
    id: String,
    size: u64,
}

#[derive(Debug, Clone)]
struct ParsedManifest {
    version: String,
    entries: Vec<ManifestEntry>,
}

fn parse_manifest_line(line: &str) -> Option<ManifestEntry> {
    let mut parts = line.rsplitn(3, ':');
    let size_str = parts.next()?;
    let id = parts.next()?;
    let path = parts.next()?;
    let size: u64 = size_str.trim().parse().ok()?;
    Some(ManifestEntry { path: path.to_string(), id: id.to_string(), size })
}

fn parse_manifest(text: &str) -> Option<ParsedManifest> {
    let mut lines = text.lines();
    let first = lines.next()?;
    let version = first.strip_prefix("version ")?.trim().to_string();

    let entries = lines
        .map(str::trim)
        .filter(|line| !line.is_empty())
        .filter_map(parse_manifest_line)
        .collect();

    Some(ParsedManifest { version, entries })
}

fn local_manifest_path(trove_exe_path: &str) -> Option<PathBuf> {
    Path::new(trove_exe_path).parent().map(|d| d.join("manifest.txt"))
}

fn read_local_manifest(trove_exe_path: &str) -> Option<ParsedManifest> {
    let path = local_manifest_path(trove_exe_path)?;
    let text = std::fs::read_to_string(path).ok()?;
    parse_manifest(&text)
}

fn diff_entries(old: &ParsedManifest, new: &ParsedManifest) -> Vec<ManifestEntry> {
    let old_map: HashMap<&str, &ManifestEntry> = old.entries.iter().map(|e| (e.path.as_str(), e)).collect();
    new.entries.iter()
        .filter(|e| match old_map.get(e.path.as_str()) {
            Some(o) => o.id != e.id || o.size != e.size,
            None => true,
        })
        .cloned()
        .collect()
}

async fn fetch_pointer(channel: &str) -> Result<(String, String), String> {
    let url = format!("{}{}/public/{}", BASE, PREFIX, pointer_name(channel));
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(15))
        .build()
        .map_err(|e| e.to_string())?;
    let text = client.get(&url).send().await.map_err(|e| e.to_string())?
        .text().await.map_err(|e| e.to_string())?;

    let mut parts = text.split('|');
    let version = parts.next().unwrap_or("").trim().to_string();
    let content_path = parts.next().unwrap_or("").trim().to_string();
    if version.is_empty() || content_path.is_empty() {
        return Err("Could not read the update pointer".to_string());
    }
    Ok((version, content_path))
}

async fn fetch_manifest_text(content_path: &str, version: &str) -> Result<String, String> {
    let url = format!("{}{}/{}/{}.manifest", BASE, PREFIX, content_path, version);
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(30))
        .build()
        .map_err(|e| e.to_string())?;
    client.get(&url).send().await.map_err(|e| e.to_string())?
        .text().await.map_err(|e| e.to_string())
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateCheckResult {
    pub local_version: Option<String>,
    pub remote_version: String,
    pub up_to_date: bool,
    pub has_local_manifest: bool,
}

#[tauri::command]
pub async fn check_trove_update(trove_exe_path: String, channel: String) -> Result<UpdateCheckResult, String> {
    let (remote_version, _content_path) = fetch_pointer(&channel).await?;
    let local_manifest = read_local_manifest(&trove_exe_path);
    let local_version = local_manifest.as_ref().map(|m| m.version.clone());
    let up_to_date = local_version.as_deref() == Some(remote_version.as_str());
    Ok(UpdateCheckResult { local_version, remote_version, up_to_date, has_local_manifest: local_manifest.is_some() })
}

#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateProgress {
    pub channel: String,
    pub phase: String,
    pub current_index: u32,
    pub total_files: u32,
    pub current_path: String,
    pub file_bytes_done: u64,
    pub file_bytes_total: u64,
    pub overall_bytes_done: u64,
    pub overall_bytes_total: u64,
    pub message: Option<String>,
}

impl UpdateProgress {
    fn phase(channel: &str, phase: &str) -> Self {
        Self {
            channel: channel.to_string(),
            phase: phase.to_string(),
            current_index: 0,
            total_files: 0,
            current_path: String::new(),
            file_bytes_done: 0,
            file_bytes_total: 0,
            overall_bytes_done: 0,
            overall_bytes_total: 0,
            message: None,
        }
    }
}

async fn sync_entries(
    app: &tauri::AppHandle,
    state: &UpdaterState,
    channel: &str,
    trove_dir: &Path,
    content_path: &str,
    entries: &[ManifestEntry],
) -> Result<(), String> {
    let total_files = entries.len() as u32;
    let overall_bytes_total: u64 = entries.iter().map(|e| e.size).sum();
    let emit = |p: UpdateProgress| { let _ = app.emit("update-progress", p); };

    if total_files == 0 {
        return Ok(());
    }

    let staging_dir = trove_dir.join(STAGING_DIR_NAME);
    let _ = tokio::fs::remove_dir_all(&staging_dir).await;
    tokio::fs::create_dir_all(&staging_dir).await.map_err(|e| e.to_string())?;

    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(300))
        .build()
        .map_err(|e| e.to_string())?;
    let mut overall_bytes_done: u64 = 0;

    for (idx, entry) in entries.iter().enumerate() {
        if is_cancel_requested(state, channel) {
            clear_cancel(state, channel);
            let _ = tokio::fs::remove_dir_all(&staging_dir).await;
            emit(UpdateProgress::phase(channel, "cancelled"));
            return Err("Cancelled".to_string());
        }
        if wait_while_paused(app, state, channel).await {
            clear_cancel(state, channel);
            let _ = tokio::fs::remove_dir_all(&staging_dir).await;
            emit(UpdateProgress::phase(channel, "cancelled"));
            return Err("Cancelled".to_string());
        }

        let url_path = entry.path.replace('\\', "/");
        let url = format!("{}{}/{}/recovery/{}", BASE, PREFIX, content_path, url_path);
        let staged_dest = staging_dir.join(&entry.path);
        if let Some(parent) = staged_dest.parent() {
            tokio::fs::create_dir_all(parent).await.map_err(|e| e.to_string())?;
        }

        let resp = client.get(&url).send().await.map_err(|e| e.to_string())?;
        if !resp.status().is_success() {
            let msg = format!("Failed to download {} (HTTP {})", entry.path, resp.status());
            let mut p = UpdateProgress::phase(channel, "error");
            p.message = Some(msg.clone());
            emit(p);
            let _ = tokio::fs::remove_dir_all(&staging_dir).await;
            return Err(msg);
        }

        let mut file = tokio::fs::File::create(&staged_dest).await.map_err(|e| e.to_string())?;
        let mut stream = resp.bytes_stream();
        let mut file_bytes_done: u64 = 0;
        let mut cancelled = false;

        while let Some(chunk) = stream.next().await {
            if is_cancel_requested(state, channel) {
                cancelled = true;
                break;
            }
            let chunk = chunk.map_err(|e| e.to_string())?;
            file.write_all(&chunk).await.map_err(|e| e.to_string())?;
            file_bytes_done += chunk.len() as u64;
            overall_bytes_done += chunk.len() as u64;
            emit(UpdateProgress {
                channel: channel.to_string(),
                phase: "downloading".to_string(),
                current_index: idx as u32 + 1,
                total_files,
                current_path: entry.path.clone(),
                file_bytes_done,
                file_bytes_total: entry.size,
                overall_bytes_done,
                overall_bytes_total,
                message: None,
            });

            if is_paused(state, channel) {
                if wait_while_paused(app, state, channel).await {
                    cancelled = true;
                    break;
                }
                emit(UpdateProgress {
                    channel: channel.to_string(),
                    phase: "downloading".to_string(),
                    current_index: idx as u32 + 1,
                    total_files,
                    current_path: entry.path.clone(),
                    file_bytes_done,
                    file_bytes_total: entry.size,
                    overall_bytes_done,
                    overall_bytes_total,
                    message: None,
                });
            }
        }
        file.flush().await.map_err(|e| e.to_string())?;
        drop(file);

        if cancelled {
            clear_cancel(state, channel);
            let _ = tokio::fs::remove_dir_all(&staging_dir).await;
            emit(UpdateProgress::phase(channel, "cancelled"));
            return Err("Cancelled".to_string());
        }

        if file_bytes_done != entry.size {
            let _ = tokio::fs::remove_dir_all(&staging_dir).await;
            let msg = format!("Downloaded size mismatch for {}: expected {} got {}", entry.path, entry.size, file_bytes_done);
            let mut p = UpdateProgress::phase(channel, "error");
            p.message = Some(msg.clone());
            emit(p);
            return Err(msg);
        }
    }

    if is_cancel_requested(state, channel) {
        clear_cancel(state, channel);
        let _ = tokio::fs::remove_dir_all(&staging_dir).await;
        emit(UpdateProgress::phase(channel, "cancelled"));
        return Err("Cancelled".to_string());
    }

    emit(UpdateProgress {
        channel: channel.to_string(),
        phase: "finalizing".to_string(),
        current_index: total_files,
        total_files,
        current_path: String::new(),
        file_bytes_done: 0,
        file_bytes_total: 0,
        overall_bytes_done,
        overall_bytes_total,
        message: None,
    });

    for entry in entries {
        let staged = staging_dir.join(&entry.path);
        let dest = trove_dir.join(&entry.path);
        if let Some(parent) = dest.parent() {
            tokio::fs::create_dir_all(parent).await.map_err(|e| e.to_string())?;
        }
        if dest.exists() {
            let _ = tokio::fs::remove_file(&dest).await;
        }
        tokio::fs::rename(&staged, &dest).await.map_err(|e| e.to_string())?;
    }

    let _ = tokio::fs::remove_dir_all(&staging_dir).await;

    Ok(())
}

#[tauri::command]
pub async fn apply_trove_update(app: tauri::AppHandle, state: tauri::State<'_, UpdaterState>, trove_exe_path: String, channel: String) -> Result<(), String> {
    clear_cancel(&state, &channel);
    clear_paused(&state, &channel);
    let emit = |p: UpdateProgress| { let _ = app.emit("update-progress", p); };
    emit(UpdateProgress::phase(&channel, "checking"));

    let (version, content_path) = fetch_pointer(&channel).await?;
    let manifest_text = fetch_manifest_text(&content_path, &version).await?;
    let new_manifest = parse_manifest(&manifest_text).ok_or("Could not parse the update manifest")?;

    let trove_dir = Path::new(&trove_exe_path).parent()
        .ok_or("Invalid Trove executable path")?
        .to_path_buf();
    let manifest_path = trove_dir.join("manifest.txt");

    let old_manifest = read_local_manifest(&trove_exe_path).ok_or(
        "No local manifest.txt found next to the Trove executable - use \"Download Game\" to install it fresh.",
    )?;

    let changed = diff_entries(&old_manifest, &new_manifest);

    if changed.is_empty() {
        let mut p = UpdateProgress::phase(&channel, "done");
        p.message = Some("Already up to date".to_string());
        emit(p);
        return Ok(());
    }

    sync_entries(&app, &state, &channel, &trove_dir, &content_path, &changed).await?;

    tokio::fs::write(&manifest_path, &manifest_text).await.map_err(|e| e.to_string())?;

    let mut p = UpdateProgress::phase(&channel, "done");
    p.message = Some(format!("Updated to {}", version));
    emit(p);
    Ok(())
}

#[tauri::command]
pub async fn download_trove_fresh(app: tauri::AppHandle, state: tauri::State<'_, UpdaterState>, folder: String, channel: String) -> Result<String, String> {
    clear_cancel(&state, &channel);
    clear_paused(&state, &channel);
    let emit = |p: UpdateProgress| { let _ = app.emit("update-progress", p); };
    emit(UpdateProgress::phase(&channel, "checking"));

    let (version, content_path) = fetch_pointer(&channel).await?;
    let manifest_text = fetch_manifest_text(&content_path, &version).await?;
    let new_manifest = parse_manifest(&manifest_text).ok_or("Could not parse the update manifest")?;

    let trove_dir = PathBuf::from(&folder);
    tokio::fs::create_dir_all(&trove_dir).await.map_err(|e| e.to_string())?;

    sync_entries(&app, &state, &channel, &trove_dir, &content_path, &new_manifest.entries).await?;

    tokio::fs::write(trove_dir.join("manifest.txt"), &manifest_text).await.map_err(|e| e.to_string())?;

    let mut p = UpdateProgress::phase(&channel, "done");
    p.message = Some(format!("Installed {}", version));
    emit(p);

    Ok(trove_dir.join("Trove_x64.exe").to_string_lossy().to_string())
}
