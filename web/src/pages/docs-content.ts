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

export const QUICK_START_STEPS = [
  { n: 1, label: "Authenticate", cmd: cli.login.full },
  { n: 2, label: "Create a stage", cmd: cli.stageCreate.full },
  { n: 3, label: "Push content", cmd: cli.stageSync.full },
  { n: 4, label: "Screenshot to verify", cmd: cli.stageScreenshot.full },
  { n: 5, label: "Go live", cmd: cli.stageBroadcastOn.full },
];

export const MULTI_STAGE_SNIPPET = `# List all stages
${cli.stageList.full}

# Target a specific stage
${cli.stageUp.base} -s my-stage
${cli.stageSync.base} ./my-app -s my-stage`;
