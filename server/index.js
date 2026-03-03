const express = require('express');
const http = require('http');
const httpProxy = require('http-proxy');
const WebSocket = require('ws');
const fs = require('fs');
const path = require('path');

const app = express();
app.use(express.json({ limit: '5mb' }));

const PORT = process.env.PORT || 8080;
const TOKEN = process.env.TOKEN;
const CDP_HOST = 'localhost';
const CDP_PORT = 9222;

const SCREEN_WIDTH = parseInt(process.env.SCREEN_WIDTH || '1280', 10);
const SCREEN_HEIGHT = parseInt(process.env.SCREEN_HEIGHT || '720', 10);

const CONTENT_ROOT = '/tmp/content';
const SHELL_HTML = fs.readFileSync(path.join(__dirname, 'shell.html'), 'utf8');

// --- Panel metadata (dimensions only — content lives on disk) ---
// Map<string, { width: number, height: number }>
const panels = new Map();

// --- Per-panel accumulated state (for emit_event) ---
// Map<string, object>
const panelState = new Map();

// Vite dev server instance (set during startup)
let vite = null;

// --- Layout State ---
let currentLayout = { preset: 'single', specs: [] };

const LAYOUT_PRESETS = {
    single: (names) => {
        const name = names[0] || 'main';
        return [{ name, x: 0, y: 0, width: SCREEN_WIDTH, height: SCREEN_HEIGHT }];
    },
    split: (names) => {
        const half = Math.floor(SCREEN_WIDTH / 2);
        const left = names[0] || 'left';
        const right = names[1] || 'right';
        return [
            { name: left, x: 0, y: 0, width: half, height: SCREEN_HEIGHT },
            { name: right, x: half, y: 0, width: SCREEN_WIDTH - half, height: SCREEN_HEIGHT },
        ];
    },
    'grid-2x2': (names) => {
        const hw = Math.floor(SCREEN_WIDTH / 2);
        const hh = Math.floor(SCREEN_HEIGHT / 2);
        const n = [names[0] || 'top-left', names[1] || 'top-right', names[2] || 'bottom-left', names[3] || 'bottom-right'];
        return [
            { name: n[0], x: 0, y: 0, width: hw, height: hh },
            { name: n[1], x: hw, y: 0, width: SCREEN_WIDTH - hw, height: hh },
            { name: n[2], x: 0, y: hh, width: hw, height: SCREEN_HEIGHT - hh },
            { name: n[3], x: hw, y: hh, width: SCREEN_WIDTH - hw, height: SCREEN_HEIGHT - hh },
        ];
    },
    pip: (names) => {
        const mainName = names[0] || 'main';
        const pipName = names[1] || 'pip';
        const pipW = Math.floor(SCREEN_WIDTH * 0.3);
        const pipH = Math.floor(SCREEN_HEIGHT * 0.3);
        const margin = 20;
        return [
            { name: mainName, x: 0, y: 0, width: SCREEN_WIDTH, height: SCREEN_HEIGHT },
            { name: pipName, x: SCREEN_WIDTH - pipW - margin, y: SCREEN_HEIGHT - pipH - margin, width: pipW, height: pipH },
        ];
    },
};

// --- Content helpers (file-based for Vite HMR) ---

const USER_CODE_START = '// --- USER CODE START ---';
const USER_CODE_END = '// --- USER CODE END ---';

function panelDir(name) { return path.join(CONTENT_ROOT, name); }
function panelMainJs(name) { return path.join(CONTENT_ROOT, name, 'main.js'); }

function ensurePanelDir(name) {
    const dir = panelDir(name);
    fs.mkdirSync(dir, { recursive: true });

    const htmlPath = path.join(dir, 'index.html');
    if (!fs.existsSync(htmlPath)) {
        fs.writeFileSync(htmlPath, SHELL_HTML);
    }

    const jsPath = panelMainJs(name);
    if (!fs.existsSync(jsPath)) {
        fs.writeFileSync(jsPath, wrapUserCode('// empty'));
    }
}

