use std::collections::HashMap;
use std::io::{BufRead, BufReader, Read, Write};
use std::net::{TcpListener, TcpStream};
use std::path::PathBuf;
use std::process::{Child, Command};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use serde::Serialize;
use serde_json::{json, Value};

const UPSTREAM_ORIGIN: &str = "https://api.deepseek.com";
const SEARCH_TTL_SECS: u64 = 20 * 60;
const FETCH_TTL_SECS: u64 = 60 * 60;
const MAX_CONTENT_CHARS: usize = 6000;
const MAX_DOWNLOAD_BYTES: usize = 5 * 1024 * 1024;

#[derive(Clone)]
struct CacheEntry {
    expires_at: u64,
    payload: Value,
}

#[derive(Default)]
struct MemoryToolCache {
    search: Mutex<HashMap<String, CacheEntry>>,
    fetch: Mutex<HashMap<String, CacheEntry>>,
    search_hits: AtomicU64,
    fetch_hits: AtomicU64,
    upstream_calls: AtomicU64,
}

pub struct CacheServerHolder {
    child: Mutex<Option<Child>>,
    running_flag: Arc<AtomicBool>,
    port: Mutex<u16>,
    cache: Arc<MemoryToolCache>,
}

impl Default for CacheServerHolder {
    fn default() -> Self {
        Self {
            child: Mutex::new(None),
            running_flag: Arc::new(AtomicBool::new(false)),
            port: Mutex::new(8787),
            cache: Arc::new(MemoryToolCache::default()),
        }
    }
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CacheServerStatus {
    pub running: bool,
    pub url: String,
    pub mode: String,
    pub search_cached: usize,
    pub fetch_cached: usize,
    pub search_hits: u64,
    pub fetch_hits: u64,
    pub upstream_calls: u64,
}

fn now_secs() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

fn find_node_server_script() -> Option<PathBuf> {
    let candidates = [
        PathBuf::from("cache-server/server.mjs"),
        PathBuf::from("../cache-server/server.mjs"),
        PathBuf::from("../../cache-server/server.mjs"),
    ];
    for p in candidates {
        if p.exists() {
            return Some(p);
        }
    }
    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            let bundled = dir.join("cache-server").join("server.mjs");
            if bundled.exists() {
                return Some(bundled);
            }
        }
    }
    None
}

fn try_spawn_node_server(port: u16) -> Option<Child> {
    let script = find_node_server_script()?;
    let mut cmd = Command::new("node");
    cmd.arg(&script).env("CACHE_PORT", port.to_string());
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x0800_0000);
    }
    cmd.spawn().ok()
}

fn strip_html_tags(input: &str) -> String {
    let mut out = String::with_capacity(input.len());
    let mut in_tag = false;
    for ch in input.chars() {
        match ch {
            '<' => {
                in_tag = true;
                out.push(' ');
            }
            '>' => in_tag = false,
            _ if !in_tag => out.push(ch),
            _ => {}
        }
    }
    out.replace("&nbsp;", " ")
        .replace("&amp;", "&")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", "\"")
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
}

fn extract_tag_content(html: &str, open_prefix: &str, close_tag: &str) -> String {
    let lower = html.to_lowercase();
    if let Some(start) = lower.find(open_prefix) {
        if let Some(gt) = lower[start..].find('>') {
            let content_start = start + gt + 1;
            if let Some(end) = lower[content_start..].find(close_tag) {
                return strip_html_tags(&html[content_start..content_start + end]);
            }
        }
    }
    String::new()
}

fn strip_block_tags(html: &str, tag: &str) -> String {
    let mut current = html.to_string();
    let open = format!("<{}", tag);
    let close = format!("</{}>", tag);
    loop {
        let lower = current.to_lowercase();
        let Some(s) = lower.find(&open) else { break };
        let Some(e_rel) = lower[s..].find(&close) else { break };
        let e = s + e_rel + close.len();
        current.replace_range(s..e, " ");
    }
    current
}

fn extract_readable_html(html: &str) -> (String, String) {
    let title = extract_tag_content(html, "<title", "</title>");
    let mut clean = html.to_string();
    for tag in ["script", "style", "noscript", "svg", "iframe", "nav", "header", "footer", "aside"] {
        clean = strip_block_tags(&clean, tag);
    }
    let text = strip_html_tags(&clean);
    let trimmed: String = text.chars().take(MAX_CONTENT_CHARS).collect();
    (title, trimmed)
}

