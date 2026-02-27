const express = require('express');
const http = require('http');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const httpProxy = require('http-proxy');

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 8080;
const TOKEN = process.env.TOKEN;
const HLS_DIR = '/tmp/hls';
const CDP_HOST = 'localhost';
const CDP_PORT = 9222;

// Ensure HLS directory exists
fs.mkdirSync(HLS_DIR, { recursive: true });

// CDP WebSocket proxy
const cdpProxy = httpProxy.createProxyServer({ ws: true, target: `http://${CDP_HOST}:${CDP_PORT}` });
cdpProxy.on('error', (err) => console.error('CDP proxy error:', err.message));

// Token auth middleware
function auth(req, res, next) {
    const token = req.query.token || req.headers['authorization']?.replace('Bearer ', '');
    if (!TOKEN) return next(); // no token configured = no auth
    if (token !== TOKEN) return res.status(401).json({ error: 'unauthorized' });
    next();
}

// Track ffmpeg process
let ffmpegProcess = null;

// Activity tracking for session manager GC
let lastActivity = Date.now();

// Touch activity on every non-health request
app.use((req, res, next) => {
    if (req.path !== '/health') lastActivity = Date.now();
    next();
});

// Health check (no auth)
app.get('/health', (req, res) => {
    res.json({ status: 'ok', streaming: ffmpegProcess !== null, lastActivity, uptime: process.uptime() });
});

// Start streaming
app.post('/api/stream/start', auth, (req, res) => {
    if (ffmpegProcess) {
        return res.json({ status: 'already_streaming' });
    }

    // Clean old segments
    const files = fs.readdirSync(HLS_DIR);
    for (const f of files) {
        fs.unlinkSync(path.join(HLS_DIR, f));
    }

    const args = [
        // Video input: X11 screen capture
        '-f', 'x11grab',
        '-framerate', '30',
        '-video_size', `${process.env.SCREEN_WIDTH || 1280}x${process.env.SCREEN_HEIGHT || 720}`,
        '-i', ':99',
        // Audio input: PulseAudio monitor
        '-f', 'pulse',
        '-i', 'virtual_out.monitor',
        // Video codec (yuv420p + high profile required for browser compatibility)
        '-c:v', 'libx264',
        '-preset', 'ultrafast',
        '-tune', 'zerolatency',
        '-pix_fmt', 'yuv420p',
        '-profile:v', 'high',
        '-level', '4.1',
        '-crf', '23',
        // Audio codec
        '-c:a', 'aac',
        '-b:a', '128k',
        // Keyframe interval (1 per second at 30fps)
        '-g', '30',
        '-keyint_min', '30',
        // HLS output
        '-f', 'hls',
        '-hls_time', '1',
        '-hls_list_size', '10',
        '-hls_flags', 'delete_segments+independent_segments',
        path.join(HLS_DIR, 'stream.m3u8'),
    ];

    ffmpegProcess = spawn('ffmpeg', args, { stdio: ['pipe', 'pipe', 'pipe'] });

    ffmpegProcess.stderr.on('data', (data) => {
        const line = data.toString().trim();
        if (line) console.log('[ffmpeg]', line);
    });

    ffmpegProcess.on('close', (code) => {
        console.log(`ffmpeg exited with code ${code}`);
        ffmpegProcess = null;
    });

    ffmpegProcess.on('error', (err) => {
        console.error('ffmpeg spawn error:', err);
        ffmpegProcess = null;
    });

    res.json({ status: 'started' });
});

// Stop streaming
app.post('/api/stream/stop', auth, (req, res) => {
    if (!ffmpegProcess) {
        return res.json({ status: 'not_streaming' });
    }

    ffmpegProcess.kill('SIGTERM');
    ffmpegProcess = null;
    res.json({ status: 'stopped' });
});

// Serve HLS segments with appropriate headers
app.get('/hls/:file', auth, (req, res) => {
    const filePath = path.join(HLS_DIR, req.params.file);

    if (!fs.existsSync(filePath)) {
        return res.status(404).json({ error: 'not found' });
    }

    // CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Authorization');

    if (req.params.file.endsWith('.m3u8')) {
        res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
        res.setHeader('Cache-Control', 'no-cache, no-store');
    } else if (req.params.file.endsWith('.ts')) {
        res.setHeader('Content-Type', 'video/mp2t');
        res.setHeader('Cache-Control', 'max-age=60');
    }

    res.sendFile(filePath);
});

// CORS preflight for HLS
app.options('/hls/:file', (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Authorization');
    res.sendStatus(204);
});

// Navigate Chrome via CDP
app.post('/api/navigate', auth, async (req, res) => {
    const { url } = req.body;
    if (!url) return res.status(400).json({ error: 'url required' });

    try {
        // Get first tab
        const tabsRes = await fetch(`http://${CDP_HOST}:${CDP_PORT}/json`);
        const tabs = await tabsRes.json();
        if (!tabs.length) return res.status(500).json({ error: 'no browser tabs' });

        const tabId = tabs[0].id;

        // Navigate
        const navRes = await fetch(`http://${CDP_HOST}:${CDP_PORT}/json/navigate?${tabId}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
        });

        // Use CDP HTTP endpoint to navigate
        const wsUrl = tabs[0].webSocketDebuggerUrl;

        // Use direct CDP command via HTTP
        await fetch(`http://${CDP_HOST}:${CDP_PORT}/json/navigate?url=${encodeURIComponent(url)}&id=${tabId}`);

        res.json({ status: 'navigated', url });
    } catch (err) {
        console.error('Navigate error:', err);
        res.status(500).json({ error: err.message });
    }
});

// Create HTTP server
const server = http.createServer(app);

// WebSocket upgrade: proxy to Chrome CDP
server.on('upgrade', (req, socket, head) => {
    // Check token for WebSocket connections
    const urlParams = new URL(req.url, 'http://localhost').searchParams;
    const token = urlParams.get('token');

    if (TOKEN && token !== TOKEN) {
        socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
        socket.destroy();
        return;
    }

    lastActivity = Date.now();

    // Proxy to Chrome CDP, rewriting the path
    cdpProxy.ws(req, socket, head, {
        target: `ws://${CDP_HOST}:${CDP_PORT}`,
    });
});

server.listen(PORT, () => {
    console.log(`Server listening on port ${PORT}`);
    console.log(`HLS directory: ${HLS_DIR}`);
    console.log(`Auth: ${TOKEN ? 'enabled' : 'disabled'}`);
});