function wrapUserCode(code) {
    return `if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    if (typeof window.__hmrCleanup === 'function') window.__hmrCleanup();
  });
  import.meta.hot.accept();
  import.meta.hot.on('state-event', (payload) => {
    if (payload.data && typeof payload.data === 'object') {
      Object.assign(window.__state, payload.data);
    }
    window.dispatchEvent(new CustomEvent('event', { detail: payload }));
  });
}

${USER_CODE_START}
${code}
${USER_CODE_END}

// Fire synthetic init event so user code can read accumulated state
if (Object.keys(window.__state).length > 0) {
  window.dispatchEvent(new CustomEvent('event', { detail: { event: '__init', data: window.__state } }));
}
`;
}

function extractUserCode(fileContent) {
    const startIdx = fileContent.indexOf(USER_CODE_START);
    const endIdx = fileContent.indexOf(USER_CODE_END);
    if (startIdx === -1 || endIdx === -1) return fileContent;
    return fileContent.slice(startIdx + USER_CODE_START.length + 1, endIdx).trimEnd();
}

function writeUserCode(name, code) {
    ensurePanelDir(name);
    fs.writeFileSync(panelMainJs(name), wrapUserCode(code));
}

function readUserCode(name) {
    const jsPath = panelMainJs(name);
    if (!fs.existsSync(jsPath)) return null;
    return extractUserCode(fs.readFileSync(jsPath, 'utf8'));
}

// --- OBS WebSocket v5 Client ---
class OBSConnection {
    constructor() {
        this.ws = null;
        this.requestId = 0;
        this.pending = new Map();
        this.connected = false;
        this.connecting = false;
    }

    async connect(retryMs = 30000) {
        if (this.connected) return;
        if (this.connecting) return;
        this.connecting = true;

        const deadline = Date.now() + retryMs;
        while (Date.now() < deadline) {
            try {
                await this._tryConnect();
                this.connecting = false;
                console.log('OBS WebSocket connected.');
                return;
            } catch {
                await new Promise(r => setTimeout(r, 500));
            }
        }
        this.connecting = false;
        console.error('OBS WebSocket: failed to connect within timeout');
    }

    _tryConnect() {
        return new Promise((resolve, reject) => {
            const ws = new WebSocket('ws://localhost:4455');
            const timeout = setTimeout(() => { ws.close(); reject(new Error('timeout')); }, 3000);

            ws.on('open', () => {
                clearTimeout(timeout);
            });

            ws.on('message', (data) => {
                const msg = JSON.parse(data.toString());

                if (msg.op === 0) {
                    ws.send(JSON.stringify({ op: 1, d: { rpcVersion: 1 } }));
                    return;
                }

                if (msg.op === 2) {
                    this.ws = ws;
                    this.connected = true;
                    resolve();
                    return;
                }

                if (msg.op === 7) {
                    const id = msg.d.requestId;
                    const p = this.pending.get(id);
                    if (p) {
                        this.pending.delete(id);
                        clearTimeout(p.timer);
                        if (msg.d.requestStatus.result) {
                            p.resolve(msg.d.responseData || {});
                        } else {
                            p.reject(new Error(`OBS ${msg.d.requestStatus.code}: ${msg.d.requestStatus.comment || 'unknown'}`));
                        }
                    }
                }
            });

            ws.on('error', (err) => {
                clearTimeout(timeout);
                reject(err);
            });

            ws.on('close', () => {
                this.connected = false;
                this.ws = null;
                for (const [, p] of this.pending) {
                    clearTimeout(p.timer);
                    p.reject(new Error('OBS WebSocket closed'));
                }
                this.pending.clear();
            });
        });
    }

