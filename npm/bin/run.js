#!/usr/bin/env node

const { execFileSync, execSync } = require("child_process");
const path = require("path");

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
const binName = `bin/dazzle${ext}`;

function tryResolve() {
  try {
    return require.resolve(`${pkg}/${binName}`);
  } catch {
    return null;
  }
}

let binPath = tryResolve();

if (!binPath) {
  // Platform binary not found — install optionalDependencies into this
  // package's directory. This handles npx/pnpx where optional deps are
  // skipped during ephemeral installs (same pattern as turbo).
  const pkgDir = path.resolve(__dirname, "..");
  const env = { ...process.env, npm_config_global: undefined };
  try {
    execSync(
      "npm install --loglevel=error --prefer-offline --no-audit --progress=false",
      { cwd: pkgDir, stdio: "pipe", env }
    );
  } catch {
    console.error(
      `${pkg} is not installed and could not be installed automatically.\n` +
        `Install with: npm install ${pkg}`
    );
    process.exit(1);
  }

  binPath = tryResolve();
  if (!binPath) {
    console.error(
      `${pkg} is not installed. Make sure optionalDependencies are not disabled.\n` +
        `Install with: npm install ${pkg}`
    );
    process.exit(1);
  }
}

try {
  execFileSync(binPath, process.argv.slice(2), { stdio: "inherit" });
} catch (e) {
  process.exit(e.status ?? 1);
}
