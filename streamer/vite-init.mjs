import { createServer } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

/**
 * Create a Vite dev server in middleware mode for HMR.
 * @param {string} contentRoot - Root dir for content files (e.g. /tmp/content)
 * @param {import('http').Server} httpServer - Existing HTTP server for HMR WebSocket
 * @returns {Promise<import('vite').ViteDevServer>}
 */
export async function initVite(contentRoot, httpServer) {
    const vite = await createServer({
        root: contentRoot,
        base: '/@panel/',
        appType: 'mpa',
        plugins: [react(), tailwindcss()],
        server: {
            middlewareMode: true,
            hmr: { server: httpServer },
            watch: {
                usePolling: true,
                interval: 200,
            },
        },
        // Suppress most logging — we only care about HMR
        logLevel: 'warn',
        optimizeDeps: {
            include: ['react', 'react-dom/client', 'zustand', 'zustand/middleware'],
        },
    });

    return vite;
}