    async request(requestType, requestData = {}, timeoutMs = 5000) {
        if (!this.connected) throw new Error('OBS not connected');
        const id = String(++this.requestId);
        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
                this.pending.delete(id);
                reject(new Error(`OBS request timeout: ${requestType}`));
            }, timeoutMs);
            this.pending.set(id, { resolve, reject, timer });
            this.ws.send(JSON.stringify({
                op: 6,
                d: { requestType, requestId: id, requestData },
            }));
        });
    }
}

const obs = new OBSConnection();

// Source name convention: panel-<name>
function sourceName(panelName) { return `panel-${panelName}`; }

// Panel URL now points to the Vite-served shell (which loads main.js via HMR)
function panelUrl(panelName) { return `http://localhost:${PORT}/@panel/${panelName}/`; }

async function createBrowserSource(name, url, width, height) {
    try {
        await obs.request('CreateInput', {
            sceneName: 'Scene',
            inputName: sourceName(name),
            inputKind: 'browser_source',
            inputSettings: {
                url,
                width,
                height,
                css: '',
                shutdown: false,
                restart_when_active: false,
                reroute_audio: false,
            },
        });
    } catch (err) {
        if (err.message.includes('601')) {
            await obs.request('SetInputSettings', {
                inputName: sourceName(name),
                inputSettings: { url, width, height, css: '' },
            });
        } else {
            throw err;
        }
    }
}

async function removeBrowserSource(name) {
    try {
        await obs.request('RemoveInput', { inputName: sourceName(name) });
    } catch {
        // Ignore if doesn't exist
    }
}

async function setSourceTransform(name, x, y, width, height) {
    try {
        const { sceneItemId } = await obs.request('GetSceneItemId', {
            sceneName: 'Scene',
            sourceName: sourceName(name),
        });
        await obs.request('SetSceneItemTransform', {
            sceneName: 'Scene',
            sceneItemId,
            sceneItemTransform: {
                positionX: x,
                positionY: y,
                boundsType: 'OBS_BOUNDS_STRETCH',
                boundsWidth: width,
                boundsHeight: height,
                boundsAlignment: 0,
            },
        });
    } catch (err) {
        console.error(`Failed to set transform for ${name}:`, err.message);
    }
}

async function applyLayout(specs) {
    if (!obs.connected) {
        console.warn('OBS not connected, skipping layout apply');
        return;
    }

    const existingSources = new Set();
    try {
        const { inputs } = await obs.request('GetInputList', { inputKind: 'browser_source' });
        for (const input of inputs || []) {
            if (input.inputName.startsWith('panel-')) {
                existingSources.add(input.inputName);
            }
        }
    } catch (err) {
        console.error('Failed to list inputs:', err.message);
    }

    const desiredSources = new Set(specs.map(s => sourceName(s.name)));

    for (const existing of existingSources) {
        if (!desiredSources.has(existing)) {
            try {
                await obs.request('RemoveInput', { inputName: existing });
            } catch { /* ignore */ }
        }
    }

    for (const spec of specs) {
        // Ensure panel dir exists on disk for Vite to serve
        ensurePanelDir(spec.name);

        const sn = sourceName(spec.name);
        if (!existingSources.has(sn)) {
            await createBrowserSource(spec.name, panelUrl(spec.name), spec.width, spec.height);
        } else {
            await obs.request('SetInputSettings', {
                inputName: sn,
                inputSettings: { url: panelUrl(spec.name), width: spec.width, height: spec.height },
            });
        }

        if (!panels.has(spec.name)) {
            panels.set(spec.name, { width: spec.width, height: spec.height });
        } else {
            const p = panels.get(spec.name);
            p.width = spec.width;
            p.height = spec.height;
        }

        await setSourceTransform(spec.name, spec.x, spec.y, spec.width, spec.height);
    }
}

async function removeXshmSource() {
    try {
        await obs.request('RemoveInput', { inputName: 'Screen' });
        console.log('Removed pre-existing Screen xshm_input source.');
    } catch {
        // Not present, fine
    }
}