fn parse_bing_links(html: &str, limit: usize) -> Vec<Value> {
    let mut results = Vec::new();
    let lower = html.to_lowercase();
    let mut pos = 0;
    while results.len() < limit {
        let Some(idx_rel) = lower[pos..].find("class=\"b_algo\"") else { break };
        let block_start = pos + idx_rel;
        let block_end = lower[block_start..]
            .find("</li>")
            .map(|x| block_start + x)
            .unwrap_or(html.len());
        let block = &html[block_start..block_end];
        if let Some(href_start) = block.find("href=\"") {
            let after_href = &block[href_start + 6..];
            if let Some(href_end) = after_href.find('"') {
                let raw_url = &after_href[..href_end];
                let title_area = &after_href[href_end + 1..];
                let title = title_area
                    .find('>')
                    .and_then(|gt| title_area[gt + 1..].find("</a>").map(|end| strip_html_tags(&title_area[gt + 1..gt + 1 + end])))
                    .unwrap_or_default();
                let snippet = extract_tag_content(block, "<p", "</p>");
                if raw_url.starts_with("http") && !title.is_empty() {
                    results.push(json!({
                        "title": title,
                        "url": raw_url,
                        "snippet": snippet,
                        "source": "bing"
                    }));
                }
            }
        }
        pos = block_end;
    }
    results
}

fn run_search(client: &reqwest::Client, cache: &MemoryToolCache, query: &str, limit: usize) -> Value {
    let clean = query.trim();
    if clean.is_empty() {
        return json!({ "ok": false, "query": "", "results": [] });
    }
    let key = format!("{}::{}", clean.to_lowercase(), limit);
    if let Ok(guard) = cache.search.lock() {
        if let Some(entry) = guard.get(&key) {
            if entry.expires_at > now_secs() {
                cache.search_hits.fetch_add(1, Ordering::Relaxed);
                let mut v = entry.payload.clone();
                if let Some(obj) = v.as_object_mut() {
                    obj.insert("cached".into(), Value::Bool(true));
                }
                return v;
            }
        }
    }

    let url = format!(
        "https://cn.bing.com/search?q={}&count={}",
        clean.replace(' ', "+"),
        limit
    );
    let results = tauri::async_runtime::block_on(async {
        let resp = client
            .get(&url)
            .header("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/126.0.0.0 Safari/537.36")
            .header("Accept-Language", "zh-CN,zh;q=0.9,en;q=0.8")
            .send()
            .await;
        match resp {
            Ok(r) if r.status().is_success() => {
                let html = r.text().await.unwrap_or_default();
                parse_bing_links(&html, limit)
            }
            _ => Vec::new(),
        }
    });

    let payload = json!({
        "ok": true,
        "query": clean,
        "backend": if results.is_empty() { "none" } else { "bing" },
        "results": results,
        "cached": false
    });
    if !results.is_empty() {
        if let Ok(mut guard) = cache.search.lock() {
            guard.insert(
                key,
                CacheEntry {
                    expires_at: now_secs() + SEARCH_TTL_SECS,
                    payload: payload.clone(),
                },
            );
        }
    }
    payload
}

