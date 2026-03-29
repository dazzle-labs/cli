use anyhow::{anyhow, Result};
use log::{debug, error, info, warn};
use serde_json::{json, Value};
use std::fs::{File, OpenOptions};
use std::io::{BufRead, BufReader, Write};
use std::path::Path;
use std::sync::mpsc;
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Duration;

use crate::storage::Storage;

pub const TARGET_ID: &str = "stage-runtime-page-target";
pub const SESSION_ID: &str = "stage-runtime-session-1";
const READ_BUFFER_SIZE: usize = 4 * 1024 * 1024; // 4MB for screenshots
const MAX_MESSAGE_SIZE: usize = 1 * 1024 * 1024; // 1MB hard limit per message

// ============================================================================
// V8-based CDP server
// ============================================================================

use crate::runtime::{self, FramePacer, RendererState};

/// Serve the CDP pipe protocol (V8 runtime). Blocks forever.
///
/// CRITICAL: FIFO names are from the sidecar's perspective:
/// - cdp_pipe_in: sidecar writes to this, we READ from it
/// - cdp_pipe_out: sidecar reads from this, we WRITE to it
///
/// Open order to avoid FIFO deadlock:
/// - Open cdp_pipe_in for reading FIRST (unblocks sidecar's blocking write-open)
/// - Then open cdp_pipe_out for writing
pub fn serve(
    cdp_pipe_in: &Path,
    cdp_pipe_out: &Path,
    scope: &mut v8::PinScope,
    state: &mut RendererState,
    content_dir: &Path,
    store: Arc<Mutex<Storage>>,
) -> Result<()> {
    let (rx, mut out_file) = open_pipes(cdp_pipe_in, cdp_pipe_out)?;

    let mut pacer = FramePacer::new(state.fps);
    let mut frame_loop_running = false;

    loop {
        // Tick frame if running, paced to target FPS
        if frame_loop_running {
            pacer.wait();
            runtime::tick_frame(scope, state);

            // Emit pending console log events
            emit_console_events_v8(state, &mut out_file);

            // Periodically flush storage
            if let Ok(mut s) = state.store.lock() {
                let _ = s.maybe_flush();
            }
        }

        // Drain all available CDP messages (non-blocking)
        loop {
            match rx.try_recv() {
                Ok(msg) => {
                    debug!("CDP: received: {}", truncate(&msg, 200));
                    match serde_json::from_str::<Value>(&msg) {
                        Ok(command) => {
                            let responses = super::handlers::handle_command(
                                &command,
                                scope,
                                state,
                                content_dir,
                                &store,
                                &mut frame_loop_running,
                            );
                            for response in responses {
                                if let Err(e) = write_message(&mut out_file, &response) {
                                    error!("CDP: write error: {}", e);
                                    return Err(e);
                                }
                            }
                        }
                        Err(e) => warn!("CDP: invalid JSON: {}", e),
                    }
                }
                Err(mpsc::TryRecvError::Empty) => break,
                Err(mpsc::TryRecvError::Disconnected) => {
                    info!("CDP: reader thread disconnected");
                    return Ok(());
                }
            }
        }

        // Sleep briefly to avoid busy-spinning when frame loop is stopped
        if !frame_loop_running {
            thread::sleep(Duration::from_millis(10));
        }
    }
}

fn emit_console_events_v8(state: &mut RendererState, out: &mut File) {
    let entries = runtime::drain_console_logs_from_state(state);
    emit_console_entries(&entries, out);
}

// ============================================================================
// Shared utilities
// ============================================================================

