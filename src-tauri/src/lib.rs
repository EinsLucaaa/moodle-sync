mod download;
mod moodle;

use std::{
    collections::HashMap,
    ffi::OsStr,
    path::PathBuf,
    process::Command,
    sync::{
        atomic::{AtomicBool, AtomicUsize, Ordering},
        Arc,
    },
    time::{SystemTime, UNIX_EPOCH},
};

use futures_util::{stream, StreamExt};
use moodle::{AccountInfo, Index, StoredAccount};
use reqwest::{redirect, Client};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager, State};

struct AppState {
    client: Client,
    cancel: AtomicBool,
}

#[derive(Serialize, Clone)]
struct SyncProgress {
    done: usize,
    total: usize,
    course: String,
}

fn data_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir)
}

fn read_accounts(app: &AppHandle) -> Result<Vec<StoredAccount>, String> {
    let path = data_dir(app)?.join("accounts.json");
    match std::fs::read_to_string(path) {
        Ok(s) => serde_json::from_str(&s).map_err(|e| e.to_string()),
        Err(_) => Ok(vec![]),
    }
}

fn write_accounts(app: &AppHandle, accounts: &[StoredAccount]) -> Result<(), String> {
    let path = data_dir(app)?.join("accounts.json");
    let json = serde_json::to_string_pretty(accounts).map_err(|e| e.to_string())?;
    std::fs::write(&path, json).map_err(|e| e.to_string())?;
    // Enthält Tokens: nur für den eigenen Benutzer lesbar machen.
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o600));
    }
    Ok(())
}