fn run_fetch(client: &reqwest::Client, cache: &MemoryToolCache, raw_url: &str) -> Value {
    let clean = raw_url.trim();
    if !clean.starts_with("http://") && !clean.starts_with("https://") {
        return json!({ "ok": false, "url": clean, "error": "仅支持 http/https" });
    }
    if clean.contains("://127.") || clean.contains("://localhost") || clean.contains("://192.168.") || clean.contains("://10.") {
        return json!({ "ok": false, "url": clean, "error": "禁止抓取本地地址" });
    }
    if let Ok(guard) = cache.fetch.lock() {
        if let Some(entry) = guard.get(clean) {
            if entry.expires_at > now_secs() {
                cache.fetch_hits.fetch_add(1, Ordering::Relaxed);
                let mut v = entry.payload.clone();
                if let Some(obj) = v.as_object_mut() {
                    obj.insert("cached".into(), Value::Bool(true));
                }
                return v;
            }
        }
    }

    let out = tauri::async_runtime::block_on(async {
        let resp = client
            .get(clean)
            .header("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/126.0.0.0 Safari/537.36")
            .send()
            .await;
        match resp {
            Ok(r) => {
                let status = r.status().as_u16();
                if status >= 400 {
                    return json!({ "ok": false, "url": clean, "status": status, "error": format!("HTTP {}", status) });
                }
                let ct = r
                    .headers()
                    .get("content-type")
                    .and_then(|v| v.to_str().ok())
                    .unwrap_or("")
                    .to_lowercase();
                let bytes = r.bytes().await.unwrap_or_default();
                let size_kb = bytes.len() / 1024;
                if bytes.len() > MAX_DOWNLOAD_BYTES {
                    return json!({ "ok": false, "url": clean, "error": "文件超过 5MB 上限" });
                }
                let head = bytes.get(..5).unwrap_or_default();
                if ct.starts_with("image/") || head.starts_with(&[0x89, 0x50, 0x4E, 0x47]) || head.starts_with(&[0xFF, 0xD8]) {
                    return json!({
                        "ok": true, "url": clean, "title": "图片资源",
                        "content": format!("[图片资源 ({}, {} KB): {}]", ct, size_kb, clean),
                        "cached": false
                    });
                }
                if ct.contains("application/pdf") || head == b"%PDF-" || clean.to_lowercase().ends_with(".pdf") {
                    return json!({
                        "ok": true, "url": clean, "title": "PDF 文档",
                        "content": format!("[PDF 文档 ({} KB): 请使用聊天附件上传以进行版面解析]", size_kb),
                        "cached": false
                    });
                }
                if ct.contains("application/zip") || head.starts_with(b"PK\x03\x04") || clean.to_lowercase().ends_with(".zip") {
                    return json!({
                        "ok": true, "url": clean, "title": "ZIP 压缩包",
                        "content": format!("[ZIP 压缩包 ({} KB): {}]", size_kb, clean),
                        "cached": false
                    });
                }
                let text = String::from_utf8_lossy(&bytes).into_owned();
                let (title, content) = if ct.contains("html") || ct.contains("xml") {
                    extract_readable_html(&text)
                } else {
                    (String::new(), text.chars().take(MAX_CONTENT_CHARS).collect())
                };
                json!({
                    "ok": true,
                    "url": clean,
                    "title": title,
                    "content": content,
                    "cached": false
                })
            }
            Err(e) => json!({ "ok": false, "url": clean, "error": e.to_string() }),
        }
    });

    if out.get("ok").and_then(|v| v.as_bool()) == Some(true) {
        if let Ok(mut guard) = cache.fetch.lock() {
            guard.insert(
                clean.to_string(),
                CacheEntry {
                    expires_at: now_secs() + FETCH_TTL_SECS,
                    payload: out.clone(),
                },
            );
        }
    }
    out
}

fn send_http(stream: &mut TcpStream, status: u16, ct: &str, body: &[u8]) {
    let hdr = format!(
        "HTTP/1.1 {} OK\r\nContent-Type: {}\r\nContent-Length: {}\r\nAccess-Control-Allow-Origin: *\r\nAccess-Control-Expose-Headers: *\r\n\r\n",
        status,
        ct,
        body.len()
    );
    let _ = stream.write_all(hdr.as_bytes());
    let _ = stream.write_all(body);
    let _ = stream.flush();
}

fn stabilize_messages_prefix(messages: Vec<Value>) -> Vec<Value> {
    let last_user = messages
        .iter()
        .rposition(|m| m.get("role").and_then(|r| r.as_str()) == Some("user"));
    messages
        .into_iter()
        .enumerate()
        .filter(|(idx, m)| {
            if m.get("role").and_then(|r| r.as_str()) == Some("latest_reminder") {
                return last_user.map(|u| *idx + 1 >= u).unwrap_or(true);
            }
            true
        })
        .map(|(_, m)| m)
        .collect()
}

