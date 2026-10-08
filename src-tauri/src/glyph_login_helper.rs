use base64::{engine::general_purpose::STANDARD, Engine};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashMap;
use std::path::Path;
use std::time::{SystemTime, UNIX_EPOCH};

const DEFAULT_BASE_URL: &str = "https://auth.trionworlds.com";
pub const DEFAULT_USER_AGENT: &str = "Glyph (stable-251-1-a-337054)";
pub const DEFAULT_TROVE_EXE_PATH: &str = r"C:\Program Files (x86)\Glyph\Games\Trove\Live\Trove_x64.exe";

fn preferred_drive_letter() -> Option<char> {
    let from_user_profile = std::env::var("USERPROFILE")
        .ok()
        .and_then(|v| v.chars().next())
        .map(|c| c.to_ascii_uppercase());

    let from_home_drive = std::env::var("HOMEDRIVE")
        .ok()
        .and_then(|v| v.chars().next())
        .map(|c| c.to_ascii_uppercase());

    from_user_profile.or(from_home_drive)
}

fn available_drive_letters() -> Vec<char> {
    ('A'..='Z')
        .filter(|drive| {
            let root = format!("{}:\\", drive);
            Path::new(&root).exists()
        })
        .collect()
}

fn ordered_drive_letters() -> Vec<char> {
    let mut drives = available_drive_letters();
    if let Some(preferred) = preferred_drive_letter() {
        if let Some(idx) = drives.iter().position(|d| *d == preferred) {
            drives.remove(idx);
            drives.insert(0, preferred);
        }
    }
    drives
}

fn build_trove_exe_candidates() -> Vec<String> {
    let mut candidates = Vec::new();
    for drive in ordered_drive_letters() {
        candidates.push(format!(
            r"{}:\Program Files (x86)\Glyph\Games\Trove\Live\Trove_x64.exe",
            drive
        ));
    }

    if candidates.is_empty() {
        candidates.push(DEFAULT_TROVE_EXE_PATH.to_string());
    }

    candidates
}

