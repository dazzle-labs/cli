/**
 * Watch mode for runtime scripts.
 * Rebuilds prelude.js and renderer.js on source changes using esbuild's watch API.
 * Also watches the catalog source and regenerates catalog-index.md / catalog-full.md.
 *
 * Usage: npm run watch (or: node watch.mjs)
 */
import * as esbuild from "esbuild"
import { execSync } from "child_process"
import fs from "fs"
import path from "path"
import { fileURLToPath } from "url"

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// Shared esbuild plugin that logs on rebuild
function logPlugin(label) {
  return {
    name: "log",
    setup(build) {
      build.onEnd((result) => {
        const errors = result.errors.length
        if (errors > 0) {
          console.log(`\x1b[31m[${label}] ${errors} error(s)\x1b[0m`)
        } else {
          const now = new Date().toLocaleTimeString()
          console.log(`\x1b[32m[${label}] rebuilt\x1b[0m  ${now}`)
        }
      })
    },
  }
}

// Start esbuild in watch mode for prelude
const preludeCtx = await esbuild.context({
  entryPoints: [path.join(__dirname, "prelude.ts")],
  bundle: true,
  format: "iife",
  minify: true,
  outfile: path.join(__dirname, "dist/prelude.js"),
  banner: { js: "/* prelude: React, ReactDOM, Zustand globals */" },
  plugins: [logPlugin("prelude")],
})

// Start esbuild in watch mode for renderer
const rendererCtx = await esbuild.context({
  entryPoints: [path.join(__dirname, "renderer.tsx")],
  bundle: true,
  format: "iife",
  minify: true,
  globalName: "__sceneRuntime",
  outfile: path.join(__dirname, "dist/renderer.js"),
  external: ["react", "react-dom", "zustand"],
  jsx: "transform",
  banner: {
    js: "/* renderer: spec-driven renderer with full component catalog */",
  },
  plugins: [logPlugin("renderer")],
})

await preludeCtx.watch()
await rendererCtx.watch()
console.log("[runtime] Watching for changes...")

// Watch catalog source files and regenerate on change
const catalogSources = [
  path.resolve(__dirname, "catalogs/general/catalog.ts"),
  path.resolve(__dirname, "catalogs/coding/catalog.ts"),
  path.resolve(__dirname, "core/catalog.ts"),
]

let catalogTimer = null
function rebuildCatalog() {
  if (catalogTimer) clearTimeout(catalogTimer)
  catalogTimer = setTimeout(() => {
    try {
      execSync("npx tsx generate-catalog.ts", { cwd: __dirname, stdio: "pipe" })
      const now = new Date().toLocaleTimeString()
      console.log(`\x1b[32m[catalog] rebuilt\x1b[0m  ${now}`)
    } catch (err) {
      console.log(`\x1b[31m[catalog] error: ${err.message}\x1b[0m`)
    }
  }, 300)
}

for (const src of catalogSources) {
  if (fs.existsSync(src)) {
    fs.watch(src, () => rebuildCatalog())
  }
}

// Keep process alive
process.on("SIGINT", async () => {
  await preludeCtx.dispose()
  await rendererCtx.dispose()
  process.exit(0)
})
