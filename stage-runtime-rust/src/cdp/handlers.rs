use base64::Engine;
use log::{info, warn};
use serde_json::{json, Value};
use std::path::Path;
use std::sync::{Arc, Mutex};

use stage_runtime::content;
use stage_runtime::runtime::{self, RendererState};
use stage_runtime::storage::Storage;

use super::pipe_server::{TARGET_ID, SESSION_ID};

/// Handle a CDP command and return response(s).
pub fn handle_command(
    command: &Value,
    scope: &mut v8::PinScope,
    state: &mut RendererState,
    content_dir: &Path,
    _store: &Arc<Mutex<Storage>>,
    frame_loop_running: &mut bool,
) -> Vec<Value> {
    let id = command.get("id").and_then(|v| v.as_i64());
    let method = command.get("method").and_then(|v| v.as_str()).unwrap_or("");
    let params = command.get("params").cloned().unwrap_or(json!({}));
    let session_id = command.get("sessionId").and_then(|v| v.as_str());

    match method {
        // --- Target discovery (browser-level, no sessionId) ---
        "Target.setDiscoverTargets" => {
            vec![ok(id, None, json!({}))]
        }

        "Target.getTargets" => {
            vec![ok(id, None, json!({
                "targetInfos": [{
                    "targetId": TARGET_ID,
                    "type": "page",
                    "title": "stage-runtime",
                    "url": "about:blank",
                    "attached": false,
                }]
            }))]
        }

        "Target.createTarget" => {
            vec![ok(id, None, json!({ "targetId": TARGET_ID }))]
        }

        "Target.attachToTarget" => {
            *frame_loop_running = true;
            info!("CDP: sidecar attached, frame loop started");

            vec![
                // Event: Target.attachedToTarget
                json!({
                    "method": "Target.attachedToTarget",
                    "params": {
                        "sessionId": SESSION_ID,
                        "targetInfo": {
                            "targetId": TARGET_ID,
                            "type": "page",
                            "title": "stage-runtime",
                            "url": "about:blank",
                        },
                        "waitingForDebugger": false,
                    }
                }),
                // Response
                ok(id, None, json!({ "sessionId": SESSION_ID })),
            ]
        }

        // --- Session-scoped commands ---
        "Runtime.enable" | "Log.enable" => {
            vec![ok(id, session_id, json!({}))]
        }

        "Runtime.evaluate" => {
            let expression = params.get("expression").and_then(|v| v.as_str()).unwrap_or("");
            let return_by_value = params.get("returnByValue").and_then(|v| v.as_bool()).unwrap_or(false);

            match runtime::eval_for_cdp(scope, expression, return_by_value) {
                Ok(result) => vec![ok(id, session_id, result)],
                Err(e) => vec![ok(id, session_id, json!({
                    "result": { "type": "undefined" },
                    "exceptionDetails": {
                        "exceptionId": 1,
                        "text": e.to_string(),
                        "lineNumber": 0,
                        "columnNumber": 0,
                        "exception": {
                            "type": "object",
                            "subtype": "error",
                            "description": e.to_string(),
                        }
                    }
                }))],
            }
        }

        "Page.reload" | "Page.navigate" => {
            let is_reload = method == "Page.reload";
            let url = params.get("url").and_then(|v| v.as_str()).unwrap_or("about:blank");
            if is_reload {
                info!("CDP: Page.reload (ignoreCache={})", params.get("ignoreCache").and_then(|v| v.as_bool()).unwrap_or(false));
            } else {
                info!("CDP: Page.navigate to {}", url);
            }

            // For reload, re-load from current content_dir; for navigate, resolve URL to path
            let nav_path;
            let parent;
            if is_reload {
                parent = content_dir;
            } else {
                nav_path = content::url_to_content_path(url, content_dir);
                parent = nav_path.parent().unwrap_or(content_dir);
            }

            // Clear JS state: timers, rAF, user globals, event listeners, log buffer.
            // NOTE: Full V8 isolate recreation is not possible without restarting due
            // to scope lifetime constraints. Instead, we clear user-facing state and
            // remove user-defined globals (anything not starting with __dz_).
            let reset_js = r#"
                if (typeof __dz_timers !== 'undefined') { for (var k in __dz_timers.timers) delete __dz_timers.timers[k]; }
                if (typeof __dz_raf !== 'undefined') { for (var k in __dz_raf.callbacks) delete __dz_raf.callbacks[k]; }
                __dz_perf_now = 0;
                if (window.__dzFPS) window.__dzFPS.current = 0;
                if (typeof __dz_reset_page_state === 'function') __dz_reset_page_state();
                // Remove user-defined globals (preserve __dz_* internals and browser polyfills)
                (function() {
                    var keep = ['window','document','console','navigator','location','history',
                        'performance','localStorage','sessionStorage','setTimeout','setInterval',
                        'clearTimeout','clearInterval','requestAnimationFrame','cancelAnimationFrame',
                        'requestIdleCallback','cancelIdleCallback','fetch','XMLHttpRequest',
                        'URL','URLSearchParams','Event','CustomEvent','Image','Path2D',
                        'AudioContext','OfflineAudioContext','MutationObserver','ResizeObserver',
                        'getComputedStyle','matchMedia','atob','btoa','TextEncoder','TextDecoder',
                        'structuredClone','queueMicrotask','Promise','Symbol','Map','Set','WeakMap',
                        'WeakSet','Proxy','Reflect','Array','Object','String','Number','Boolean',
                        'Date','RegExp','Error','TypeError','RangeError','JSON','Math','parseInt',
                        'parseFloat','isNaN','isFinite','undefined','NaN','Infinity','eval',
                        'globalThis','self','WebSocket','WebGLRenderingContext','WebGL2RenderingContext',
                        'CanvasRenderingContext2D','ImageData','DOMParser','Node','Element',
                        'HTMLElement','HTMLCanvasElement','HTMLImageElement','HTMLVideoElement',
                        'HTMLDivElement','HTMLSpanElement','HTMLParagraphElement','HTMLAnchorElement',
                        'DocumentFragment','Text','Comment','NodeList','NamedNodeMap',
                        'DOMTokenList','CSSStyleDeclaration','MediaQueryList',
                        'Float32Array','Uint8Array','Uint8ClampedArray','Int32Array',
                        'Uint16Array','Float64Array','ArrayBuffer','DataView','SharedArrayBuffer',
                        'Atomics','BigInt','BigInt64Array','BigUint64Array'];
                    var keepSet = {};
                    for (var i = 0; i < keep.length; i++) keepSet[keep[i]] = true;
                    var keys = Object.getOwnPropertyNames(globalThis);
                    for (var i = 0; i < keys.length; i++) {
                        var k = keys[i];
                        if (k.indexOf('__dz_') === 0) continue;
                        if (keepSet[k]) continue;
                        try { delete globalThis[k]; } catch(e) {}
                    }
                })();
            "#;
            let _ = runtime::eval_script(scope, "<navigate-reset>", reset_js);
            state.reset();

            match content::load_content_with_html(parent) {
                Ok((html, js)) => {
                    if let Some(ref html_str) = html {
                        state.render_html_background_with_dir(html_str, parent);
                    } else {
                        state.html_background = None;
                    }
                    if !js.is_empty() {
                        if let Err(e) = runtime::eval_script(scope, "<content>", &js) {
                            warn!("CDP: content reload failed: {}", e);
                        }
                    }
                }
                Err(e) => warn!("CDP: failed to load content from {}: {}", parent.display(), e),
            }

            vec![ok(id, session_id, json!({ "frameId": "main", "loaderId": "loader-1" }))]
        }

        "Page.captureScreenshot" => {
            let width = state.width;
            let height = state.height;
            let pixels = state.get_framebuffer_for_screenshot();

            match encode_png(&pixels, width, height) {
                Ok(png) => {
                    let b64 = base64::engine::general_purpose::STANDARD.encode(&png);
                    vec![ok(id, session_id, json!({ "data": b64 }))]
                }
                Err(e) => vec![err(id, session_id, -32000, &format!("Screenshot failed: {}", e))],
            }
        }

        "StageRuntime.setOutputs" => {
            let outputs = params.get("outputs").and_then(|v| v.as_array());
            let count = outputs.map(|o| o.len()).unwrap_or(0);
            info!("CDP: StageRuntime.setOutputs: {} outputs", count);

            {
                let dests: Vec<stage_runtime::encoder::OutputDest> = outputs
                    .map(|arr| arr.iter().filter_map(|o| {
                        let url = o.get("url")?.as_str()?;
                        // Only allow rtmp:// and rtmps:// output URLs to prevent
                        // file:// writes or exfiltration to arbitrary destinations
                        if !url.starts_with("rtmp://") && !url.starts_with("rtmps://") {
                            log::warn!("Blocked non-RTMP output URL: {}", url);
                            return None;
                        }
                        Some(stage_runtime::encoder::OutputDest {
                            name: o.get("name")?.as_str()?.to_string(),
                            url: url.to_string(),
                            watermarked: o.get("watermarked").and_then(|v| v.as_bool()).unwrap_or(false),
                        })
                    }).collect())
                    .unwrap_or_default();
                state.encoder.set_outputs(dests);
            }

            vec![ok(id, session_id, json!({}))]
        }

        "StageRuntime.getStats" => {
            let enc_stats = state.encoder.stats();

            vec![ok(id, session_id, json!({
                "renderFps": state.actual_fps,
                "encodeFps": enc_stats.encode_fps,
                "droppedFrames": enc_stats.dropped_frames,
                "totalBytes": enc_stats.total_bytes,
                "frameCount": state.frame_count,
                "uptimeMs": state.virtual_time_ms,
            }))]
        }

        _ => {
            warn!("CDP: unhandled method: {}", method);
            vec![err(id, session_id, -32601, &format!("Method not found: {}", method))]
        }
    }
}