fn handle_tcp_client(mut stream: TcpStream, client: reqwest::Client, cache: Arc<MemoryToolCache>) {
    let _ = stream.set_read_timeout(Some(Duration::from_secs(30)));
    let mut reader = BufReader::new(stream.try_clone().unwrap_or_else(|_| return_panic_dummy(&stream)));
    let mut first_line = String::new();
    if reader.read_line(&mut first_line).is_err() || first_line.trim().is_empty() {
        return;
    }
    let parts: Vec<&str> = first_line.trim().split_whitespace().collect();
    if parts.len() < 2 {
        return;
    }
    let method = parts[0].to_uppercase();
    let full_path = parts[1].to_string();
    let path_only = full_path.split('?').next().unwrap_or(&full_path).to_string();

    let mut headers: HashMap<String, String> = HashMap::new();
    let mut content_length: usize = 0;
    loop {
        let mut line = String::new();
        if reader.read_line(&mut line).is_err() || line.trim().is_empty() {
            break;
        }
        if let Some((k, v)) = line.split_once(':') {
            let lk = k.trim().to_lowercase();
            let lv = v.trim().to_string();
            if lk == "content-length" {
                content_length = lv.parse().unwrap_or(0);
            }
            headers.insert(lk, lv);
        }
    }

    let mut body = vec![0u8; content_length];
    if content_length > 0 && reader.read_exact(&mut body).is_err() {
        return;
    }

    if method == "OPTIONS" {
        let opt = "HTTP/1.1 204 No Content\r\nAccess-Control-Allow-Origin: *\r\nAccess-Control-Allow-Methods: GET,POST,DELETE,OPTIONS\r\nAccess-Control-Allow-Headers: *\r\nContent-Length: 0\r\n\r\n";
        let _ = stream.write_all(opt.as_bytes());
        let _ = stream.flush();
        return;
    }

    if method == "GET" && (path_only == "/health" || path_only == "/api/cache/stats") {
        let s_cnt = cache.search.lock().map(|g| g.len()).unwrap_or(0);
        let f_cnt = cache.fetch.lock().map(|g| g.len()).unwrap_or(0);
        let payload = json!({
            "ok": true,
            "mode": "tauri-builtin-cache",
            "searchCached": s_cnt,
            "fetchCached": f_cnt,
            "searchHits": cache.search_hits.load(Ordering::Relaxed),
            "fetchHits": cache.fetch_hits.load(Ordering::Relaxed),
            "upstreamCalls": cache.upstream_calls.load(Ordering::Relaxed),
        });
        send_http(&mut stream, 200, "application/json; charset=utf-8", payload.to_string().as_bytes());
        return;
    }

    if method == "POST" && path_only == "/api/cache/clear" {
        if let Ok(mut g) = cache.search.lock() { g.clear(); }
        if let Ok(mut g) = cache.fetch.lock() { g.clear(); }
        cache.search_hits.store(0, Ordering::Relaxed);
        cache.fetch_hits.store(0, Ordering::Relaxed);
        cache.upstream_calls.store(0, Ordering::Relaxed);
        send_http(&mut stream, 200, "application/json; charset=utf-8", b"{\"ok\":true}");
        return;
    }

    if method == "POST" && path_only == "/api/search" {
        let parsed: Value = serde_json::from_slice(&body).unwrap_or(json!({}));
        let q = parsed.get("query").and_then(|v| v.as_str()).unwrap_or("");
        let limit = parsed.get("limit").and_then(|v| v.as_u64()).unwrap_or(6) as usize;
        let res = run_search(&client, &cache, q, limit.clamp(1, 10));
        send_http(&mut stream, 200, "application/json; charset=utf-8", res.to_string().as_bytes());
        return;
    }

    if method == "POST" && path_only == "/api/fetch" {
        let parsed: Value = serde_json::from_slice(&body).unwrap_or(json!({}));
        let url = parsed.get("url").and_then(|v| v.as_str()).unwrap_or("");
        let res = run_fetch(&client, &cache, url);
        send_http(&mut stream, 200, "application/json; charset=utf-8", res.to_string().as_bytes());
        return;
    }

    if method == "POST" && path_only == "/anthropic/v1/messages" {
        let mut msg_body: Value = match serde_json::from_slice(&body) {
            Ok(v) => v,
            Err(_) => {
                send_http(&mut stream, 400, "application/json", b"{\"error\":{\"message\":\"Invalid JSON\"}}");
                return;
            }
        };
        let tools_arr = msg_body.get("tools").and_then(|v| v.as_array()).cloned().unwrap_or_default();
        let wants_search = tools_arr.iter().any(|t| t.get("name").and_then(|n| n.as_str()) == Some("deepseek_web_search"));
        let wants_fetch = tools_arr.iter().any(|t| t.get("name").and_then(|n| n.as_str()) == Some("deepseek_read_url"));

        let raw_msgs = msg_body.get("messages").and_then(|v| v.as_array()).cloned().unwrap_or_default();
        let mut stable_msgs = stabilize_messages_prefix(raw_msgs);
        let last_user_text = stable_msgs
            .iter()
            .rev()
            .find(|m| m.get("role").and_then(|r| r.as_str()) == Some("user"))
            .map(|m| match m.get("content") {
                Some(Value::String(s)) => s.clone(),
                Some(Value::Array(arr)) => arr
                    .iter()
                    .filter_map(|b| b.get("text").and_then(|t| t.as_str()))
                    .collect::<Vec<_>>()
                    .join("\n"),
                _ => String::new(),
            })
            .unwrap_or_default();

        let mut synthetic_blocks: Vec<Value> = Vec::new();
        let mut grounding: Vec<String> = Vec::new();

        if wants_fetch {
            for word in last_user_text.split_whitespace() {
                let trimmed = word.trim_matches(|c: char| "\"'<>[]()".contains(c));
                if trimmed.starts_with("http://") || trimmed.starts_with("https://") {
                    let fetched = run_fetch(&client, &cache, trimmed);
                    let id = format!("srvtoolu_rl_{}", now_secs());
                    synthetic_blocks.push(json!({
                        "type": "server_tool_use",
                        "id": id,
                        "name": "deepseek_read_url",
                        "input": { "action": "read_link", "url": trimmed },
                        "caller": { "type": "direct" },
                        "kind": "read_link"
                    }));
                    if fetched.get("ok").and_then(|v| v.as_bool()) == Some(true) {
                        let title = fetched.get("title").and_then(|v| v.as_str()).unwrap_or("");
                        let content = fetched.get("content").and_then(|v| v.as_str()).unwrap_or("");
                        synthetic_blocks.push(json!({
                            "type": "web_fetch_tool_result",
                            "tool_use_id": id,
                            "kind": "read_link",
                            "content": {
                                "type": "web_fetch_result",
                                "url": trimmed,
                                "content": {
                                    "type": "document",
                                    "source": { "type": "text", "media_type": "text/plain", "data": "" },
                                    "title": if title.is_empty() { Value::Null } else { Value::String(title.to_string()) }
                                },
                                "published_at": Value::Null
                            }
                        }));
                        grounding.push(format!("[内置缓存抓取: {}]\n{}", trimmed, content));
                    }
                }
            }
        }

        if wants_search {
            let query: String = last_user_text
                .split_whitespace()
                .filter(|w| !w.starts_with("http://") && !w.starts_with("https://"))
                .collect::<Vec<_>>()
                .join(" ")
                .chars()
                .take(140)
                .collect();
            if !query.is_empty() {
                let s_out = run_search(&client, &cache, &query, 6);
                let id = format!("srvtoolu_s_{}", now_secs());
                synthetic_blocks.push(json!({
                    "type": "server_tool_use",
                    "id": id,
                    "name": "deepseek_web_search",
                    "input": { "action": "search", "query": query, "queries": [query] },
                    "caller": { "type": "direct" },
                    "kind": "search"
                }));
                let items = s_out.get("results").and_then(|v| v.as_array()).cloned().unwrap_or_default();
                let mut mapped = Vec::new();
                for (i, item) in items.iter().enumerate() {
                    let t = item.get("title").and_then(|v| v.as_str()).unwrap_or("");
                    let u = item.get("url").and_then(|v| v.as_str()).unwrap_or("");
                    let sn = item.get("snippet").and_then(|v| v.as_str()).unwrap_or("");
                    mapped.push(json!({
                        "type": "web_search_result",
                        "title": t,
                        "url": u,
                        "snippet": sn,
                        "site_name": Value::Null,
                        "site_icon": Value::Null,
                        "encrypted_content": "",
                        "page_age": Value::Null
                    }));
                    grounding.push(format!("{}. {}\nURL: {}\n摘要: {}", i + 1, t, u, sn));
                }
                synthetic_blocks.push(json!({
                    "type": "web_search_tool_result",
                    "tool_use_id": id,
                    "kind": "search",
                    "content": mapped
                }));
            }
        }

        if !grounding.is_empty() {
            let note = grounding.join("\n\n");
            if let Some(last_u) = stable_msgs.iter_mut().rev().find(|m| m.get("role").and_then(|r| r.as_str()) == Some("user")) {
                match last_u.get_mut("content") {
                    Some(Value::String(s)) => {
                        *s = format!("{}\n\n{}", s, note);
                    }
                    Some(Value::Array(arr)) => {
                        arr.push(json!({ "type": "text", "text": format!("\n\n{}", note) }));
                    }
                    _ => {}
                }
            }
        }

        if let Some(obj) = msg_body.as_object_mut() {
            obj.insert("messages".into(), Value::Array(stable_msgs));
            let filtered: Vec<Value> = tools_arr
                .into_iter()
                .filter(|t| {
                    let n = t.get("name").and_then(|v| v.as_str()).unwrap_or("");
                    n != "deepseek_web_search" && n != "deepseek_read_url"
                })
                .collect();
            if filtered.is_empty() {
                obj.remove("tools");
            } else {
                obj.insert("tools".into(), Value::Array(filtered));
            }
        }

        let is_stream = msg_body.get("stream").and_then(|v| v.as_bool()).unwrap_or(true);
        cache.upstream_calls.fetch_add(1, Ordering::Relaxed);

        tauri::async_runtime::block_on(async {
            let mut req_builder = client
                .post(format!("{}/anthropic/v1/messages", UPSTREAM_ORIGIN))
                .header("Content-Type", "application/json")
                .header("Accept", if is_stream { "text/event-stream" } else { "application/json" });
            for hk in ["x-api-key", "authorization", "anthropic-beta"] {
                if let Some(v) = headers.get(hk) {
                    req_builder = req_builder.header(hk, v);
                }
            }
            let Ok(mut resp) = req_builder.body(msg_body.to_string()).send().await else {
                send_http(&mut stream, 502, "application/json", b"{\"error\":{\"message\":\"Upstream unreachable\"}}");
                return;
            };
            let status = resp.status().as_u16();
            if status >= 400 || !is_stream {
                let ct = resp.headers().get("content-type").and_then(|v| v.to_str().ok()).unwrap_or("application/json").to_string();
                let bytes = resp.bytes().await.unwrap_or_default();
                send_http(&mut stream, status, &ct, &bytes);
                return;
            }
            let sse_hdr = "HTTP/1.1 200 OK\r\nContent-Type: text/event-stream; charset=utf-8\r\nCache-Control: no-cache\r\nAccess-Control-Allow-Origin: *\r\nAccess-Control-Expose-Headers: *\r\n\r\n";
            let _ = stream.write_all(sse_hdr.as_bytes());
            let mut emitted_start = false;
            if !synthetic_blocks.is_empty() {
                emitted_start = true;
                let start_evt = json!({
                    "type": "message_start",
                    "message": { "id": format!("msg_cache_{}", now_secs()), "model": "deepseek-flash" }
                });
                let _ = stream.write_all(format!("event: message_start\ndata: {}\n\n", start_evt).as_bytes());
                for (i, blk) in synthetic_blocks.iter().enumerate() {
                    let idx = 1000 + i;
                    let start_b = json!({ "type": "content_block_start", "index": idx, "content_block": blk });
                    let stop_b = json!({ "type": "content_block_stop", "index": idx });
                    let _ = stream.write_all(format!("event: content_block_start\ndata: {}\n\n", start_b).as_bytes());
                    let _ = stream.write_all(format!("event: content_block_stop\ndata: {}\n\n", stop_b).as_bytes());
                }
                let _ = stream.flush();
            }

            let mut buf = String::new();
            while let Ok(Some(chunk)) = resp.chunk().await {
                buf.push_str(&String::from_utf8_lossy(&chunk));
                while let Some(pos) = buf.find("\n\n") {
                    let frame = buf[..pos].to_string();
                    buf.drain(..pos + 2);
                    if emitted_start && frame.contains("\"message_start\"") {
                        continue;
                    }
                    let _ = stream.write_all(format!("{}\n\n", frame).as_bytes());
                    let _ = stream.flush();
                }
            }
        });
        return;
    }

    if path_only == "/models"
        || path_only == "/user/balance"
        || path_only == "/anthropic/v1/files"
        || path_only.starts_with("/anthropic/v1/files/")
    {
        tauri::async_runtime::block_on(async {
            let target = format!("{}{}", UPSTREAM_ORIGIN, full_path);
            let mut rb = match method.as_str() {
                "POST" => client.post(&target),
                "DELETE" => client.delete(&target),
                _ => client.get(&target),
            };
            for hk in ["authorization", "x-api-key", "anthropic-beta", "content-type", "accept"] {
                if let Some(v) = headers.get(hk) {
                    rb = rb.header(hk, v);
                }
            }
            if !body.is_empty() && (method == "POST" || method == "PUT") {
                rb = rb.body(body);
            }
            match rb.send().await {
                Ok(resp) => {
                    let status = resp.status().as_u16();
                    let ct = resp.headers().get("content-type").and_then(|v| v.to_str().ok()).unwrap_or("application/json").to_string();
                    let bytes = resp.bytes().await.unwrap_or_default();
                    send_http(&mut stream, status, &ct, &bytes);
                }
                Err(e) => {
                    send_http(&mut stream, 502, "application/json", json!({ "error": { "message": e.to_string() } }).to_string().as_bytes());
                }
            }
        });
        return;
    }

    send_http(&mut stream, 404, "application/json", b"{\"error\":{\"message\":\"Not Found\"}}");
}

