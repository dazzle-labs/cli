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

export const QUICK_START_STEPS = [
  { n: 1, label: "Authenticate", cmd: "dazzle login" },
  { n: 2, label: "Create a stage", cmd: "dazzle stage create my-stage" },
  { n: 3, label: "Push content", cmd: "dazzle stage script set ./app.jsx" },
  { n: 4, label: "Screenshot to verify", cmd: "dazzle stage screenshot" },
  { n: 5, label: "Go live", cmd: "dazzle stage broadcast on" },
];

export const MULTI_STAGE_SNIPPET = `# List all stages
dazzle stage list

# Target a specific stage
dazzle stage activate -s my-stage
dazzle stage script set app.jsx -s my-stage

# Set a default stage for all commands
dazzle stage default my-stage`;
