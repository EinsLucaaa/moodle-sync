use std::{
    collections::HashSet,
    path::{Path, PathBuf},
    sync::atomic::{AtomicBool, Ordering},
    time::{Duration, Instant},
};

use futures_util::{stream, StreamExt};
use reqwest::{Client, Url};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter};
use tokio::io::AsyncWriteExt;

const MAX_ATTEMPTS: u32 = 3;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DownloadItem {
    pub id: String,
    pub url: String,
    /// Zielpfad relativ zum Zielordner (Ordner + Dateiname).
    pub path: Vec<String>,
    pub size: i64,
    /// Änderungszeit auf dem Server (für den Verlauf).
    #[serde(default)]
    pub modified: i64,
    /// Datei hat sich auf dem Server geändert → vorhandene Datei nicht überspringen.
    #[serde(default)]
    pub stale: bool,
    #[serde(default)]
    pub is_link: bool,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct ProgressEvent<'a> {
    id: &'a str,
    state: &'a str,
    received: u64,
    total: u64,
    error: Option<String>,
}

#[derive(Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct Summary {
    pub downloaded: usize,
    pub skipped: usize,
    pub failed: usize,
    pub cancelled: bool,
    pub bytes: u64,
}

/// Erfolgreich vorhandene Datei – wandert in den Verlauf.
pub struct Completed {
    pub id: String,
    pub modified: i64,
    pub size: i64,
}

enum Outcome {
    Done(u64),
    Skipped,
    Cancelled,
}

struct FetchErr {
    msg: String,
    retry: bool,
}

impl FetchErr {
    fn fatal(msg: impl ToString) -> Self {
        Self { msg: msg.to_string(), retry: false }
    }
    fn transient(msg: impl ToString) -> Self {
        Self { msg: msg.to_string(), retry: true }
    }
}

/// Der Pfad kommt vom Server bzw. Frontend – nie ungeprüft verwenden.
pub fn sanitize(seg: &str) -> String {
    let cleaned: String = seg
        .chars()
        .map(|c| match c {
            '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|' => '_',
            c if c.is_control() => '_',
            c => c,
        })
        .collect();
    let trimmed = cleaned.trim().trim_matches('.').trim();
    if trimmed.is_empty() {
        "_".into()
    } else {
        trimmed.chars().take(180).collect()
    }
}

fn with_suffix(p: &Path, n: usize) -> PathBuf {
    let stem = p.file_stem().and_then(|s| s.to_str()).unwrap_or("datei");
    let name = match p.extension().and_then(|e| e.to_str()) {
        Some(ext) => format!("{stem} ({n}).{ext}"),
        None => format!("{stem} ({n})"),
    };
    p.with_file_name(name)
}

/// Berechnet eindeutige Zielpfade für den ganzen Auftrag.
pub fn plan(dest: &Path, items: Vec<DownloadItem>) -> Vec<(DownloadItem, PathBuf)> {
    let mut used: HashSet<String> = HashSet::new();
    items
        .into_iter()
        .map(|item| {
            let mut target = dest.to_path_buf();
            for seg in &item.path {
                target.push(sanitize(seg));
            }
            // Auf dem Mac sind .webloc-Dateien per Doppelklick anklickbar, .url nicht.
            if item.is_link && cfg!(target_os = "macos") {
                target.set_extension("webloc");
            }
            let mut n = 1;
            let mut candidate = target.clone();
            while !used.insert(candidate.to_string_lossy().to_lowercase()) {
                n += 1;
                candidate = with_suffix(&target, n);
            }
            (item, candidate)
        })
        .collect()
}

fn xml_escape(s: &str) -> String {
    s.replace('&', "&amp;").replace('<', "&lt;").replace('>', "&gt;")
}

fn shortcut_contents(url: &Url, webloc: bool) -> String {
    if webloc {
        format!(
            "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n<!DOCTYPE plist PUBLIC \"-//Apple//DTD PLIST 1.0//EN\" \"http://www.apple.com/DTDs/PropertyList-1.0.dtd\">\n<plist version=\"1.0\">\n<dict>\n\t<key>URL</key>\n\t<string>{}</string>\n</dict>\n</plist>\n",
            xml_escape(url.as_str())
        )
    } else {
        format!("[InternetShortcut]\r\nURL={}\r\n", url.as_str())
    }
}

fn emit(app: &AppHandle, id: &str, state: &str, received: u64, total: u64, error: Option<String>) {
    let _ = app.emit(
        "download-progress",
        ProgressEvent { id, state, received, total, error },
    );
}

async fn write_link(item: &DownloadItem, target: &Path) -> Result<Outcome, FetchErr> {
    let url = Url::parse(&item.url).map_err(|_| FetchErr::fatal("Ungültige Link-URL"))?;
    if !matches!(url.scheme(), "http" | "https") {
        return Err(FetchErr::fatal("Nur http(s)-Links werden gespeichert."));
    }
    if let Some(parent) = target.parent() {
        tokio::fs::create_dir_all(parent).await.map_err(FetchErr::fatal)?;
    }
    let webloc = target.extension().and_then(|e| e.to_str()) == Some("webloc");
    tokio::fs::write(target, shortcut_contents(&url, webloc))
        .await
        .map_err(FetchErr::fatal)?;
    Ok(Outcome::Done(0))
}

