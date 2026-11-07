use std::time::Duration;

use reqwest::{Client, Url};
use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct StoredAccount {
    pub id: String,
    pub site_url: String,
    pub site_name: String,
    pub user_id: i64,
    pub fullname: String,
    pub username: String,
    pub token: String,
    /// Favicon der Moodle-Instanz als data-URL.
    #[serde(default)]
    pub icon: Option<String>,
}

/// Konto ohne Token – das geht ans Frontend.
#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct AccountInfo {
    pub id: String,
    pub site_url: String,
    pub site_name: String,
    pub user_id: i64,
    pub fullname: String,
    pub username: String,
    pub icon: Option<String>,
}

impl From<&StoredAccount> for AccountInfo {
    fn from(a: &StoredAccount) -> Self {
        Self {
            id: a.id.clone(),
            site_url: a.site_url.clone(),
            site_name: a.site_name.clone(),
            user_id: a.user_id,
            fullname: a.fullname.clone(),
            username: a.username.clone(),
            icon: a.icon.clone(),
        }
    }
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Index {
    pub account_id: String,
    pub synced_at: i64,
    pub courses: Vec<Course>,
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Course {
    pub id: i64,
    pub fullname: String,
    pub shortname: String,
    pub progress: Option<f64>,
    pub last_access: Option<i64>,
    pub hidden: bool,
    pub error: Option<String>,
    pub sections: Vec<Section>,
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Section {
    pub name: String,
    pub modules: Vec<Module>,
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Module {
    pub id: i64,
    pub name: String,
    pub modname: String,
    pub files: Vec<RemoteFile>,
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct RemoteFile {
    pub id: String,
    pub name: String,
    /// Unterordner innerhalb eines Ordner-Moduls, ohne führende/abschließende Slashes.
    pub folder: String,
    pub size: i64,
    pub url: String,
    pub mime: Option<String>,
    pub modified: i64,
    /// Externer Link (Moodle-Aktivität „URL“) statt Datei.
    #[serde(default)]
    pub is_link: bool,
}

fn net_err(e: reqwest::Error) -> String {
    if e.is_timeout() {
        "Zeitüberschreitung – der Moodle-Server antwortet nicht.".into()
    } else if e.is_connect() {
        "Keine Verbindung zum Server. Adresse und Internet prüfen.".into()
    } else {
        format!("Netzwerkfehler: {e}")
    }
}

/// Macht aus Eingaben wie `moodle.hs.de/login/index.php` die Basis-URL `https://moodle.hs.de`.
pub fn normalize_site_url(input: &str) -> Result<String, String> {
    let mut s = input.trim().to_string();
    if s.is_empty() {
        return Err("Bitte eine Moodle-Adresse eingeben.".into());
    }
    if !s.contains("://") {
        s = format!("https://{s}");
    }
    let url = Url::parse(&s).map_err(|_| "Ungültige Adresse.".to_string())?;
    if !matches!(url.scheme(), "http" | "https") {
        return Err("Nur http(s)-Adressen werden unterstützt.".into());
    }
    let host = url.host_str().ok_or("Ungültige Adresse.")?;
    let mut base = format!("{}://{host}", url.scheme());
    if let Some(p) = url.port() {
        base.push_str(&format!(":{p}"));
    }
    const STOP: [&str; 8] = [
        "login", "my", "course", "mod", "index.php", "user", "pluginfile.php", "webservice",
    ];
    for seg in url.path().split('/').filter(|s| !s.is_empty()) {
        if STOP.contains(&seg) {
            break;
        }
        base.push('/');
        base.push_str(seg);
    }
    Ok(base)
}

pub fn account_id(site_url: &str, user_id: i64) -> String {
    let host = site_url.split("://").nth(1).unwrap_or(site_url);
    let clean: String = host
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() { c } else { '_' })
        .collect();
    format!("{clean}-{user_id}")
}

fn error_message(v: &Value) -> Option<String> {
    let code = v.get("errorcode").and_then(Value::as_str);
    let msg = v
        .get("message")
        .or_else(|| v.get("error"))
        .and_then(Value::as_str);
    if code.is_none() && msg.is_none() && v.get("exception").is_none() {
        return None;
    }
    Some(match code {
        Some("invalidlogin") => "Benutzername oder Passwort falsch.".into(),
        Some("invalidtoken") | Some("accessexception") if msg.is_some_and(|m| m.contains("oken")) => {
            "Sitzung abgelaufen – bitte neu anmelden.".into()
        }
        Some("enablewsdescription") => {
            "Der Mobile-Webservice ist auf dieser Moodle-Instanz deaktiviert.".into()
        }
        _ => msg.unwrap_or("Unbekannter Moodle-Fehler.").to_string(),
    })
}

pub async fn login(
    client: &Client,
    site: &str,
    username: &str,
    password: &str,
) -> Result<StoredAccount, String> {
    let resp = client
        .post(format!("{site}/login/token.php"))
        .form(&[
            ("username", username),
            ("password", password),
            ("service", "moodle_mobile_app"),
        ])
        .timeout(Duration::from_secs(30))
        .send()
        .await
        .map_err(net_err)?;
    let v: Value = resp
        .json()
        .await
        .map_err(|_| "Unerwartete Antwort – ist das wirklich eine Moodle-Adresse?".to_string())?;
    let token = match v.get("token").and_then(Value::as_str) {
        Some(t) => t.to_string(),
        None => {
            return Err(error_message(&v).unwrap_or_else(|| {
                "Anmeldung nicht möglich. Bei SSO/Shibboleth-Logins wird der Token-Login oft blockiert."
                    .into()
            }))
        }
    };
    let info = call(client, site, &token, "core_webservice_get_site_info", &[]).await?;
    let user_id = info.get("userid").and_then(Value::as_i64).unwrap_or(0);
    let text = |k: &str| info.get(k).and_then(Value::as_str).unwrap_or("").to_string();
    let icon = fetch_icon(client, site).await;
    Ok(StoredAccount {
        id: account_id(site, user_id),
        site_url: site.to_string(),
        site_name: text("sitename"),
        user_id,
        fullname: text("fullname"),
        username: text("username"),
        token,
        icon,
    })
}

pub async fn call(
    client: &Client,
    site: &str,
    token: &str,
    function: &str,
    params: &[(&str, String)],
) -> Result<Value, String> {
    let mut form: Vec<(&str, String)> = vec![
        ("wstoken", token.to_string()),
        ("wsfunction", function.to_string()),
        ("moodlewsrestformat", "json".to_string()),
    ];
    form.extend(params.iter().map(|(k, v)| (*k, v.clone())));
    let resp = client
        .post(format!("{site}/webservice/rest/server.php"))
        .form(&form)
        .timeout(Duration::from_secs(60))
        .send()
        .await
        .map_err(net_err)?;
    let v: Value = resp
        .json()
        .await
        .map_err(|_| "Unerwartete Antwort vom Moodle-Server.".to_string())?;
    match error_message(&v) {
        Some(e) if v.is_object() => Err(e),
        _ => Ok(v),
    }
}

pub fn course_from_json(c: &Value) -> Course {
    let s = |k: &str| c.get(k).and_then(Value::as_str).unwrap_or("").to_string();
    let fullname = {
        let n = s("fullname");
        if n.is_empty() { s("displayname") } else { n }
    };
    Course {
        id: c.get("id").and_then(Value::as_i64).unwrap_or(0),
        fullname,
        shortname: s("shortname"),
        progress: c.get("progress").and_then(Value::as_f64),
        last_access: c.get("lastaccess").and_then(Value::as_i64).filter(|t| *t > 0),
        hidden: c.get("hidden").and_then(Value::as_bool).unwrap_or(false),
        error: None,
        sections: vec![],
    }
}

/// Wandelt die Antwort von `core_course_get_contents` in Abschnitte mit Datei-Modulen um.
pub fn parse_sections(course_id: i64, v: &Value) -> Vec<Section> {
    let mut sections = Vec::new();
    for (si, s) in v.as_array().into_iter().flatten().enumerate() {
        let mut modules = Vec::new();
        for m in s["modules"].as_array().into_iter().flatten() {
            let module_id = m["id"].as_i64().unwrap_or(0);
            let mut files = Vec::new();
            for (fi, c) in m["contents"].as_array().into_iter().flatten().enumerate() {
                let Some(url) = c["fileurl"].as_str() else { continue };
                match c["type"].as_str() {
                    Some("file") => {
                        let folder = c["filepath"]
                            .as_str()
                            .unwrap_or("/")
                            .trim_matches('/')
                            .to_string();
                        let name = c["filename"].as_str().unwrap_or("datei").to_string();
                        files.push(RemoteFile {
                            // Stabil auch dann, wenn sich die Reihenfolge im Kurs ändert.
                            id: format!("{course_id}:{module_id}:{folder}/{name}"),
                            name,
                            folder,
                            size: c["filesize"].as_i64().unwrap_or(0),
                            url: url.to_string(),
                            mime: c["mimetype"].as_str().map(str::to_string),
                            modified: c["timemodified"].as_i64().unwrap_or(0),
                            is_link: false,
                        });
                    }
                    Some("url") if url.starts_with("http://") || url.starts_with("https://") => {
                        let title = m["name"].as_str().unwrap_or("Link");
                        files.push(RemoteFile {
                            id: format!("{course_id}:{module_id}:link:{fi}"),
                            name: format!("{title}.url"),
                            folder: String::new(),
                            size: 0,
                            url: url.to_string(),
                            mime: None,
                            modified: c["timemodified"].as_i64().unwrap_or(0),
                            is_link: true,
                        });
                    }
                    _ => {}
                }
            }
            if !files.is_empty() {
                modules.push(Module {
                    id: module_id,
                    name: m["name"].as_str().unwrap_or("").to_string(),
                    modname: m["modname"].as_str().unwrap_or("").to_string(),
                    files,
                });
            }
        }
        if !modules.is_empty() {
            let name = s["name"].as_str().filter(|n| !n.is_empty());
            sections.push(Section {
                name: name.map(str::to_string).unwrap_or_else(|| format!("Abschnitt {si}")),
                modules,
            });
        }
    }
    sections
}

// ---------------------------------------------------------------------------
// Favicon
// ---------------------------------------------------------------------------

/// Sucht `<link rel="…icon…" href="…">` im HTML und löst die URLs gegen `base` auf.
fn icon_links(html: &str, base: &Url) -> Vec<Url> {
    let lower = html.to_ascii_lowercase();
    let mut out = Vec::new();
    let mut from = 0;
    while let Some(i) = lower[from..].find("<link") {
        let start = from + i;
        let Some(len) = lower[start..].find('>') else { break };
        let tag = &html[start..start + len];
        let tag_l = &lower[start..start + len];
        from = start + len;
        if !tag_l.contains("icon") {
            continue;
        }
        let Some(h) = tag_l.find("href=") else { continue };
        let rest = &tag[h + 5..];
        let Some(q) = rest.chars().next().filter(|c| *c == '"' || *c == '\'') else { continue };
        let Some(end) = rest[1..].find(q) else { continue };
        if let Ok(u) = base.join(&rest[1..1 + end]) {
            out.push(u);
        }
    }
    out
}

async fn fetch_image(client: &Client, url: Url) -> Option<String> {
    use base64::Engine;
    let resp = client
        .get(url.clone())
        .timeout(Duration::from_secs(8))
        .send()
        .await
        .ok()?;
    if !resp.status().is_success() {
        return None;
    }
    let ct = resp
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("")
        .split(';')
        .next()
        .unwrap_or("")
        .trim()
        .to_string();
    let is_ico = url.path().ends_with(".ico");
    if !ct.starts_with("image/") && !is_ico {
        return None;
    }
    let bytes = resp.bytes().await.ok()?;
    if bytes.is_empty() || bytes.len() > 300_000 {
        return None;
    }
    let ct = if ct.starts_with("image/") { ct } else { "image/x-icon".into() };
    Some(format!(
        "data:{ct};base64,{}",
        base64::engine::general_purpose::STANDARD.encode(&bytes)
    ))
}

/// Holt das Favicon der Moodle-Instanz (Best Effort, nie ein Fehler).
pub async fn fetch_icon(client: &Client, site: &str) -> Option<String> {
    let base = Url::parse(&format!("{site}/")).ok()?;
    let mut candidates = Vec::new();
    if let Ok(resp) = client
        .get(format!("{site}/login/index.php"))
        .timeout(Duration::from_secs(8))
        .send()
        .await
    {
        if let Ok(html) = resp.text().await {
            candidates.extend(icon_links(&html, &base));
        }
    }
    if let Ok(u) = base.join("favicon.ico") {
        candidates.push(u);
    }
    for url in candidates {
        if let Some(d) = fetch_image(client, url).await {
            return Some(d);
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn normalizes_urls() {
        let n = |s| normalize_site_url(s).unwrap();
        assert_eq!(n("moodle.hs.de"), "https://moodle.hs.de");
        assert_eq!(n("  https://moodle.hs.de/login/index.php "), "https://moodle.hs.de");
        assert_eq!(n("https://hs.de/moodle/my/"), "https://hs.de/moodle");
        assert_eq!(n("http://localhost:8080/course/view.php?id=3"), "http://localhost:8080");
        assert!(normalize_site_url("").is_err());
        assert!(normalize_site_url("ftp://x.de").is_err());
    }

    #[test]
    fn account_ids_are_filesystem_safe() {
        let id = account_id("https://hs.de:8443/moodle", 7);
        assert_eq!(id, "hs_de_8443_moodle-7");
    }

    #[test]
    fn parses_files_folders_and_links() {
        let v = json!([
            { "name": "", "modules": [] },
            { "name": "Woche 1", "modules": [
                { "id": 5, "name": "Skript", "modname": "resource", "contents": [
                    { "type": "file", "filename": "a.pdf", "filepath": "/", "filesize": 10,
                      "fileurl": "https://m/pluginfile.php/a.pdf", "timemodified": 99 } ] },
                { "id": 6, "name": "Ordner", "modname": "folder", "contents": [
                    { "type": "file", "filename": "b.zip", "filepath": "/Code/", "filesize": 5,
                      "fileurl": "https://m/pluginfile.php/b.zip", "timemodified": 1 } ] },
                { "id": 7, "name": "Doku", "modname": "url", "contents": [
                    { "type": "url", "fileurl": "https://example.org/doc" },
                    { "type": "url", "fileurl": "javascript:alert(1)" } ] },
                { "id": 8, "name": "Forum", "modname": "forum" }
            ] }
        ]);
        let sections = parse_sections(1, &v);
        assert_eq!(sections.len(), 1);
        assert_eq!(sections[0].name, "Woche 1");
        let m = &sections[0].modules;
        assert_eq!(m.len(), 3);
        assert_eq!(m[0].files[0].id, "1:5:/a.pdf");
        assert_eq!(m[1].files[0].folder, "Code");
        assert!(m[2].files[0].is_link);
        assert_eq!(m[2].files.len(), 1);
        assert_eq!(m[2].files[0].name, "Doku.url");
    }

    #[test]
    fn finds_icon_links() {
        let base = Url::parse("https://m.example/").unwrap();
        let html = r#"<head><link rel="stylesheet" href="x.css">
            <link rel="shortcut icon" href="https://m.example/theme/favicon" /></head>"#;
        let links = icon_links(html, &base);
        assert_eq!(links.len(), 1);
        assert_eq!(links[0].as_str(), "https://m.example/theme/favicon");
        let rel = icon_links(r#"<link rel='icon' href='/fav.png'>"#, &base);
        assert_eq!(rel[0].as_str(), "https://m.example/fav.png");
    }
}