pub fn resolve_trove_exe_path(custom_path: Option<&str>) -> Result<String, String> {
    if let Some(path) = custom_path.map(str::trim).filter(|p| !p.is_empty()) {
        if Path::new(path).is_file() {
            return Ok(path.to_string());
        }
        return Err(format!(
            "Configured Trove executable path does not exist: {}",
            path
        ));
    }

    let candidates = build_trove_exe_candidates();
    for candidate in &candidates {
        if Path::new(candidate).is_file() {
            return Ok(candidate.to_string());
        }
    }

    let checked = if candidates.len() <= 8 {
        candidates.join(", ")
    } else {
        format!("{} candidates", candidates.len())
    };

    Err(format!(
        "Could not find Trove executable. Checked: {}",
        checked
    ))
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GlyphLoginRequest {
    pub email: String,
    pub password: String,
    pub auth_code: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GlyphLoginResult {
    pub status_code: u16,
    pub token: String,
    pub auth_ticket_xml: String,
    pub account_id: Option<String>,
    pub account_status: Option<String>,
    pub channel_id: Option<String>,
    pub details_b64: String,
    pub saved_at_unix: u64,
    pub trion_error: Option<String>,
    pub trion_error_message: Option<String>,
    pub trion_error_url: Option<String>,
    pub trion_token_required: Option<String>,
}

pub fn get_auth_server_args(region: &str) -> String {
    match region.to_uppercase().as_str() {
        "NA" => "dal-c35-b05.dal.triongames.com:6560|dal-c35-b06.dal.triongames.com:6560|dal-c35-b07.dal.triongames.com:6560|dal-c35-b08.dal.triongames.com:6560|dal-c35-b09.dal.triongames.com:6560".to_string(),
        "PTS" => "auth-pcpts01.trovegame.com:6560|auth-pcpts02.trovegame.com:6560".to_string(),
        "EU" => "ams-c12-b01.ams.triongames.com:6560|ams-c12-b02.ams.triongames.com:6560|ams-c12-b03.ams.triongames.com:6560|ams-c12-b04.ams.triongames.com:6560|ams-c12-b05.ams.triongames.com:6560".to_string(),

        "XB_NA" => "dal-c11-b01.dal.triongames.com:6560|dal-c11-b02.dal.triongames.com:6560|dal-c11-b03.dal.triongames.com:6560|dal-c11-b04.dal.triongames.com:6560|dal-c11-b05.dal.triongames.com:6560|dal-c15-b01.dal.triongames.com:6560|dal-c16-b01.dal.triongames.com:6560|dal-c16-b02.dal.triongames.com:6560|dal-c16-b03.dal.triongames.com:6560|dal-c16-b04.dal.triongames.com:6560|dal-c17-b01.dal.triongames.com:6560|dal-c17-b02.dal.triongames.com:6560|dal-c17-b03.dal.triongames.com:6560|dal-c17-b04.dal.triongames.com:6560|dal-c17-b05.dal.triongames.com:6560|dal-c19-b01.dal.triongames.com:6560|dal-c19-b02.dal.triongames.com:6560|dal-c20-b01.dal.triongames.com:6560|dal-c20-b02.dal.triongames.com:6560|dal-c20-b03.dal.triongames.com:6560|dal-c20-b04.dal.triongames.com:6560".to_string(),
        "XB_EU" => "ams-c11-b01.ams.triongames.com:6560".to_string(),

        _ => "ams-c12-b01.ams.triongames.com:6560|ams-c12-b02.ams.triongames.com:6560|ams-c12-b03.ams.triongames.com:6560|ams-c12-b04.ams.triongames.com:6560|ams-c12-b05.ams.triongames.com:6560".to_string(),
    }
}

pub fn resolve_trove_x64_exe_path_for_region(custom_path: Option<&str>, region: &str) -> Result<String, String> {
    if let Some(path) = custom_path.map(str::trim).filter(|p| !p.is_empty()) {
        if Path::new(path).is_file() {
            return Ok(path.to_string());
        }
        return Err(format!("Configured Trove executable path does not exist: {}", path));
    }

    if region.to_uppercase() == "PTS" {
        for drive in ordered_drive_letters() {
            let pts = format!(r"{}:\Program Files (x86)\Glyph\Games\Trove\PTS\Trove_x64.exe", drive);
            if Path::new(&pts).is_file() {
                return Ok(pts);
            }
        }
    }

    for drive in ordered_drive_letters() {
        let x64 = format!(r"{}:\Program Files (x86)\Glyph\Games\Trove\Live\Trove_x64.exe", drive);
        if Path::new(&x64).is_file() {
            return Ok(x64);
        }
    }

    Err("Could not find Trove_x64.exe. Is Trove installed?".to_string())
}

fn now_unix() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
}

fn extract_xml_tag(text: &str, tag: &str) -> Option<String> {
    let open = format!("<{}>", tag);
    let close = format!("</{}>", tag);
    let start = text.find(&open)? + open.len();
    let rel_end = text[start..].find(&close)?;
    Some(text[start..start + rel_end].to_string())
}

fn extract_auth_ticket_xml(text: &str) -> Option<String> {
    if let Some(start) = text.find("<?xml") {
        if let Some(rel_end) = text[start..].find("</authTicket>") {
            let end = start + rel_end + "</authTicket>".len();
            return Some(text[start..end].to_string());
        }
    }

    if let Some(start) = text.find("<authTicket") {
        if let Some(rel_end) = text[start..].find("</authTicket>") {
            let end = start + rel_end + "</authTicket>".len();
            return Some(text[start..end].to_string());
        }
    }

    None
}

fn build_saved_details_b64(raw_response: &str) -> String {
    STANDARD.encode(raw_response.as_bytes())
}

pub async fn touch_account_saved(details_b64: String) -> Result<GlyphLoginResult, String> {
    let token_bytes = base64::engine::general_purpose::STANDARD
        .decode(details_b64.trim().as_bytes())
        .map_err(|e| format!("Invalid details_b64: {}", e))?;

    if token_bytes.is_empty() {
        return Err("Stored session is empty - please login first.".to_string());
    }

    let url = format!("{}/multitouch/v1_2", DEFAULT_BASE_URL.trim_end_matches('/'));

    let client = reqwest::Client::new();
    let response = client
        .post(&url)
        .header("User-Agent", DEFAULT_USER_AGENT)
        .header("Content-Type", "application/octet-stream")
        .body(token_bytes)
        .send()
        .await
        .map_err(|e| e.to_string())?;

    let status_code = response.status().as_u16();

    let trion_error = response
        .headers()
        .get("X-Trionworlds-Error")
        .and_then(|v| v.to_str().ok())
        .map(|s| s.to_string());

    let trion_error_message = response
        .headers()
        .get("X-Trionworlds-Error-Message")
        .and_then(|v| v.to_str().ok())
        .map(|s| s.to_string());

    let trion_error_url = response
        .headers()
        .get("X-Trionworlds-Error-Url")
        .and_then(|v| v.to_str().ok())
        .map(|s| s.to_string());

    let trion_token_required = response
        .headers()
        .get("X-Trionworlds-Token-Required")
        .and_then(|v| v.to_str().ok())
        .map(|s| s.to_string());

    let response_text = response.text().await.map_err(|e| e.to_string())?;

    if let Some(ref err_code) = trion_error {
        let mut msg = format!("Touch failed: {}", err_code);
        if let Some(ref err_msg) = trion_error_message {
            if !err_msg.trim().is_empty() {
                msg.push_str(&format!(" ({})", err_msg));
            }
        }
        return Err(msg);
    }

    if !(200..300).contains(&status_code) {
        let preview = response_text.chars().take(240).collect::<String>();
        return Err(format!(
            "Touch failed with HTTP {}. Response: {}",
            status_code, preview
        ));
    }

    let parsed_json: Option<serde_json::Value> = serde_json::from_str(&response_text).ok();
    let token_json = parsed_json
        .as_ref()
        .and_then(|v| v.get("token"))
        .and_then(|v| v.as_str())
        .map(|s| s.to_string())
        .unwrap_or_default();

    let auth_ticket_xml = extract_auth_ticket_xml(&response_text).unwrap_or_default();

    let token = if token_json.is_empty() {
        auth_ticket_xml.clone()
    } else {
        token_json
    };

    if token.is_empty() {
        let preview = response_text.chars().take(240).collect::<String>();
        return Err(format!(
            "Touch returned no token/auth ticket. Body: {}",
            preview
        ));
    }

    let account_id = extract_xml_tag(&response_text, "accountId");
    let account_status = extract_xml_tag(&response_text, "accountStatus");
    let channel_id = extract_xml_tag(&response_text, "channelId");

    let details_b64 = build_saved_details_b64(&response_text);
    let saved_at_unix = now_unix();

    Ok(GlyphLoginResult {
        status_code,
        token,
        auth_ticket_xml,
        account_id,
        account_status,
        channel_id,
        details_b64,
        saved_at_unix,
        trion_error,
        trion_error_message,
        trion_error_url,
        trion_token_required,
    })
}

pub async fn login_account_and_store(req: GlyphLoginRequest) -> Result<GlyphLoginResult, String> {
    let email = req.email.trim().to_string();
    let password = req.password;

    if email.is_empty() || password.is_empty() {
        return Err("Email and password are required".to_string());
    }

    let trimmed_auth_code = req
        .auth_code
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(str::to_string);

    let url = format!("{}/multiauth/v1_2", DEFAULT_BASE_URL.trim_end_matches('/'));

    let mut form = HashMap::<String, String>::new();
    form.insert("username".to_string(), email.clone());
    form.insert("password".to_string(), password);
    form.insert("channel".to_string(), "131".to_string());
    form.insert("includeStoreToken".to_string(), "1".to_string());
    form.insert("publicMachine".to_string(), "0".to_string());

    if let Some(ref auth_code) = trimmed_auth_code {
        form.insert("token".to_string(), auth_code.to_string());
    }

    let user_agent = DEFAULT_USER_AGENT.to_string();

    let client = reqwest::Client::new();
    let response = client
        .post(url)
        .header("User-Agent", user_agent)
        .header("Content-Type", "application/x-www-form-urlencoded")
        .form(&form)
        .send()
        .await
        .map_err(|e| e.to_string())?;

    let status_code = response.status().as_u16();

    let trion_error = response
        .headers()
        .get("X-Trionworlds-Error")
        .and_then(|v| v.to_str().ok())
        .map(|s| s.to_string());

    let trion_error_message = response
        .headers()
        .get("X-Trionworlds-Error-Message")
        .and_then(|v| v.to_str().ok())
        .map(|s| s.to_string());

    let trion_error_url = response
        .headers()
        .get("X-Trionworlds-Error-Url")
        .and_then(|v| v.to_str().ok())
        .map(|s| s.to_string());

    let trion_token_required = response
        .headers()
        .get("X-Trionworlds-Token-Required")
        .and_then(|v| v.to_str().ok())
        .map(|s| s.to_string());

    let response_text = response.text().await.map_err(|e| e.to_string())?;

    if let Some(ref token_req) = trion_token_required {
        let token_req_lower = token_req.to_lowercase();
        let is_email_2fa = token_req_lower.contains("email");
        let is_mobile_2fa = token_req_lower.contains("mobile");

        if is_email_2fa || is_mobile_2fa {
            if trimmed_auth_code.is_some() {
                let method = if is_mobile_2fa { "authenticator app" } else { "email" };
                return Err(format!("Invalid authentication code. Please check your {} and try again.", method));
            }
            return Ok(GlyphLoginResult {
                status_code,
                token: String::new(),
                auth_ticket_xml: String::new(),
                account_id: None,
                account_status: None,
                channel_id: None,
                details_b64: String::new(),
                saved_at_unix: now_unix(),
                trion_error: None,
                trion_error_message: None,
                trion_error_url: None,
                trion_token_required,
            });
        }
    }

    if let Some(err_code) = trion_error.clone() {
        let mut msg = format!("Glyph login failed: {}", err_code);
        if let Some(err_msg) = trion_error_message.clone() {
            if !err_msg.trim().is_empty() {
                msg.push_str(&format!(" ({})", err_msg));
            }
        }
        if let Some(err_url) = trion_error_url.clone() {
            if !err_url.trim().is_empty() {
                msg.push_str(&format!(" [{}]", err_url));
            }
        }
        return Err(msg);
    }

    if !(200..300).contains(&status_code) {
        if status_code == 500 {
            return Err("Account does not exist".to_string());
        }
        let preview = response_text.chars().take(240).collect::<String>();
        return Err(format!(
            "Glyph login failed with HTTP {}. Response: {}",
            status_code, preview
        ));
    }

    {
        let trimmed = response_text.trim_start();
        let is_html = trimmed.starts_with("<!") || trimmed.to_lowercase().starts_with("<html");
        if is_html {
            if trimmed.contains("Error 500") || trimmed.contains("error 500") {
                return Err("Account does not exist".to_string());
            }
            return Err("Glyph returned an unexpected HTML response. The service may be down.".to_string());
        }
    }

    let parsed_json: Option<Value> = serde_json::from_str(&response_text).ok();
    let token_json = parsed_json
        .as_ref()
        .and_then(|v| v.get("token"))
        .and_then(|v| v.as_str())
        .map(|s| s.to_string())
        .unwrap_or_default();

    let auth_ticket_xml = extract_auth_ticket_xml(&response_text).unwrap_or_default();

    let token = if token_json.is_empty() {
        auth_ticket_xml.clone()
    } else {
        token_json
    };

    if token.is_empty() {
        let preview = response_text.chars().take(240).collect::<String>();
        return Err(format!(
            "Glyph login failed: no token/auth ticket in response. Body: {}",
            preview
        ));
    }

    let account_id = extract_xml_tag(&response_text, "accountId");
    let account_status = extract_xml_tag(&response_text, "accountStatus");
    let channel_id = extract_xml_tag(&response_text, "channelId");

    let details_b64 = build_saved_details_b64(&response_text);
    let saved_at_unix = now_unix();

    Ok(GlyphLoginResult {
        status_code,
        token,
        auth_ticket_xml,
        account_id,
        account_status,
        channel_id,
        details_b64,
        saved_at_unix,
        trion_error,
        trion_error_message,
        trion_error_url,
        trion_token_required,
    })
}