// --- CDP Navigate ---
async function cdpNavigate(url) {
    const tabsRes = await fetch(`http://${CDP_HOST}:${CDP_PORT}/json`);
    const tabs = await tabsRes.json();
    if (!tabs.length) throw new Error('no browser tabs');

    const wsUrl = tabs[0].webSocketDebuggerUrl;
    return new Promise((resolve, reject) => {
        const ws = new WebSocket(wsUrl);
        const timeout = setTimeout(() => { ws.close(); reject(new Error('CDP timeout')); }, 5000);
        ws.on('open', () => {
            ws.send(JSON.stringify({ id: 1, method: 'Page.navigate', params: { url } }));
        });
        ws.on('message', (data) => {
            const msg = JSON.parse(data.toString());
            if (msg.id === 1) {
                clearTimeout(timeout);
                ws.close();
                if (msg.error) reject(new Error(msg.error.message));
                else resolve(msg.result);
            }
        });
        ws.on('error', (err) => { clearTimeout(timeout); reject(err); });
    });
}

// CDP WebSocket proxy
const cdpProxy = httpProxy.createProxyServer({ ws: true, target: `http://${CDP_HOST}:${CDP_PORT}` });
cdpProxy.on('error', (err) => console.error('CDP proxy error:', err.message));

// Token auth middleware
function auth(req, res, next) {
    const token = req.query.token || req.headers['authorization']?.replace('Bearer ', '');
    if (!TOKEN) return next();
    if (token !== TOKEN) return res.status(401).json({ error: 'unauthorized' });
    next();
}

// Activity tracking for session manager GC
let lastActivity = Date.now();

app.use((req, res, next) => {
    if (req.path !== '/health') lastActivity = Date.now();
    next();
});

// Health check (no auth)
app.get('/health', (req, res) => {
    res.json({ status: 'ok', lastActivity, uptime: process.uptime() });
});

// CDP discovery endpoints
async function cdpDiscovery(req, res, cdpPath) {
    try {
        const cdpRes = await fetch(`http://${CDP_HOST}:${CDP_PORT}${cdpPath}`);
        const body = await cdpRes.text();
        const extHost = req.headers.host || `${CDP_HOST}:${PORT}`;
        const rewritten = body.replace(/ws:\/\/localhost:9222/g, `ws://${extHost}`);
        const contentType = cdpRes.headers.get('content-type') || 'application/json';
        res.setHeader('Content-Type', contentType);
        res.send(rewritten);
    } catch (err) {
        console.error('CDP discovery error:', err.message);
        res.status(502).json({ error: 'CDP not available' });
    }
}

app.get('/json', auth, (req, res) => cdpDiscovery(req, res, '/json'));
app.get('/json/version', auth, (req, res) => cdpDiscovery(req, res, '/json/version'));
app.get('/json/list', auth, (req, res) => cdpDiscovery(req, res, '/json/list'));

// --- Panel API (file-based, Vite HMR) ---

// Set content for a panel — writes JS to disk, Vite HMR delivers it
app.post('/api/panel/:name', auth, async (req, res) => {
    const { name } = req.params;
    const { html, width, height } = req.body;
    if (html === undefined) return res.status(400).json({ error: 'html required' });

    const existing = panels.get(name);
    panels.set(name, {
        width: width || existing?.width || SCREEN_WIDTH,
        height: height || existing?.height || SCREEN_HEIGHT,
    });

    writeUserCode(name, html);

    res.json({ status: 'ok', panel: name, length: html.length });
});

// Get panel content (user code only, stripped of wrapper)
app.get('/api/panel/:name', auth, (req, res) => {
    const { name } = req.params;
    const code = readUserCode(name);
    if (code === null) return res.status(404).json({ error: `panel '${name}' not found` });
    const panel = panels.get(name) || { width: SCREEN_WIDTH, height: SCREEN_HEIGHT };
    res.json({ name, html: code, width: panel.width, height: panel.height });
});