async fn fetch_once(
    app: &AppHandle,
    client: &Client,
    site_host: &str,
    token: &str,
    item: &DownloadItem,
    target: &Path,
    cancel: &AtomicBool,
) -> Result<Outcome, FetchErr> {
    if cancel.load(Ordering::Relaxed) {
        return Ok(Outcome::Cancelled);
    }
    if item.is_link {
        return write_link(item, target).await;
    }
    let expected = item.size.max(0) as u64;
    if expected > 0 && !item.stale {
        if let Ok(meta) = tokio::fs::metadata(target).await {
            if meta.is_file() && meta.len() == expected {
                return Ok(Outcome::Skipped);
            }
        }
    }

    let mut url = Url::parse(&item.url).map_err(|_| FetchErr::fatal("Ungültige Datei-URL"))?;
    // Token nur an den eigenen Moodle-Host schicken.
    if url.host_str() != Some(site_host) {
        return Err(FetchErr::fatal("Datei liegt auf einem fremden Server – übersprungen."));
    }
    url.query_pairs_mut().append_pair("token", token);

    emit(app, &item.id, "start", 0, expected, None);
    let resp = client.get(url).send().await.map_err(FetchErr::transient)?;
    let status = resp.status();
    if !status.is_success() {
        let msg = format!("HTTP {}", status.as_u16());
        return Err(if status.is_server_error() || status.as_u16() == 429 {
            FetchErr::transient(msg)
        } else {
            FetchErr::fatal(msg)
        });
    }
    let is_json = resp
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .is_some_and(|v| v.starts_with("application/json"));
    if is_json && !item.path.last().is_some_and(|n| n.ends_with(".json")) {
        return Err(FetchErr::fatal("Zugriff verweigert (Moodle lieferte eine Fehlermeldung)."));
    }
    let total = resp.content_length().unwrap_or(expected);

    if let Some(parent) = target.parent() {
        tokio::fs::create_dir_all(parent).await.map_err(FetchErr::fatal)?;
    }
    let mut part = target.as_os_str().to_owned();
    part.push(".part");
    let part = PathBuf::from(part);
    let mut file = tokio::fs::File::create(&part).await.map_err(FetchErr::fatal)?;

    let mut stream = resp.bytes_stream();
    let mut received = 0u64;
    let mut last_emit = Instant::now();
    let result: Result<(), FetchErr> = async {
        while let Some(chunk) = stream.next().await {
            if cancel.load(Ordering::Relaxed) {
                return Err(FetchErr::fatal("cancelled"));
            }
            let chunk = chunk.map_err(FetchErr::transient)?;
            file.write_all(&chunk).await.map_err(FetchErr::fatal)?;
            received += chunk.len() as u64;
            if last_emit.elapsed() > Duration::from_millis(120) {
                emit(app, &item.id, "progress", received, total, None);
                last_emit = Instant::now();
            }
        }
        file.flush().await.map_err(FetchErr::fatal)
    }
    .await;
    drop(file);

    match result {
        Ok(()) => {
            // Windows kann nicht über eine vorhandene Datei umbenennen.
            if item.stale {
                let _ = tokio::fs::remove_file(target).await;
            }
            tokio::fs::rename(&part, target).await.map_err(FetchErr::fatal)?;
            Ok(Outcome::Done(received))
        }
        Err(e) => {
            let _ = tokio::fs::remove_file(&part).await;
            if e.msg == "cancelled" {
                Ok(Outcome::Cancelled)
            } else {
                Err(e)
            }
        }
    }
}

/// Wiederholt kurzzeitige Fehler (Netz, 5xx, 429) mit wachsender Pause.
async fn fetch_with_retry(
    app: &AppHandle,
    client: &Client,
    site_host: &str,
    token: &str,
    item: &DownloadItem,
    target: &Path,
    cancel: &AtomicBool,
) -> Result<Outcome, String> {
    let mut attempt = 1;
    loop {
        match fetch_once(app, client, site_host, token, item, target, cancel).await {
            Ok(o) => return Ok(o),
            Err(e) if e.retry && attempt < MAX_ATTEMPTS && !cancel.load(Ordering::Relaxed) => {
                tokio::time::sleep(Duration::from_secs((attempt * attempt) as u64)).await;
                attempt += 1;
            }
            Err(e) => {
                return Err(if attempt > 1 {
                    format!("{} (nach {attempt} Versuchen)", e.msg)
                } else {
                    e.msg
                })
            }
        }
    }
}

fn host_of(site_url: &str) -> Result<String, String> {
    Url::parse(site_url)
        .ok()
        .and_then(|u| u.host_str().map(str::to_string))
        .ok_or_else(|| "Ungültige Moodle-Adresse".to_string())
}

