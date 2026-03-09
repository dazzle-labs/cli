import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import crypto from 'crypto';
import tar from 'tar-stream';

import { mountSyncRoutes, getSyncState } from './sync.js';

function noopAuth(req, res, next) { next(); }

function createApp(syncDir) {
    const app = express();
    mountSyncRoutes(app, syncDir, noopAuth);
    return app;
}

function hashContent(content) {
    return crypto.createHash('sha256').update(content).digest('hex');
}

function makeTar(files) {
    return new Promise((resolve, reject) => {
        const pack = tar.pack();
        for (const [name, content] of Object.entries(files)) {
            pack.entry({ name, type: 'file' }, content);
        }
        pack.finalize();

        const chunks = [];
        pack.on('data', (chunk) => chunks.push(chunk));
        pack.on('end', () => resolve(Buffer.concat(chunks)));
        pack.on('error', reject);
    });
}

describe('Sync API', () => {
    let tmpDir;
    let app;

    beforeEach(() => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sync-test-'));
        app = createApp(tmpDir);
    });

    afterEach(() => {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    describe('POST /api/sync/diff', () => {
        it('should return files that need uploading', async () => {
            const res = await request(app)
                .post('/api/sync/diff')
                .send({
                    files: { 'index.html': hashContent('hello'), 'app.js': hashContent('code') },
                    entry: 'index.html',
                });

            expect(res.status).toBe(200);
            expect(res.body.need).toEqual(expect.arrayContaining(['index.html', 'app.js']));
            expect(res.body.need).toHaveLength(2);
        });

        it('should store manifest in pending sync state', async () => {
            await request(app)
                .post('/api/sync/diff')
                .send({
                    files: { 'index.html': hashContent('hello') },
                    entry: 'index.html',
                });

            const state = getSyncState(tmpDir);
            expect(state.pendingSync).toEqual({ 'index.html': hashContent('hello') });
        });

        it('should not include files already on disk with matching hash', async () => {
            // Pre-populate a file on disk
            fs.writeFileSync(path.join(tmpDir, 'existing.html'), 'hello');

            // Invalidate cache so it re-reads disk
            getSyncState(tmpDir).manifestCache = null;

            const res = await request(app)
                .post('/api/sync/diff')
                .send({
                    files: {
                        'existing.html': hashContent('hello'),
                        'new.js': hashContent('new code'),
                    },
                    entry: 'existing.html',
                });

            expect(res.status).toBe(200);
            expect(res.body.need).toEqual(['new.js']);
        });

        it('should overwrite pendingSync when a newer diff arrives', async () => {
            await request(app)
                .post('/api/sync/diff')
                .send({
                    files: { 'a.html': hashContent('a') },
                    entry: 'a.html',
                });

            await request(app)
                .post('/api/sync/diff')
                .send({
                    files: { 'b.html': hashContent('b') },
                    entry: 'b.html',
                });

            const state = getSyncState(tmpDir);
            expect(state.pendingSync).toEqual({ 'b.html': hashContent('b') });
        });
    });

    describe('POST /api/sync/push', () => {
        it('should extract tar and auto-clean stale files', async () => {
            // Pre-populate a stale file on disk
            fs.writeFileSync(path.join(tmpDir, 'stale.txt'), 'old content');

            // Diff with only index.html in manifest
            await request(app)
                .post('/api/sync/diff')
                .send({
                    files: { 'index.html': hashContent('<h1>Hi</h1>') },
                    entry: 'index.html',
                });

            // Push the tar
            const tarBuf = await makeTar({ 'index.html': '<h1>Hi</h1>' });
            const res = await request(app)
                .post('/api/sync/push')
                .set('Content-Type', 'application/x-tar')
                .send(tarBuf);

            expect(res.status).toBe(200);
            expect(res.body.synced).toBe(1);
            expect(res.body.deleted).toBe(1);

            // Verify stale file was deleted
            expect(fs.existsSync(path.join(tmpDir, 'stale.txt'))).toBe(false);
            // Verify new file exists
            expect(fs.existsSync(path.join(tmpDir, 'index.html'))).toBe(true);
        });

        it('should clean empty parent directories after deleting files', async () => {
            // Pre-populate nested stale file
            fs.mkdirSync(path.join(tmpDir, 'sub', 'deep'), { recursive: true });
            fs.writeFileSync(path.join(tmpDir, 'sub', 'deep', 'old.txt'), 'old');

            await request(app)
                .post('/api/sync/diff')
                .send({
                    files: { 'index.html': hashContent('hi') },
                    entry: 'index.html',
                });

            const tarBuf = await makeTar({ 'index.html': 'hi' });
            const res = await request(app)
                .post('/api/sync/push')
                .set('Content-Type', 'application/x-tar')
                .send(tarBuf);

            expect(res.status).toBe(200);
            expect(res.body.deleted).toBe(1);

            // Empty parent dirs should be cleaned
            expect(fs.existsSync(path.join(tmpDir, 'sub'))).toBe(false);
        });

        it('should handle empty push (no files to sync) and still clean', async () => {
            // Pre-populate stale files
            fs.writeFileSync(path.join(tmpDir, 'stale.txt'), 'old');

            // Diff with manifest that doesn't include stale.txt
            await request(app)
                .post('/api/sync/diff')
                .send({
                    files: { 'index.html': hashContent('hi') },
                    entry: 'index.html',
                });

            // Push empty tar
            const pack = tar.pack();
            pack.finalize();
            const chunks = [];
            await new Promise((resolve) => {
                pack.on('data', (c) => chunks.push(c));
                pack.on('end', resolve);
            });
            const emptyTar = Buffer.concat(chunks);

            const res = await request(app)
                .post('/api/sync/push')
                .set('Content-Type', 'application/x-tar')
                .send(emptyTar);

            expect(res.status).toBe(200);
            expect(res.body.synced).toBe(0);
            // stale.txt is not in manifest, should be deleted
            expect(res.body.deleted).toBe(1);
            expect(fs.existsSync(path.join(tmpDir, 'stale.txt'))).toBe(false);
        });

        it('should rebuild manifest cache after cleanup', async () => {
            fs.writeFileSync(path.join(tmpDir, 'stale.txt'), 'old');

            await request(app)
                .post('/api/sync/diff')
                .send({
                    files: { 'index.html': hashContent('hi') },
                    entry: 'index.html',
                });

            const tarBuf = await makeTar({ 'index.html': 'hi' });
            await request(app)
                .post('/api/sync/push')
                .set('Content-Type', 'application/x-tar')
                .send(tarBuf);

            // Now do another diff — should only have index.html on disk
            const res = await request(app)
                .post('/api/sync/diff')
                .send({
                    files: { 'index.html': hashContent('hi') },
                    entry: 'index.html',
                });

            expect(res.body.need).toEqual([]);
        });

        it('should skip cleanup if no diff preceded the push', async () => {
            fs.writeFileSync(path.join(tmpDir, 'existing.txt'), 'keep');

            const tarBuf = await makeTar({ 'new.txt': 'new' });
            const res = await request(app)
                .post('/api/sync/push')
                .set('Content-Type', 'application/x-tar')
                .send(tarBuf);

            expect(res.status).toBe(200);
            expect(res.body.synced).toBe(1);
            expect(res.body.deleted).toBe(0);

            // existing file should still be there
            expect(fs.existsSync(path.join(tmpDir, 'existing.txt'))).toBe(true);
        });
    });

    describe('POST /api/sync/clean (removed)', () => {
        it('should return 404 for the removed clean endpoint', async () => {
            const res = await request(app)
                .post('/api/sync/clean')
                .send({ files: {} });

            expect(res.status).toBe(404);
        });
    });

    describe('Sequential re-sync (last writer wins)', () => {
        it('should use the latest diff manifest for cleanup', async () => {
            // Diff A
            await request(app)
                .post('/api/sync/diff')
                .send({
                    files: { 'a.html': hashContent('a-content') },
                    entry: 'a.html',
                });

            // Diff B overwrites pendingSync
            await request(app)
                .post('/api/sync/diff')
                .send({
                    files: { 'b.html': hashContent('b-content') },
                    entry: 'b.html',
                });

            // Push A — extracts a.html, cleans with B's manifest (a.html not in B, gets deleted)
            const tarA = await makeTar({ 'a.html': 'a-content' });
            await request(app)
                .post('/api/sync/push')
                .set('Content-Type', 'application/x-tar')
                .send(tarA);

            // Push B — extracts b.html, cleans with B's manifest
            const tarB = await makeTar({ 'b.html': 'b-content' });
            const resB = await request(app)
                .post('/api/sync/push')
                .set('Content-Type', 'application/x-tar')
                .send(tarB);

            expect(resB.body.synced).toBe(1);
            expect(resB.body.deleted).toBe(0);

            // Final state: only b.html
            expect(fs.existsSync(path.join(tmpDir, 'b.html'))).toBe(true);
            expect(fs.existsSync(path.join(tmpDir, 'a.html'))).toBe(false);
        });
    });

    describe('POST /api/sync/refresh', () => {
        it('should return error when no entry point is configured', async () => {
            const res = await request(app)
                .post('/api/sync/refresh');

            expect(res.status).toBe(400);
            expect(res.body.error).toContain('no entry point');
        });
    });
});
