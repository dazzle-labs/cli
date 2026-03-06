/**
 * Generate static catalog text files for the control-plane.
 * Run: cd runtime && npx tsx generate-catalog.ts
 * Outputs: dist/catalog-index.md and dist/catalog-full.md
 */
import fs from "fs"
import path from "path"
import { fileURLToPath } from "url"

// Import catalogs
import { generalCatalog } from "./catalogs/general/catalog"
import { codingCatalog } from "./catalogs/coding/catalog"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const distDir = path.resolve(__dirname, "dist")

fs.mkdirSync(distDir, { recursive: true })

const indexText = generalCatalog.index() + "\n\n" + codingCatalog.index()
const fullText = generalCatalog.prompt() + "\n\n" + codingCatalog.prompt()

fs.writeFileSync(path.join(distDir, "catalog-index.md"), indexText)
fs.writeFileSync(path.join(distDir, "catalog-full.md"), fullText)

console.log(`catalog-index.md: ${indexText.length} chars`)
console.log(`catalog-full.md: ${fullText.length} chars`)