// Edit panel content (find/replace in user code section)
app.post('/api/panel/:name/edit', auth, async (req, res) => {
    const { name } = req.params;
    const { old_string, new_string } = req.body;
    if (old_string === undefined) return res.status(400).json({ error: 'old_string required' });
    if (new_string === undefined) return res.status(400).json({ error: 'new_string required' });

    const code = readUserCode(name);
    if (code === null) return res.status(404).json({ error: `panel '${name}' not found` });

    if (!code.includes(old_string)) {
        return res.status(400).json({ error: 'old_string not found in panel content' });
    }

    const count = code.split(old_string).length - 1;
    if (count > 1) {
        return res.status(400).json({ error: `old_string found ${count} times, must be unique` });
    }

    const newCode = code.replace(old_string, new_string);
    writeUserCode(name, newCode);

    res.json({ status: 'ok', panel: name, length: newCode.length });
});

// Emit event to a panel (pushes via Vite HMR WebSocket — no page reload)
app.post('/api/panel/:name/event', auth, (req, res) => {
    const { name } = req.params;
    const { event, data } = req.body;
    if (!event) return res.status(400).json({ error: 'event required' });

    // Merge data into accumulated panel state
    if (data && typeof data === 'object') {
        const state = panelState.get(name) || {};
        Object.assign(state, data);
        panelState.set(name, state);
    }

    // Push to browser via Vite custom HMR event
    if (vite) {
        vite.ws.send({ type: 'custom', event: 'state-event', data: { event, data } });
    }

    res.json({ status: 'ok', event });
});

// Get accumulated state for a panel
app.get('/api/panel/:name/state', auth, (req, res) => {
    const { name } = req.params;
    res.json(panelState.get(name) || {});
});

// Delete a panel
app.delete('/api/panel/:name', auth, async (req, res) => {
    const { name } = req.params;
    panels.delete(name);
    panelState.delete(name);

    // Remove content dir
    const dir = panelDir(name);
    if (fs.existsSync(dir)) {
        fs.rmSync(dir, { recursive: true });
    }

    try {
        await removeBrowserSource(name);
    } catch { /* ignore */ }

    res.json({ status: 'ok', panel: name, deleted: true });
});

// List all panels
app.get('/api/panels', auth, (req, res) => {
    const list = [];
    for (const [name, panel] of panels) {
        const code = readUserCode(name);
        list.push({ name, width: panel.width, height: panel.height, codeLength: code?.length || 0 });
    }
    res.json({ panels: list, layout: currentLayout });
});

// --- Backward Compat: /api/template → main panel ---

app.post('/api/template', auth, async (req, res) => {
    const { html } = req.body;
    if (!html) return res.status(400).json({ error: 'html required' });

    const existing = panels.get('main');
    panels.set('main', {
        width: existing?.width || SCREEN_WIDTH,
        height: existing?.height || SCREEN_HEIGHT,
    });

    writeUserCode('main', html);

    res.json({ status: 'ok', length: html.length });
});

app.get('/api/template', auth, (req, res) => {
    const code = readUserCode('main');
    res.json({ html: code || '' });
});

app.post('/api/template/edit', auth, async (req, res) => {
    const { old_string, new_string } = req.body;
    if (old_string === undefined) return res.status(400).json({ error: 'old_string required' });
    if (new_string === undefined) return res.status(400).json({ error: 'new_string required' });

    const code = readUserCode('main');
    if (!code) {
        ensurePanelDir('main');
        return res.status(400).json({ error: 'old_string not found in current content' });
    }

    if (!code.includes(old_string)) {
        return res.status(400).json({ error: 'old_string not found in current content' });
    }

    const count = code.split(old_string).length - 1;
    if (count > 1) {
        return res.status(400).json({ error: `old_string found ${count} times, must be unique` });
    }

    const newCode = code.replace(old_string, new_string);
    writeUserCode('main', newCode);

    res.json({ status: 'ok', length: newCode.length });
});

// --- Layout API ---

