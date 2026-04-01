mod cdp;
#[allow(clippy::module_inception)]
mod compositor;
#[allow(clippy::module_inception)]
mod stats;

use stage_runtime as lib;

use anyhow::Result;
use clap::Parser;
use log::info;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};

#[derive(Parser, Debug)]
#[command(name = "stage-runtime", about = "Rust stage runtime — replaces Chrome + Xvfb + ffmpeg")]
struct Args {
    /// Content directory path
    #[arg(long, env = "CONTENT_DIR")]
    content_dir: PathBuf,

    /// Data directory path (for storage.json)
    #[arg(long, env = "DATA_DIR")]
    data_dir: PathBuf,

    /// CDP input FIFO path (sidecar writes, we read)
    #[arg(long, env = "CDP_PIPE_IN")]
    cdp_pipe_in: PathBuf,

    /// CDP output FIFO path (we write, sidecar reads)
    #[arg(long, env = "CDP_PIPE_OUT")]
    cdp_pipe_out: PathBuf,

    /// Screen width
    #[arg(long, default_value = "1280")]
    width: u32,

    /// Screen height
    #[arg(long, default_value = "720")]
    height: u32,

    /// Target frames per second
    #[arg(long, default_value = "30")]
    fps: u32,

    /// Video codec (auto, h264_nvenc, or libx264)
    #[arg(long, default_value = "auto", env = "VIDEO_CODEC")]
    video_codec: String,

    /// GPU device index
    #[arg(long, default_value = "0")]
    gpu_device_index: u32,

    /// Run compatibility report and exit
    #[arg(long)]
    compat_report: bool,
}

fn main() -> Result<()> {
    env_logger::init();
    let args = Args::parse();

    // Validate dimensions and fps to prevent downstream panics (division by zero,
    // integer overflow in framebuffer allocation, zero-size pixmap creation).
    if args.width == 0 || args.height == 0 {
        anyhow::bail!("width and height must be > 0 (got {}x{})", args.width, args.height);
    }
    if args.width > 8192 || args.height > 8192 {
        anyhow::bail!("width and height must be <= 8192 (got {}x{})", args.width, args.height);
    }
    if args.fps == 0 {
        anyhow::bail!("fps must be > 0");
    }
    // Guard against integer overflow in framebuffer allocation: width * height * 4 must fit in usize
    let pixel_count = args.width as u64 * args.height as u64;
    if pixel_count.checked_mul(4).is_none_or(|n| n > usize::MAX as u64) {
        anyhow::bail!("framebuffer size overflow: {}x{}", args.width, args.height);
    }

    info!(
        "stage-runtime starting: {}x{} @ {}fps, content={}",
        args.width, args.height, args.fps, args.content_dir.display()
    );

    main_v8(args)
}

fn main_v8(args: Args) -> Result<()> {
    // Initialize V8 platform
    lib::runtime::init_v8();

    // Create V8 isolate and scopes — all in main() to match v8 scope lifetime requirements
    let params = v8::CreateParams::default()
        .heap_limits(0, 256 * 1024 * 1024); // 256MB max heap
    let isolate = &mut v8::Isolate::new(params);

    // Get a thread-safe handle for the execution timeout watchdog.
    // This allows a background thread to terminate runaway JS (e.g. while(true){}).
    let isolate_handle = isolate.thread_safe_handle();

    v8::scope!(let handle_scope, isolate);

    let context = v8::Context::new(handle_scope, Default::default());
    let mut scope = v8::ContextScope::new(handle_scope, context);

    // Initialize persistent storage (after V8 scopes to avoid drop ordering issues)
    let storage_path = args.data_dir.join("storage.json");
    let store = Arc::new(Mutex::new(lib::storage::Storage::new(&storage_path)?));

    // Create renderer state
    let mut state = lib::runtime::RendererState::with_codec(
        args.width,
        args.height,
        args.fps,
        Arc::clone(&store),
        &args.video_codec,
        args.gpu_device_index,
    );

    // Set content directory for image loading
    state.content_dir = Some(args.content_dir.clone());

    // Set up V8 execution timeout watchdog (prevents while(true){} from freezing)
    state.set_watchdog(isolate_handle);

    // Initialize polyfills and browser globals
    lib::runtime::init_globals(&mut scope, &mut state)?;

    // Register native V8 callbacks (pointer-based — state must not move after this)
    lib::runtime::register_native_callbacks(&mut scope, &mut state);
    lib::runtime::freeze_late_native_callbacks(&mut scope);

    // Load initial content
    if args.content_dir.exists() {
        let (html, js) = lib::content::load_content_with_html(&args.content_dir)?;
        if let Some(ref html_str) = html {
            state.render_html_background_with_dir(html_str, &args.content_dir);
        }
        if !js.is_empty() {
            lib::runtime::eval_script(&mut scope, "<content>", &js)?;
        }
    }

    // Start the CDP pipe server — blocks and drives the frame loop
    cdp::serve(
        &args.cdp_pipe_in,
        &args.cdp_pipe_out,
        &mut scope,
        &mut state,
        &args.content_dir,
        store,
    )
}