fn return_panic_dummy(stream: &TcpStream) -> TcpStream {
    stream.try_clone().expect("Failed to clone TcpStream")
}

#[tauri::command]
pub fn start_cache_server(
    holder: tauri::State<'_, CacheServerHolder>,
    port: Option<u16>,
) -> Result<CacheServerStatus, String> {
    let target_port = port.unwrap_or(8787);
    if holder.running_flag.load(Ordering::Relaxed) {
        return Ok(get_cache_server_status(holder));
    }
    if let Ok(mut g) = holder.port.lock() {
        *g = target_port;
    }

    if let Some(child) = try_spawn_node_server(target_port) {
        if let Ok(mut cg) = holder.child.lock() {
            *cg = Some(child);
        }
        holder.running_flag.store(true, Ordering::Relaxed);
        std::thread::sleep(Duration::from_millis(250));
        return Ok(get_cache_server_status(holder));
    }

    let listener = TcpListener::bind(("127.0.0.1", target_port)).map_err(|e| e.to_string())?;
    listener.set_nonblocking(true).map_err(|e| e.to_string())?;
    let flag = holder.running_flag.clone();
    flag.store(true, Ordering::Relaxed);
    let cache = holder.cache.clone();
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(90))
        .build()
        .map_err(|e| e.to_string())?;

    std::thread::spawn(move || {
        while flag.load(Ordering::Relaxed) {
            match listener.accept() {
                Ok((stream, _)) => {
                    let c = client.clone();
                    let ca = cache.clone();
                    std::thread::spawn(move || handle_tcp_client(stream, c, ca));
                }
                Err(ref e) if e.kind() == std::io::ErrorKind::WouldBlock => {
                    std::thread::sleep(Duration::from_millis(30));
                }
                Err(_) => break,
            }
        }
    });

    Ok(get_cache_server_status(holder))
}

