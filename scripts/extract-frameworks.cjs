#!/usr/bin/env node
// Extract framework connection examples from web/src/components/onboarding/frameworks.ts
// Outputs markdown to stdout with one section per framework.
//
// Usage: node scripts/extract-frameworks.js

const fs = require("fs");
const path = require("path");

const src = fs.readFileSync(
  path.join(__dirname, "..", "web/src/components/onboarding/frameworks.ts"),
  "utf8"
);

// Strip TypeScript: remove interface block, export type annotations, type annotations on params
let js = src
  .replace(/export\s+interface\s+\w+\s*\{[^}]*\}/gs, "")
  .replace(/export\s+const/g, "const")
  .replace(/:\s*Framework\[\]/g, "")
  .replace(/:\s*Framework/g, "")
  .replace(/getSnippet:\s*\(([\w,\s]*?)\)\s*=>/g, (_, params) => {
    // Strip type annotations from arrow params: (mcpUrl: string, apiKey: string) => ...
    const cleaned = params
      .split(",")
      .map((p) => p.replace(/:\s*\w+/, "").trim())
      .join(", ");
    return `getSnippet: (${cleaned}) =>`;
  });

// Evaluate to get the array
let FRAMEWORKS;
try {
  FRAMEWORKS = new Function(js + "\nreturn FRAMEWORKS;")();
} catch (e) {
  process.stderr.write("ERROR: Failed to evaluate frameworks.ts: " + e.message + "\n");
  process.exit(1);
}

if (!Array.isArray(FRAMEWORKS) || FRAMEWORKS.length === 0) {
  process.stderr.write("ERROR: No frameworks found\n");
  process.exit(1);
}

const PLACEHOLDER_URL = "https://stream.dazzle.fm/stage/<stage-uuid>/mcp";

for (const fw of FRAMEWORKS) {
  const snippet = fw.getSnippet(PLACEHOLDER_URL, "");
  console.log(`**${fw.name} (${fw.language}):**`);
  console.log("```" + fw.language.toLowerCase());
  console.log(snippet);
  console.log("```");
  console.log();
}