/// Open CDP FIFO pipes and spawn reader thread. Returns (receiver, output_file).
fn open_pipes(cdp_pipe_in: &Path, cdp_pipe_out: &Path) -> Result<(mpsc::Receiver<String>, File)> {
    info!("CDP: waiting for sidecar connection...");
    info!("CDP: opening {} for reading (sidecar writes here)...", cdp_pipe_in.display());

    let in_file = File::open(cdp_pipe_in)
        .map_err(|e| anyhow!("Failed to open CDP input FIFO {}: {}", cdp_pipe_in.display(), e))?;

    info!("CDP: opening {} for writing (sidecar reads here)...", cdp_pipe_out.display());

    let out_file = OpenOptions::new()
        .write(true)
        .open(cdp_pipe_out)
        .map_err(|e| anyhow!("Failed to open CDP output FIFO {}: {}", cdp_pipe_out.display(), e))?;

    info!("CDP: connected to sidecar");

    // Spawn a reader thread so FIFO reads don't block the frame loop.
    let (tx, rx) = mpsc::channel::<String>();
    thread::spawn(move || {
        let reader = BufReader::with_capacity(READ_BUFFER_SIZE, in_file);
        let mut null_reader = NullByteReader::new(reader);
        loop {
            match null_reader.read_message() {
                Ok(msg) => {
                    if tx.send(msg).is_err() {
                        break;
                    }
                }
                Err(e) => {
                    error!("CDP reader: {}", e);
                    break;
                }
            }
        }
    });

    Ok((rx, out_file))
}

/// Emit console log entries as CDP Runtime.consoleAPICalled events.
fn emit_console_entries(entries: &[crate::runtime_common::ConsoleEntry], out: &mut File) {
    for entry in entries {
        let event = json!({
            "method": "Runtime.consoleAPICalled",
            "params": {
                "type": entry.level,
                "args": [{ "type": "string", "value": entry.text }],
                "timestamp": entry.timestamp,
            }
        });
        if let Err(e) = write_message(out, &event) {
            error!("CDP: failed to emit console event: {}", e);
        }
    }
}

pub fn write_message(out: &mut File, msg: &Value) -> Result<()> {
    let data = serde_json::to_vec(msg)?;
    out.write_all(&data)?;
    out.write_all(&[0])?;
    out.flush()?;
    debug!("CDP: sent: {}", truncate(&serde_json::to_string(msg).unwrap_or_default(), 200));
    Ok(())
}

fn truncate(msg: &str, max: usize) -> String {
    if msg.len() <= max {
        msg.to_string()
    } else {
        // Find a valid UTF-8 char boundary at or before `max` to avoid panic on multi-byte chars
        let end = (0..=max).rev().find(|&i| msg.is_char_boundary(i)).unwrap_or(0);
        format!("{}...[{}B]", &msg[..end], msg.len())
    }
}

/// Reads null-byte delimited messages from a BufReader (blocking).
struct NullByteReader<R: BufRead> {
    reader: R,
    buffer: Vec<u8>,
}

impl<R: BufRead> NullByteReader<R> {
    fn new(reader: R) -> Self {
        NullByteReader { reader, buffer: Vec::with_capacity(4096) }
    }

    fn read_message(&mut self) -> Result<String> {
        loop {
            let available = self.reader.fill_buf()?;
            if available.is_empty() {
                return Err(anyhow!("EOF on CDP pipe"));
            }

            if let Some(null_pos) = available.iter().position(|&b| b == 0) {
                self.buffer.extend_from_slice(&available[..null_pos]);
                let consume_len = null_pos + 1;
                self.reader.consume(consume_len);

                let msg = String::from_utf8(std::mem::take(&mut self.buffer))?;
                self.buffer = Vec::with_capacity(4096);
                return Ok(msg);
            } else {
                let len = available.len();
                // Check size BEFORE appending to prevent oversized buffer growth
                if self.buffer.len() + len > MAX_MESSAGE_SIZE {
                    self.buffer.clear();
                    self.reader.consume(len);
                    return Err(anyhow!("CDP message exceeds {}B limit", MAX_MESSAGE_SIZE));
                }
                self.buffer.extend_from_slice(available);
                self.reader.consume(len);
            }
        }
    }
}