#[tauri::command]
pub fn stop_cache_server(holder: tauri::State<'_, CacheServerHolder>) -> CacheServerStatus {
    holder.running_flag.store(false, Ordering::Relaxed);
    if let Ok(mut cg) = holder.child.lock() {
        if let Some(mut child) = cg.take() {
            let _ = child.kill();
            let _ = child.wait();
        }
    }
    get_cache_server_status(holder)
}

#[tauri::command]
pub fn get_cache_server_status(holder: tauri::State<'_, CacheServerHolder>) -> CacheServerStatus {
    let port = holder.port.lock().map(|g| *g).unwrap_or(8787);
    let s_cnt = holder.cache.search.lock().map(|g| g.len()).unwrap_or(0);
    let f_cnt = holder.cache.fetch.lock().map(|g| g.len()).unwrap_or(0);
    CacheServerStatus {
        running: holder.running_flag.load(Ordering::Relaxed),
        url: format!("http://127.0.0.1:{}", port),
        mode: "tauri-cache-backend".to_string(),
        search_cached: s_cnt,
        fetch_cached: f_cnt,
        search_hits: holder.cache.search_hits.load(Ordering::Relaxed),
        fetch_hits: holder.cache.fetch_hits.load(Ordering::Relaxed),
        upstream_calls: holder.cache.upstream_calls.load(Ordering::Relaxed),
    }
}
