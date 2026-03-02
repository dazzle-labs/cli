const express = require('express');
const http = require('http');
const httpProxy = require('http-proxy');

const app = express();
app.use(express.json({ limit: '5mb' }));

const PORT = process.env.PORT || 8080;
const TOKEN = process.env.TOKEN;
const CDP_HOST = 'localhost';
const CDP_PORT = 9222;

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

// Activity tracking for session manager GC
let lastActivity = Date.now();

// Touch activity on every non-health request
app.use((req, res, next) => {
    if (req.path !== '/health') lastActivity = Date.now();
    next();
});

// Health check (no auth)
app.get('/health', (req, res) => {
    res.json({ status: 'ok', lastActivity, uptime: process.uptime() });
});

// CDP discovery endpoints — proxy to Chrome and rewrite WebSocket URLs
async function cdpDiscovery(req, res, cdpPath) {
    try {
        const cdpRes = await fetch(`http://${CDP_HOST}:${CDP_PORT}${cdpPath}`);
        const body = await cdpRes.text();
        const extHost = req.headers.host || `${CDP_HOST}:${PORT}`;
        // Rewrite ws://localhost:9222 → ws://<external host>/devtools
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

// Template storage for HTML rendering
let currentTemplate = '';

// Store HTML template and navigate Chrome to render it
app.post('/api/template', auth, async (req, res) => {
    const { html } = req.body;
    if (!html) return res.status(400).json({ error: 'html required' });

    currentTemplate = html;

    try {
        // Navigate Chrome to our template endpoint
        const tabsRes = await fetch(`http://${CDP_HOST}:${CDP_PORT}/json`);
        const tabs = await tabsRes.json();
        if (!tabs.length) return res.status(500).json({ error: 'no browser tabs' });

        const tabId = tabs[0].id;
        const templateUrl = `http://localhost:${PORT}/template`;
        await fetch(`http://${CDP_HOST}:${CDP_PORT}/json/navigate?url=${encodeURIComponent(templateUrl)}&id=${tabId}`);

        res.json({ status: 'ok', length: html.length });
    } catch (err) {
        console.error('Template error:', err);
        res.status(500).json({ error: err.message });
    }
});

// Get current HTML template
app.get('/api/template', auth, (req, res) => {
    res.json({ html: currentTemplate });
});

// Serve template to Chrome (no auth — localhost only)
app.get('/template', (req, res) => {
    res.setHeader('Content-Type', 'text/html');
    res.send(currentTemplate || '<html><body></body></html>');
});

// Edit current HTML template (find and replace)
app.post('/api/template/edit', auth, async (req, res) => {
    const { old_string, new_string } = req.body;
    if (old_string === undefined) return res.status(400).json({ error: 'old_string required' });
    if (new_string === undefined) return res.status(400).json({ error: 'new_string required' });

    if (!currentTemplate.includes(old_string)) {
        return res.status(400).json({ error: 'old_string not found in current HTML' });
    }

    // Check for uniqueness — only replace if it appears exactly once
    const count = currentTemplate.split(old_string).length - 1;
    if (count > 1) {
        return res.status(400).json({ error: `old_string found ${count} times, must be unique` });
    }

    currentTemplate = currentTemplate.replace(old_string, new_string);

    try {
        // Re-navigate Chrome to refresh the template
        const tabsRes = await fetch(`http://${CDP_HOST}:${CDP_PORT}/json`);
        const tabs = await tabsRes.json();
        if (tabs.length) {
            const tabId = tabs[0].id;
            const templateUrl = `http://localhost:${PORT}/template`;
            await fetch(`http://${CDP_HOST}:${CDP_PORT}/json/navigate?url=${encodeURIComponent(templateUrl)}&id=${tabId}`);
        }

        res.json({ status: 'ok', length: currentTemplate.length });
    } catch (err) {
        console.error('Template edit error:', err);
        res.status(500).json({ error: err.message });
    }
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

    // Proxy to Chrome CDP
    // For /devtools/* paths, forward as-is (Playwright uses these)
    // For other paths (legacy root WS), also proxy to CDP
    cdpProxy.ws(req, socket, head, {
        target: `ws://${CDP_HOST}:${CDP_PORT}`,
    });
});

server.listen(PORT, () => {
    console.log(`Server listening on port ${PORT}`);
    console.log(`Auth: ${TOKEN ? 'enabled' : 'disabled'}`);
});