pub async fn run(
    app: AppHandle,
    client: Client,
    site_url: String,
    token: String,
    dest: PathBuf,
    items: Vec<DownloadItem>,
    cancel: &AtomicBool,
) -> Result<(Summary, Vec<Completed>), String> {
    let site_host = host_of(&site_url)?;
    let jobs = plan(&dest, items);

    let outcomes: Vec<(Completed, Result<Outcome, String>)> = stream::iter(jobs)
        .map(|(item, target)| {
            let (app, client, host, token) = (&app, &client, &site_host, &token);
            async move {
                let r = fetch_with_retry(app, client, host, token, &item, &target, cancel).await;
                let total = item.size.max(0) as u64;
                match &r {
                    Ok(Outcome::Done(n)) => emit(app, &item.id, "done", *n, *n, None),
                    Ok(Outcome::Skipped) => emit(app, &item.id, "skipped", total, total, None),
                    Ok(Outcome::Cancelled) => emit(app, &item.id, "cancelled", 0, total, None),
                    Err(e) => emit(app, &item.id, "error", 0, total, Some(e.clone())),
                }
                (Completed { id: item.id, modified: item.modified, size: item.size }, r)
            }
        })
        .buffer_unordered(4)
        .collect()
        .await;

    let mut summary = Summary::default();
    let mut completed = Vec::new();
    for (c, r) in outcomes {
        match r {
            Ok(Outcome::Done(n)) => {
                summary.downloaded += 1;
                summary.bytes += n;
                completed.push(c);
            }
            Ok(Outcome::Skipped) => {
                summary.skipped += 1;
                completed.push(c);
            }
            Ok(Outcome::Cancelled) => summary.cancelled = true,
            Err(_) => summary.failed += 1,
        }
    }
    Ok((summary, completed))
}

/// Lädt eine Datei in den Temp-Ordner und gibt den Pfad für die Vorschau zurück.
pub async fn fetch_to_temp(
    app: &AppHandle,
    client: &Client,
    site_url: &str,
    token: &str,
    url: String,
    name: &str,
) -> Result<PathBuf, String> {
    let site_host = host_of(site_url)?;
    let dir = std::env::temp_dir().join("moodle-sync-preview");
    let target = dir.join(sanitize(name));
    let item = DownloadItem {
        id: "preview".into(),
        url,
        path: vec![name.to_string()],
        size: 0,
        modified: 0,
        stale: true,
        is_link: false,
    };
    let never = AtomicBool::new(false);
    match fetch_with_retry(app, client, &site_host, token, &item, &target, &never).await? {
        Outcome::Done(_) | Outcome::Skipped => Ok(target),
        Outcome::Cancelled => Err("Abgebrochen".into()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn item(path: &[&str], is_link: bool) -> DownloadItem {
        DownloadItem {
            id: "x".into(),
            url: "https://m/x".into(),
            path: path.iter().map(|s| s.to_string()).collect(),
            size: 1,
            modified: 0,
            stale: false,
            is_link,
        }
    }

    #[test]
    fn sanitize_blocks_traversal_and_bad_chars() {
        assert_eq!(sanitize(".."), "_");
        assert_eq!(sanitize("."), "_");
        assert_eq!(sanitize(""), "_");
        assert_eq!(sanitize("a/b\\c"), "a_b_c");
        assert_eq!(sanitize("Fr: Ist? <gut>|"), "Fr_ Ist_ _gut__");
        assert_eq!(sanitize("  Name.pdf  "), "Name.pdf");
        assert_eq!(sanitize(&"x".repeat(500)).chars().count(), 180);
    }

    #[test]
    fn plan_stays_inside_destination() {
        let dest = Path::new("/tmp/dest");
        let planned = plan(dest, vec![item(&["..", "..", "etc", "passwd"], false)]);
        let target = &planned[0].1;
        assert!(target.starts_with(dest));
        assert!(!target.components().any(|c| c.as_os_str() == ".."));
    }

    #[test]
    fn plan_dedupes_case_insensitively() {
        let dest = Path::new("/tmp/dest");
        let planned = plan(
            dest,
            vec![
                item(&["A", "Datei.pdf"], false),
                item(&["a", "datei.pdf"], false),
                item(&["A", "Datei.pdf"], false),
            ],
        );
        let paths: Vec<_> = planned.iter().map(|p| p.1.clone()).collect();
        assert_eq!(paths[0], dest.join("A").join("Datei.pdf"));
        assert_eq!(paths[1], dest.join("a").join("datei (2).pdf"));
        assert_eq!(paths[2], dest.join("A").join("Datei (3).pdf"));
    }

    #[test]
    fn shortcut_formats() {
        let url = Url::parse("https://example.org/a?x=1&y=2").unwrap();
        let ini = shortcut_contents(&url, false);
        assert!(ini.starts_with("[InternetShortcut]"));
        assert!(ini.contains("URL=https://example.org/a?x=1&y=2"));
        let plist = shortcut_contents(&url, true);
        assert!(plist.contains("x=1&amp;y=2"));
    }
}