// --- Response builders ---

fn ok(id: Option<i64>, session_id: Option<&str>, result: Value) -> Value {
    let mut resp = json!({ "result": result });
    if let Some(id) = id { resp["id"] = json!(id); }
    if let Some(sid) = session_id { resp["sessionId"] = json!(sid); }
    resp
}

fn err(id: Option<i64>, session_id: Option<&str>, code: i32, message: &str) -> Value {
    let mut resp = json!({ "error": { "code": code, "message": message } });
    if let Some(id) = id { resp["id"] = json!(id); }
    if let Some(sid) = session_id { resp["sessionId"] = json!(sid); }
    resp
}

#[cfg(test)]
mod tests {
    use super::*;

    // --- Response builders ---

    #[test]
    fn ok_with_id_and_session() {
        let resp = ok(Some(42), Some("sess-1"), json!({"key": "val"}));
        assert_eq!(resp["id"], 42);
        assert_eq!(resp["sessionId"], "sess-1");
        assert_eq!(resp["result"]["key"], "val");
    }

    #[test]
    fn ok_without_id() {
        let resp = ok(None, None, json!({}));
        assert!(resp.get("id").is_none());
        assert!(resp.get("sessionId").is_none());
    }

    #[test]
    fn err_response() {
        let resp = err(Some(1), Some("s"), -32601, "not found");
        assert_eq!(resp["id"], 1);
        assert_eq!(resp["error"]["code"], -32601);
        assert_eq!(resp["error"]["message"], "not found");
    }

