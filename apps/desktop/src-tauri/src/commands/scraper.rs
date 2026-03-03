use std::time::Duration;
use tauri::{AppHandle, Listener, Manager, WebviewUrl, WebviewWindowBuilder};
use tokio::time::sleep;

const BROWSER_WINDOW_LABEL: &str = "agent_browser_window";

fn get_or_create_browser_window(app: &AppHandle) -> Result<tauri::WebviewWindow, String> {
    if let Some(window) = app.get_webview_window(BROWSER_WINDOW_LABEL) {
        return Ok(window);
    }

    let window_builder = WebviewWindowBuilder::new(
        app,
        BROWSER_WINDOW_LABEL,
        WebviewUrl::External("about:blank".parse().unwrap()),
    )
    .visible(false)
    .transparent(true)
    .decorations(false)
    .inner_size(1024.0, 768.0)
    .position(-10000.0, -10000.0);

    window_builder
        .build()
        .map_err(|e| format!("Failed to create browser window: {}", e))
}

async fn get_page_content(
    app: &AppHandle,
    window: &tauri::WebviewWindow,
    extract_html: bool,
) -> Result<String, String> {
    let request_id = uuid::Uuid::new_v4().simple().to_string();
    let event_name = format!("browser_response_{}", request_id);

    let (tx, mut rx) = tokio::sync::mpsc::unbounded_channel();

    let handler_id = app.listen(event_name.clone(), move |event| {
        let payload = event.payload().to_string();
        let _ = tx.send(payload);
    });

    let js = if extract_html {
        // Fallback for simple data extraction; might be blocked by strict CSP but we try.
        format!(
            r#"
            (function() {{
                try {{
                    window.__TAURI__.event.emit('{}', document.documentElement.outerHTML);
                }} catch (e) {{
                    window.__TAURI__.event.emit('{}', 'CSP_BLOCKED');
                }}
            }})();
            "#,
            event_name, event_name
        )
    } else {
        let base_js = include_str!("../scripts/dom_injector.js");
        base_js.replace("__SYNTHESIS_EVENT_NAME__", &event_name)
    };

    window
        .eval(&js)
        .map_err(|e| format!("Eval failed: {}", e))?;

    let result = match tokio::time::timeout(Duration::from_secs(8), rx.recv()).await {
        Ok(Some(payload)) => {
            if payload.contains("CSP_BLOCKED") {
                return Err("CSP Blocked script injection".to_string());
            }
            let mut cleaned = payload;
            if cleaned.starts_with('"') && cleaned.ends_with('"') && cleaned.len() >= 2 {
                cleaned = cleaned[1..cleaned.len() - 1].to_string();
                cleaned = cleaned.replace("\\n", "\n").replace("\\\"", "\"");
                if extract_html {
                    // Reverse some basic Tauri JSON string escapes for HTML
                    cleaned = cleaned.replace("\\/", "/").replace("\\t", "\t");
                }
            }
            Ok(cleaned)
        }
        Ok(None) => Err("Channel closed unexpectedly".to_string()),
        Err(_) => Err("Timeout waiting for browser response".to_string()),
    };

    app.unlisten(handler_id);

    result
}

#[tauri::command]
pub async fn browser_navigate(app: AppHandle, url: String) -> Result<String, String> {
    let window = get_or_create_browser_window(&app)?;

    window
        .navigate(url.parse().map_err(|e| format!("Invalid URL: {}", e))?)
        .map_err(|e| format!("Navigation failed: {}", e))?;

    sleep(Duration::from_secs(3)).await;

    match get_page_content(&app, &window, false).await {
        Ok(md) => Ok(md),
        Err(e) => {
            log::warn!(
                "WebView scrape failed (CSP/Timeout): {}, falling back to reqwest",
                e
            );

            let client = reqwest::Client::builder()
                .user_agent("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36")
                .timeout(Duration::from_secs(10))
                .build()
                .map_err(|e| format!("Reqwest client error: {}", e))?;

            match client.get(&url).send().await {
                Ok(resp) => {
                    let text = resp.text().await.unwrap_or_default();
                    if text.is_empty() {
                        Err("Empty response from native HTTP fetch fallback".to_string())
                    } else {
                        // For browser_navigate, we prepend a system warning so the agent knows why there are no IDs.
                        let warning = "[SYSTEM ERROR: This website has strict security policies (CSP) that block interactive navigation. You can read the raw HTML below, but you CANNOT use browser_click or browser_type here. Return a final answer based on what you read.]\n\n";
                        Ok(format!("{}{}", warning, text))
                    }
                }
                Err(err) => Err(format!("Native fetch fallback failed: {}", err)),
            }
        }
    }
}

#[tauri::command]
pub async fn scrape_url(app: AppHandle, url: String) -> Result<String, String> {
    let window = get_or_create_browser_window(&app)?;

    window
        .navigate(url.parse().map_err(|e| format!("Invalid URL: {}", e))?)
        .map_err(|e| format!("Navigation failed: {}", e))?;

    sleep(Duration::from_secs(3)).await;

    // Try the WebView injection first (allows executing JS on SPAs before scraping)
    match get_page_content(&app, &window, true).await {
        Ok(html) => Ok(html),
        Err(e) => {
            log::warn!(
                "WebView scrape failed (CSP/Timeout): {}, falling back to reqwest",
                e
            );

            // Fallback for strict CSP sites (like Wikipedia) that block our inline script
            let client = reqwest::Client::builder()
                .user_agent("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36")
                .timeout(Duration::from_secs(10))
                .build()
                .map_err(|e| format!("Reqwest client error: {}", e))?;

            match client.get(&url).send().await {
                Ok(resp) => {
                    let text = resp.text().await.unwrap_or_default();
                    if text.is_empty() {
                        Err("Empty response from native HTTP fetch fallback".to_string())
                    } else {
                        Ok(text)
                    }
                }
                Err(err) => Err(format!("Native fetch fallback failed: {}", err)),
            }
        }
    }
}

#[tauri::command]
pub async fn browser_interact(
    app: AppHandle,
    action: String,
    target_id: Option<String>,
    text: Option<String>,
) -> Result<String, String> {
    let window = get_or_create_browser_window(&app)?;

    let id = target_id.unwrap_or_default();

    let js = match action.as_str() {
        "click" => format!(
            r#"
            (function() {{
                let el = document.querySelector('[synthesis-id="{}"]');
                if(el) {{ el.click(); }}
            }})();
            "#,
            id
        ),
        "type" => format!(
            r#"
            (function() {{
                let el = document.querySelector('[synthesis-id="{}"]');
                if(el) {{ 
                    el.value = "{}";
                    el.dispatchEvent(new Event('input', {{ bubbles: true }}));
                    el.dispatchEvent(new Event('change', {{ bubbles: true }}));
                }}
            }})();
            "#,
            id,
            text.unwrap_or_default().replace("\"", "\\\"")
        ),
        _ => return Err(format!("Unknown action: {}", action)),
    };

    window
        .eval(&js)
        .map_err(|e| format!("Action eval failed: {}", e))?;

    sleep(Duration::from_secs(2)).await;

    get_page_content(&app, &window, false).await
}
