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

const CONTENT_ROOT = '/app/content';
const SHELL_HTML = fs.readFileSync(path.join(__dirname, 'shell.html'), 'utf8');
const PRELUDE_JS = fs.readFileSync(path.join(__dirname, 'prelude.js'), 'utf8');

// --- Panel metadata (dimensions only — content lives on disk) ---
// Map<string, { width: number, height: number }>
const panels = new Map();

// --- Per-panel accumulated state (for emit_event) ---
// Map<string, object>
const panelState = new Map();

// Vite dev server instance (set during startup)
let vite = null;

// --- Content helpers (file-based for Vite HMR) ---

const USER_CODE_START = '// --- USER CODE START ---';
const USER_CODE_END = '// --- USER CODE END ---';

function panelDir(name) { return path.join(CONTENT_ROOT, name); }
function panelMainJs(name) { return path.join(CONTENT_ROOT, name, 'main.jsx'); }

function ensurePanelDir(name) {
    const dir = panelDir(name);
    fs.mkdirSync(dir, { recursive: true });

    const htmlPath = path.join(dir, 'index.html');
    if (!fs.existsSync(htmlPath)) {
        fs.writeFileSync(htmlPath, SHELL_HTML);
    }

    const preludePath = path.join(dir, 'prelude.js');
    if (!fs.existsSync(preludePath)) {
        fs.writeFileSync(preludePath, PRELUDE_JS);
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

// Auto-mount: if user defined App (or window.App as fallback for non-module-scope components)
const _appToMount = (typeof App !== 'undefined') ? App : window.App;
if (_appToMount) {
  try {
    const _rootEl = document.getElementById('root');
    if (!_rootEl) {
      console.error('[panel] React mount failed: #root element not found');
    } else if (window.__reactRoot) {
      // Re-render into existing root — React reconciles in-place, no DOM flash.
      // State is preserved when the component tree structure matches.
      window.__reactRoot.render(window.React.createElement(_appToMount));
    } else {
      const _root = window.createRoot(_rootEl);
      window.__reactRoot = _root;
      _root.render(window.React.createElement(_appToMount));
    }
  } catch (err) {
    console.error('[panel] React mount failed:', err);
  }
} else if (window.__reactRoot) {
  // Switching from React scene to vanilla JS — unmount React
  try {
    window.__reactRoot.unmount();
  } catch (err) {
    console.error('[panel] React unmount failed:', err);
  }
  window.__reactRoot = null;
}

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

// Panel URL now points to the Vite-served shell (which loads main.jsx via HMR)
function panelUrl(panelName) { return `http://localhost:${PORT}/@panel/${panelName}/`; }

// Track what Chrome is currently navigated to, so we only navigate when needed
let currentChromeUrl = null;

async function ensureXshmSource() {
    // Create if not exists (601 = already exists, ignore)
    try {
        await obs.request('CreateInput', {
            sceneName: 'Scene',
            inputName: 'Screen',
            inputKind: 'xshm_input',
            inputSettings: { screen: 0, show_cursor: false, advanced: false },
        });
    } catch (err) {
        if (!err.message.includes('601')) throw err;
    }

    // Always set transform and enable — idempotent
    const { sceneItemId } = await obs.request('GetSceneItemId', {
        sceneName: 'Scene', sourceName: 'Screen',
    });
    await obs.request('SetSceneItemTransform', {
        sceneName: 'Scene', sceneItemId,
        sceneItemTransform: {
            positionX: 0, positionY: 0,
            boundsType: 'OBS_BOUNDS_STRETCH',
            boundsWidth: SCREEN_WIDTH, boundsHeight: SCREEN_HEIGHT,
            boundsAlignment: 0,
        },
    });
    await obs.request('SetSceneItemEnabled', {
        sceneName: 'Scene', sceneItemId, sceneItemEnabled: true,
    });
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

// --- Panel HTML serving (Vite middleware mode doesn't serve HTML, we do it) ---

// Serve panel HTML — Vite middleware mode only handles transforms, not HTML serving
app.get('/@panel/:name', async (req, res, next) => {
    const { name } = req.params;
    ensurePanelDir(name);
    const htmlPath = path.join(panelDir(name), 'index.html');
    try {
        let html = fs.readFileSync(htmlPath, 'utf8');
        if (vite) html = await vite.transformIndexHtml(req.url, html);
        res.setHeader('Content-Type', 'text/html');
        res.send(html);
    } catch (err) { next(err); }
});

// Also handle trailing slash: /@panel/main/
app.get('/@panel/:name/', async (req, res, next) => {
    const { name } = req.params;
    ensurePanelDir(name);
    const htmlPath = path.join(panelDir(name), 'index.html');
    try {
        let html = fs.readFileSync(htmlPath, 'utf8');
        if (vite) html = await vite.transformIndexHtml(req.url, html);
        res.setHeader('Content-Type', 'text/html');
        res.send(html);
    } catch (err) { next(err); }
});

// --- Panel API (file-based, Vite HMR) ---

// Set content for a panel — writes JS to disk, Vite HMR delivers it
app.post('/api/panel/:name', auth, async (req, res) => {
    const { name } = req.params;
    const { script, width, height } = req.body;
    if (script === undefined) return res.status(400).json({ error: 'script required' });

    const existing = panels.get(name);
    panels.set(name, {
        width: width || existing?.width || SCREEN_WIDTH,
        height: height || existing?.height || SCREEN_HEIGHT,
    });

    writeUserCode(name, script);

    // Navigate Chrome to this panel if it's not already showing it
    const targetUrl = panelUrl(name);
    if (currentChromeUrl !== targetUrl) {
        try {
            console.log(`Navigating Chrome: ${currentChromeUrl} → ${targetUrl}`);
            await cdpNavigate(targetUrl);
            currentChromeUrl = targetUrl;
        } catch (err) {
            console.error(`CDP navigate failed: ${err.message}`);
        }
    }

    res.json({ status: 'ok', panel: name, length: script.length });
});

// Get panel content (user code only, stripped of wrapper)
app.get('/api/panel/:name', auth, (req, res) => {
    const { name } = req.params;
    const code = readUserCode(name);
    if (code === null) return res.status(404).json({ error: `panel '${name}' not found` });
    const panel = panels.get(name) || { width: SCREEN_WIDTH, height: SCREEN_HEIGHT };
    res.json({ name, script: code, width: panel.width, height: panel.height });
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

    // Use a replacer function so special `$` patterns in new_string (e.g. $&, $`, ${...})
    // are not interpreted as String.prototype.replace replacement patterns.
    const newCode = code.replace(old_string, () => new_string);
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

    res.json({ status: 'ok', panel: name, deleted: true });
});

// List all panels
app.get('/api/panels', auth, (req, res) => {
    const list = [];
    for (const [name, panel] of panels) {
        const code = readUserCode(name);
        list.push({ name, width: panel.width, height: panel.height, codeLength: code?.length || 0 });
    }
    res.json({ panels: list });
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

    // Ensure default panel exists before server starts (Chrome will load it on launch)
    ensurePanelDir('main');
    panels.set('main', { width: SCREEN_WIDTH, height: SCREEN_HEIGHT });
    currentChromeUrl = panelUrl('main');

    server.listen(PORT, async () => {
        console.log(`Server listening on port ${PORT}`);
        console.log(`Auth: ${TOKEN ? 'enabled' : 'disabled'}`);

        // Connect to OBS and set up xshm screen capture
        try {
            await obs.connect(30000);
            await ensureXshmSource();
            console.log('OBS xshm source ready.');
        } catch (err) {
            console.error('OBS startup error:', err.message);
            console.log('Server running without OBS. Panels will work when OBS connects.');
        }
    });
}

start();
