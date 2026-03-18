import { cli } from "@/lib/cli-commands";

export const INSTALL_SNIPPET_UNIX =
  "curl -sSL https://stream.dazzle.fm/install.sh | sh";

export const INSTALL_SNIPPET_WINDOWS =
  "irm https://stream.dazzle.fm/install.ps1 | iex";

export const INSTALL_SNIPPET_GO =
  "go install github.com/dazzle-labs/cli/cmd/dazzle@latest";

export type InstallTab = "unix" | "windows" | "go";

export const INSTALL_TABS: { id: InstallTab; label: string; cmd: string }[] = [
  { id: "unix", label: "macOS / Linux", cmd: INSTALL_SNIPPET_UNIX },
  { id: "windows", label: "Windows", cmd: INSTALL_SNIPPET_WINDOWS },
  { id: "go", label: "Go", cmd: INSTALL_SNIPPET_GO },
];

export const BOOTSTRAP_SNIPPET = `mkdir my-stage && cat > my-stage/index.html << 'EOF'
<!DOCTYPE html>
<html>
<head>
  <style>
    * { margin: 0; box-sizing: border-box; }
    body { width: 100vw; height: 100vh; overflow: hidden;
           display: grid; place-items: center; background: #000; }
    h1 { color: #fff; font: bold 4rem system-ui; }
  </style>
</head>
<body><h1>Hello, Dazzle</h1></body>
</html>
EOF`;

export const QUICK_START_STEPS: { n: number; label: string; cmd?: string; code?: string }[] = [
  { n: 1, label: "Authenticate", cmd: cli.login.full },
  { n: 2, label: "Create a stage", cmd: cli.stageCreate.full },
  { n: 3, label: "Create content", code: BOOTSTRAP_SNIPPET },
  { n: 4, label: "Push content", cmd: cli.stageSync.full },
  { n: 5, label: "Screenshot to verify", cmd: cli.stageScreenshot.full },
  { n: 6, label: "Go live", cmd: cli.stageBroadcastOn.full },
];

export const MULTI_STAGE_SNIPPET = `# List all stages
${cli.stageList.full}

# Target a specific stage
${cli.stageUp.base} -s my-stage
${cli.stageSync.base} ./my-stage -s my-stage`;