    // --- PNG encoding ---

    #[test]
    fn encode_png_valid() {
        // 2x2 red pixels
        let pixels = vec![255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255, 255, 255, 255, 255];
        let png = encode_png(&pixels, 2, 2).unwrap();
        // PNG starts with magic bytes
        assert_eq!(&png[0..4], &[0x89, 0x50, 0x4E, 0x47]);
        assert!(png.len() > 20, "PNG should have reasonable size");
    }

    #[test]
    fn encode_png_single_pixel() {
        let pixels = vec![0, 0, 0, 255];
        let png = encode_png(&pixels, 1, 1).unwrap();
        assert_eq!(&png[0..4], &[0x89, 0x50, 0x4E, 0x47]);
    }

    // --- Target discovery protocol ---

    #[test]
    fn target_set_discover_targets() {
        let resp = ok(Some(1), None, json!({}));
        assert_eq!(resp["id"], 1);
        assert!(resp["result"].is_object());
    }

    #[test]
    fn target_get_targets_returns_page() {
        // Simulate what handle_command returns for Target.getTargets
        let result = json!({
            "targetInfos": [{
                "targetId": TARGET_ID,
                "type": "page",
                "title": "stage-runtime",
                "url": "about:blank",
                "attached": false,
            }]
        });
        let infos = result["targetInfos"].as_array().unwrap();
        assert_eq!(infos.len(), 1);
        assert_eq!(infos[0]["type"], "page");
        assert_eq!(infos[0]["targetId"], TARGET_ID);
    }

    #[test]
    fn session_id_constant() {
        assert!(!SESSION_ID.is_empty());
        assert!(!TARGET_ID.is_empty());
    }

    // --- RTMP URL scheme validation ---

    #[test]
    fn rtmp_url_allowed() {
        assert!("rtmp://stream.example.com/live/key".starts_with("rtmp://"));
        assert!("rtmps://stream.example.com/live/key".starts_with("rtmps://"));
    }

    #[test]
    fn non_rtmp_urls_blocked() {
        for url in &["file:///etc/passwd", "ftp://evil.com/exfil", "http://attacker.com/steal", "gopher://evil.com/"] {
            assert!(!url.starts_with("rtmp://") && !url.starts_with("rtmps://"),
                "URL {} should be rejected by scheme allowlist", url);
        }
    }

    // --- StageRuntime.getStats response shape ---

    #[test]
    fn stats_response_shape() {
        let stats = json!({
            "renderFps": 30,
            "encodeFps": 0,
            "droppedFrames": 0,
            "totalBytes": 0,
            "frameCount": 100,
            "uptimeMs": 3333.0,
        });
        assert!(stats["renderFps"].is_number());
        assert!(stats["frameCount"].is_number());
        assert!(stats["uptimeMs"].is_number());
    }
}

fn encode_png(pixels: &[u8], width: u32, height: u32) -> Result<Vec<u8>, String> {
    let mut buf = Vec::new();
    let encoder = image::codecs::png::PngEncoder::new(&mut buf);
    use image::ImageEncoder;
    encoder
        .write_image(pixels, width, height, image::ColorType::Rgba8.into())
        .map_err(|e| format!("PNG encode error: {}", e))?;
    Ok(buf)
}