app.post('/api/layout', auth, async (req, res) => {
    const { preset, names, specs } = req.body;

    let layoutSpecs;

    if (preset) {
        const presetFn = LAYOUT_PRESETS[preset];
        if (!presetFn) {
            return res.status(400).json({ error: `unknown preset: ${preset}`, available: Object.keys(LAYOUT_PRESETS) });
        }
        layoutSpecs = presetFn(names || []);
    } else if (specs) {
        if (!Array.isArray(specs) || specs.length === 0) {
            return res.status(400).json({ error: 'specs must be a non-empty array' });
        }
        for (const s of specs) {
            if (!s.name || s.x === undefined || s.y === undefined || !s.width || !s.height) {
                return res.status(400).json({ error: 'each spec needs: name, x, y, width, height' });
            }
        }
        layoutSpecs = specs;
    } else {
        return res.status(400).json({ error: 'provide preset or specs' });
    }

    currentLayout = { preset: preset || null, specs: layoutSpecs };

    try {
        await applyLayout(layoutSpecs);
        res.json({ status: 'ok', layout: currentLayout });
    } catch (err) {
        console.error('Layout error:', err);
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/layout', auth, (req, res) => {
    res.json(currentLayout);
});

// Navigate Chrome via CDP
app.post('/api/navigate', auth, async (req, res) => {
    const { url } = req.body;
    if (!url) return res.status(400).json({ error: 'url required' });

    try {
        await cdpNavigate(url);
        res.json({ status: 'navigated', url });
    } catch (err) {
        console.error('Navigate error:', err);
        res.status(500).json({ error: err.message });
    }
});

// Serve HLS preview segments
app.use('/hls', auth, express.static('/tmp/hls', {
    setHeaders: (res) => {
        res.setHeader('Cache-Control', 'no-cache, no-store');
    }
}));

// Create HTTP server
const server = http.createServer(app);

// WebSocket upgrade: let Vite HMR through, proxy everything else to CDP
server.on('upgrade', (req, socket, head) => {
    // Vite HMR WebSocket — let Vite handle it (it registered its own listener)
    if (req.url.startsWith('/@panel/') || req.url.includes('__vite')) {
        return; // Vite's own upgrade listener handles this
    }

    const urlParams = new URL(req.url, 'http://localhost').searchParams;
    const token = urlParams.get('token');

    if (TOKEN && token !== TOKEN) {
        socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
        socket.destroy();
        return;
    }

    lastActivity = Date.now();

    cdpProxy.ws(req, socket, head, {
        target: `ws://${CDP_HOST}:${CDP_PORT}`,
    });
});

// --- Startup ---

async function start() {
    // Ensure content root exists
    fs.mkdirSync(CONTENT_ROOT, { recursive: true });

    // Initialize Vite dev server (ESM dynamic import)
    try {
        const { initVite } = await import('./vite-init.mjs');
        vite = await initVite(CONTENT_ROOT, server);
        console.log('Vite HMR server initialized.');

        // Mount Vite middleware at root — Vite only handles paths matching its base (/@panel/)
        app.use(vite.middlewares);
    } catch (err) {
        console.error('Failed to initialize Vite:', err);
        console.log('Falling back without HMR support.');
    }

    server.listen(PORT, async () => {
        console.log(`Server listening on port ${PORT}`);
        console.log(`Auth: ${TOKEN ? 'enabled' : 'disabled'}`);

        // Connect to OBS and set up default layout
        try {
            await obs.connect(30000);
            await removeXshmSource();

            const defaultSpecs = LAYOUT_PRESETS.single(['main']);
            currentLayout = { preset: 'single', specs: defaultSpecs };
            await applyLayout(defaultSpecs);
            console.log('Default layout applied (single panel).');
        } catch (err) {
            console.error('OBS startup setup error:', err.message);
            console.log('Server running without OBS connection. Panels will work when OBS connects.');
        }
    });
}

start();
