$ErrorActionPreference = "Stop"

$repo = "dazzle-labs/cli"
$installDir = if ($env:INSTALL_DIR) { $env:INSTALL_DIR } else { Join-Path $env:LOCALAPPDATA "dazzle" }

# Detect arch
$arch = switch ([System.Runtime.InteropServices.RuntimeInformation]::OSArchitecture) {
    "X64"   { "x86_64" }
    "Arm64" { "arm64" }
    default { Write-Error "Unsupported architecture: $_"; exit 1 }
}

# Get latest release tag
$release = Invoke-RestMethod "https://api.github.com/repos/$repo/releases/latest"
$tag = $release.tag_name
if (-not $tag) {
    Write-Error "Failed to fetch latest release"
    exit 1
}

$url = "https://github.com/$repo/releases/download/$tag/dazzle_Windows_$arch.exe"

Write-Host "Installing dazzle $tag (Windows/$arch)..."

# Download
New-Item -ItemType Directory -Force -Path $installDir | Out-Null
$dest = Join-Path $installDir "dazzle.exe"
Invoke-WebRequest -Uri $url -OutFile $dest -UseBasicParsing

Write-Host "Installed to $dest"

# Add to PATH if not already there
$userPath = [Environment]::GetEnvironmentVariable("Path", "User")
if ($userPath -notlike "*$installDir*") {
    [Environment]::SetEnvironmentVariable("Path", "$userPath;$installDir", "User")
    $env:Path = "$env:Path;$installDir"
    Write-Host "Added $installDir to your PATH (restart your terminal to pick it up)."
}

Write-Host "Run 'dazzle login' to get started."
