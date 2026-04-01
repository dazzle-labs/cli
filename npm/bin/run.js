#!/usr/bin/env node

const { execFileSync } = require("child_process");

const PLATFORMS = {
  "darwin-arm64": "@dazzle-labs/cli-darwin-arm64",
  "darwin-x64": "@dazzle-labs/cli-darwin-x64",
  "linux-x64": "@dazzle-labs/cli-linux-x64",
  "linux-arm64": "@dazzle-labs/cli-linux-arm64",
  "win32-x64": "@dazzle-labs/cli-win32-x64",
  "win32-arm64": "@dazzle-labs/cli-win32-arm64",
};

const key = `${process.platform}-${process.arch}`;
const pkg = PLATFORMS[key];
if (!pkg) {
  console.error(`Unsupported platform: ${key}`);
  process.exit(1);
}

const ext = process.platform === "win32" ? ".exe" : "";
let binPath;
try {
  binPath = require.resolve(`${pkg}/bin/dazzle${ext}`);
} catch {
  console.error(
    `${pkg} is not installed. Make sure optionalDependencies are not disabled.\n` +
      `Install with: npm install ${pkg}`
  );
  process.exit(1);
}

try {
  execFileSync(binPath, process.argv.slice(2), { stdio: "inherit" });
} catch (e) {
  process.exit(e.status ?? 1);
}