fn find_account(app: &AppHandle, id: &str) -> Result<StoredAccount, String> {
    read_accounts(app)?
        .into_iter()
        .find(|a| a.id == id)
        .ok_or_else(|| "Konto nicht gefunden.".to_string())
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct HistoryEntry {
    modified: i64,
    size: i64,
    at: i64,
}

type History = HashMap<String, HistoryEntry>;

fn history_path(app: &AppHandle, account_id: &str) -> Result<PathBuf, String> {
    Ok(data_dir(app)?.join(format!("history_{account_id}.json")))
}

fn read_history(app: &AppHandle, account_id: &str) -> History {
    history_path(app, account_id)
        .ok()
        .and_then(|p| std::fs::read_to_string(p).ok())
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

/// Öffnet Datei, Ordner oder URL mit dem Standardprogramm des Systems.
fn open_with_os(target: &OsStr) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    let mut cmd = Command::new("open");
    #[cfg(target_os = "windows")]
    let mut cmd = {
        let mut c = Command::new("cmd");
        c.args(["/C", "start", ""]);
        c
    };
    #[cfg(all(unix, not(target_os = "macos")))]
    let mut cmd = Command::new("xdg-open");
    cmd.arg(target).spawn().map(|_| ()).map_err(|e| e.to_string())
}

fn index_path(app: &AppHandle, account_id: &str) -> Result<PathBuf, String> {
    Ok(data_dir(app)?.join(format!("index_{account_id}.json")))
}

#[tauri::command]
fn list_accounts(app: AppHandle) -> Result<Vec<AccountInfo>, String> {
    Ok(read_accounts(&app)?.iter().map(AccountInfo::from).collect())
}

#[tauri::command]
async fn login(
    app: AppHandle,
    state: State<'_, AppState>,
    site_url: String,
    username: String,
    password: String,
) -> Result<AccountInfo, String> {
    let site = moodle::normalize_site_url(&site_url)?;
    let account = moodle::login(&state.client, &site, username.trim(), &password).await?;
    let mut accounts = read_accounts(&app)?;
    accounts.retain(|a| a.id != account.id);
    accounts.push(account.clone());
    write_accounts(&app, &accounts)?;
    Ok(AccountInfo::from(&account))
}

#[tauri::command]
fn remove_account(app: AppHandle, account_id: String) -> Result<(), String> {
    let mut accounts = read_accounts(&app)?;
    accounts.retain(|a| a.id != account_id);
    write_accounts(&app, &accounts)?;
    let _ = std::fs::remove_file(index_path(&app, &account_id)?);
    let _ = std::fs::remove_file(history_path(&app, &account_id)?);
    Ok(())
}

#[tauri::command]
fn load_index(app: AppHandle, account_id: String) -> Result<Option<Index>, String> {
    let account = find_account(&app, &account_id)?;
    match std::fs::read_to_string(index_path(&app, &account.id)?) {
        Ok(s) => Ok(serde_json::from_str(&s).ok()),
        Err(_) => Ok(None),
    }
}

#[tauri::command]
async fn sync_index(
    app: AppHandle,
    state: State<'_, AppState>,
    account_id: String,
) -> Result<Index, String> {
    let account = find_account(&app, &account_id)?;
    let client = state.client.clone();
    let list = moodle::call(
        &client,
        &account.site_url,
        &account.token,
        "core_enrol_get_users_courses",
        &[("userid", account.user_id.to_string())],
    )
    .await?;
    let list = list.as_array().cloned().unwrap_or_default();
    let total = list.len();
    let done = Arc::new(AtomicUsize::new(0));
    let _ = app.emit("sync-progress", SyncProgress { done: 0, total, course: String::new() });

    let mut courses: Vec<moodle::Course> = stream::iter(list)
        .map(|c| {
            let (client, account, app, done) =
                (client.clone(), account.clone(), app.clone(), done.clone());
            async move {
                let mut course = moodle::course_from_json(&c);
                match moodle::call(
                    &client,
                    &account.site_url,
                    &account.token,
                    "core_course_get_contents",
                    &[("courseid", course.id.to_string())],
                )
                .await
                {
                    Ok(v) => course.sections = moodle::parse_sections(course.id, &v),
                    Err(e) => course.error = Some(e),
                }
                let n = done.fetch_add(1, Ordering::SeqCst) + 1;
                let _ = app.emit(
                    "sync-progress",
                    SyncProgress { done: n, total, course: course.fullname.clone() },
                );
                course
            }
        })
        .buffer_unordered(4)
        .collect()
        .await;
    courses.sort_by_key(|c| c.fullname.to_lowercase());

    let index = Index {
        account_id: account.id.clone(),
        synced_at: now_ms(),
        courses,
    };
    let json = serde_json::to_string(&index).map_err(|e| e.to_string())?;
    std::fs::write(index_path(&app, &account.id)?, json).map_err(|e| e.to_string())?;
    Ok(index)
}

#[tauri::command]
async fn download_files(
    app: AppHandle,
    state: State<'_, AppState>,
    account_id: String,
    dest: String,
    items: Vec<download::DownloadItem>,
) -> Result<download::Summary, String> {
    let account = find_account(&app, &account_id)?;
    let dest = PathBuf::from(dest);
    if !dest.is_dir() {
        return Err("Zielordner existiert nicht.".into());
    }
    state.cancel.store(false, Ordering::Relaxed);
    let (summary, completed) = download::run(
        app.clone(),
        state.client.clone(),
        account.site_url,
        account.token,
        dest,
        items,
        &state.cancel,
    )
    .await?;

    let mut history = read_history(&app, &account.id);
    let at = now_ms();
    for c in completed {
        history.insert(c.id, HistoryEntry { modified: c.modified, size: c.size, at });
    }
    if let Ok(json) = serde_json::to_string(&history) {
        let _ = history_path(&app, &account.id).map(|p| std::fs::write(p, json));
    }
    Ok(summary)
}

#[tauri::command]
fn load_history(app: AppHandle, account_id: String) -> Result<History, String> {
    let account = find_account(&app, &account_id)?;
    Ok(read_history(&app, &account.id))
}

#[tauri::command]
async fn refresh_icon(
    app: AppHandle,
    state: State<'_, AppState>,
    account_id: String,
) -> Result<Option<String>, String> {
    let account = find_account(&app, &account_id)?;
    let icon = moodle::fetch_icon(&state.client, &account.site_url).await;
    if icon.is_some() {
        let mut accounts = read_accounts(&app)?;
        if let Some(a) = accounts.iter_mut().find(|a| a.id == account.id) {
            a.icon = icon.clone();
        }
        write_accounts(&app, &accounts)?;
    }
    Ok(icon)
}

#[tauri::command]
async fn preview_file(
    app: AppHandle,
    state: State<'_, AppState>,
    account_id: String,
    url: String,
    name: String,
    is_link: bool,
) -> Result<(), String> {
    if is_link {
        if !(url.starts_with("http://") || url.starts_with("https://")) {
            return Err("Nur http(s)-Links können geöffnet werden.".into());
        }
        return open_with_os(OsStr::new(&url));
    }
    let account = find_account(&app, &account_id)?;
    let path = download::fetch_to_temp(
        &app,
        &state.client,
        &account.site_url,
        &account.token,
        url,
        &name,
    )
    .await?;
    // macOS: Quick Look wie im Finder (Leertaste), sonst Standardprogramm.
    #[cfg(target_os = "macos")]
    {
        use std::process::Stdio;
        return Command::new("qlmanage")
            .arg("-p")
            .arg(&path)
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .map(|_| ())
            .map_err(|e| e.to_string());
    }
    #[cfg(not(target_os = "macos"))]
    open_with_os(path.as_os_str())
}

#[tauri::command]
fn cancel_download(state: State<'_, AppState>) {
    state.cancel.store(true, Ordering::Relaxed);
}

#[tauri::command]
fn open_folder(path: String) -> Result<(), String> {
    let p = PathBuf::from(&path);
    if !p.is_dir() {
        return Err("Ordner existiert nicht.".into());
    }
    open_with_os(p.as_os_str())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Token/URL nur an den ursprünglichen Host weiterreichen.
    let policy = redirect::Policy::custom(|attempt| {
        let same_host = attempt
            .previous()
            .first()
            .is_some_and(|first| first.host_str() == attempt.url().host_str());
        if attempt.previous().len() >= 8 {
            attempt.error("zu viele Weiterleitungen")
        } else if same_host {
            attempt.follow()
        } else {
            attempt.stop()
        }
    });
    let client = Client::builder()
        .user_agent("MoodleSync/0.1")
        .connect_timeout(std::time::Duration::from_secs(15))
        .redirect(policy)
        .build()
        .expect("HTTP-Client konnte nicht erstellt werden");

    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_notification::init())
        .manage(AppState { client, cancel: AtomicBool::new(false) })
        .invoke_handler(tauri::generate_handler![
            list_accounts,
            login,
            remove_account,
            load_index,
            sync_index,
            download_files,
            load_history,
            refresh_icon,
            preview_file,
            cancel_download,
            open_folder
        ])
        .run(tauri::generate_context!())
        .expect("Fehler beim Starten von Moodle Sync");
}
