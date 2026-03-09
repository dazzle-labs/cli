const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const tar = require('tar-stream');

// Per-syncDir state (allows multiple instances for testing)
const stateByDir = new Map();

function getState(syncDir) {
    if (!stateByDir.has(syncDir)) {
        stateByDir.set(syncDir, {
            entryPoint: null,
            manifestCache: null,  // Map<relativePath, sha256> — performance cache
            pendingSync: null,    // Map<relativePath, sha256> from last diff
        });
    }
    return stateByDir.get(syncDir);
}

function validateSyncPath(syncDir, filePath) {
    if (path.isAbsolute(filePath)) return false;
    if (filePath.includes('..')) return false;
    const resolved = path.resolve(syncDir, filePath);
    if (!resolved.startsWith(syncDir + path.sep) && resolved !== syncDir) return false;
    return true;
}

function hashFile(filePath) {
    const content = fs.readFileSync(filePath);
    return crypto.createHash('sha256').update(content).digest('hex');
}

function walkDir(dir, base) {
    const result = {};
    if (!fs.existsSync(dir)) return result;
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        const relPath = base ? base + '/' + entry.name : entry.name;
        if (entry.isSymbolicLink()) continue;
        if (entry.isDirectory()) {
            Object.assign(result, walkDir(fullPath, relPath));
        } else if (entry.isFile()) {
            result[relPath] = hashFile(fullPath);
        }
    }
    return result;
}

function cleanStaleFiles(syncDir, manifest) {
    const diskFiles = walkDir(syncDir, '');
    let deleted = 0;

    for (const filePath of Object.keys(diskFiles)) {
        if (!(filePath in manifest)) {
            const fullPath = path.join(syncDir, filePath);
            try {
                fs.unlinkSync(fullPath);
                deleted++;
                // Clean up empty parent directories
                let dir = path.dirname(fullPath);
                while (dir !== syncDir && dir.startsWith(syncDir)) {
                    const entries = fs.readdirSync(dir);
                    if (entries.length === 0) {
                        fs.rmdirSync(dir);
                        dir = path.dirname(dir);
                    } else {
                        break;
                    }
                }
            } catch {}
        }
    }

    return deleted;
}

function mountSyncRoutes(app, syncDir, auth) {
    const state = getState(syncDir);

    // POST /api/sync/diff — compare local manifest against disk
    app.post('/api/sync/diff', auth, express.json({ limit: '50mb' }), (req, res) => {
        const { files, entry } = req.body;
        if (!files || typeof files !== 'object') {
            return res.status(400).json({ error: 'files manifest required' });
        }

        // Validate all paths
        for (const filePath of Object.keys(files)) {
            if (!validateSyncPath(syncDir, filePath)) {
                return res.status(400).json({ error: `invalid path: ${filePath}` });
            }
        }

        // Store entry point for refresh
        if (entry) {
            if (!validateSyncPath(syncDir, entry)) {
                return res.status(400).json({ error: `invalid entry point path: ${entry}` });
            }
            state.entryPoint = entry;
        }

        // Store manifest for auto-clean on next push
        state.pendingSync = files;

        // Get current state from cache or disk
        let diskManifest;
        if (state.manifestCache) {
            diskManifest = state.manifestCache;
        } else {
            diskManifest = walkDir(syncDir, '');
            state.manifestCache = diskManifest;
        }

        // Compute which files need uploading
        const need = [];
        for (const [filePath, hash] of Object.entries(files)) {
            if (diskManifest[filePath] !== hash) {
                need.push(filePath);
            }
        }

        res.json({ need });
    });

    // POST /api/sync/push — receive tar of files to extract, auto-clean stale files
    app.post('/api/sync/push', auth, express.raw({ limit: '256mb', type: 'application/x-tar' }), (req, res) => {
        const extract = tar.extract();
        let synced = 0;
        let responded = false;
        const newHashes = {};
        const MAX_TAR_FILES = 10000;

        extract.on('entry', (header, stream, next) => {
            if (header.type !== 'file') {
                stream.resume();
                next();
                return;
            }

            if (synced >= MAX_TAR_FILES) {
                stream.resume();
                next(new Error(`too many files (max ${MAX_TAR_FILES})`));
                return;
            }

            const filePath = header.name;

            if (!validateSyncPath(syncDir, filePath)) {
                stream.resume();
                next(new Error(`invalid path: ${filePath}`));
                return;
            }

            const fullPath = path.join(syncDir, filePath);
            fs.mkdirSync(path.dirname(fullPath), { recursive: true });

            const chunks = [];
            stream.on('data', (chunk) => chunks.push(chunk));
            stream.on('end', () => {
                const content = Buffer.concat(chunks);
                fs.writeFileSync(fullPath, content);
                newHashes[filePath] = crypto.createHash('sha256').update(content).digest('hex');
                synced++;
                next();
            });
            stream.on('error', next);
        });

        extract.on('finish', () => {
            if (responded) return;
            responded = true;

            // Update cache with newly written files
            if (!state.manifestCache) state.manifestCache = {};
            Object.assign(state.manifestCache, newHashes);

            // Auto-clean: delete files not in the manifest from the last diff
            let deleted = 0;
            if (state.pendingSync) {
                deleted = cleanStaleFiles(syncDir, state.pendingSync);
                // Rebuild cache from disk after cleanup
                state.manifestCache = walkDir(syncDir, '');
            }

            res.json({ synced, deleted });
        });

        extract.on('error', (err) => {
            if (responded) return;
            responded = true;
            state.manifestCache = null;
            res.status(400).json({ error: err.message });
        });

        const { Readable } = require('stream');
        const readable = new Readable();
        readable.push(req.body);
        readable.push(null);
        readable.pipe(extract);
    });

    // Serve synced content as static files
    app.use('/@sync/', express.static(syncDir));

    // POST /api/sync/refresh — navigate Chrome to the stored entry point
    // Note: in production, cdpNavigate is passed in. For the extracted module,
    // we expose the entry point and let the caller handle navigation.
    app.post('/api/sync/refresh', auth, async (req, res) => {
        if (!state.entryPoint) {
            return res.status(400).json({ error: 'no entry point configured — run sync first' });
        }
        // When used standalone (tests), just return ok with the entry point
        // In production, index.js overrides this with CDP navigation
        res.json({ ok: true, entry: state.entryPoint });
    });
}

module.exports = { mountSyncRoutes, getSyncState: getState };
