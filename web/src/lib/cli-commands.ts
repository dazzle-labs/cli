/** A single CLI command entry used throughout the frontend. */
export interface CLICommand {
  /** Raw command path validated by CI, e.g. `"stage sync"`. */
  subcommand: string;
  /** `dazzle` + subcommand, e.g. `"dazzle stage sync"`. Use when appending context-specific args like `-s <stage>`. */
  base: string;
  /** Complete copy-paste example with default args, e.g. `"dazzle stage sync ./my-stage"`. Use in docs/onboarding where no customization is needed. */
  full: string;
}

function cmd(subcommand: string, exampleArgs?: string): CLICommand {
  const base = `dazzle ${subcommand}`;
  return {
    subcommand,
    full: exampleArgs ? `${base} ${exampleArgs}` : base,
    base,
  };
}

export const cli: Record<string, CLICommand> = {
  login:              cmd("login"),
  stageCreate:        cmd("stage create", "my-stage"),
  stageUp:            cmd("stage up"),
  stageDown:          cmd("stage down"),
  stageList:          cmd("stage list"),
  stageSync:          cmd("stage sync", "./my-stage"),
  stageSyncWatch:     cmd("stage sync", "./my-stage --watch"),
  stageScreenshot:    cmd("stage screenshot"),
  stageScreenshotOut: cmd("stage screenshot", "-o preview.png"),
  stageStatus:        cmd("stage status"),
  stageStats:         cmd("stage stats"),
  stageRefresh:       cmd("stage refresh"),
  stageEventEmit:     cmd("stage event emit", "score '{\"points\": 42}'"),
  stageLogs:          cmd("stage logs"),
  destAdd:            cmd("destination add"),
  destList:           cmd("destination list"),
  destAttach:         cmd("destination attach", "my-destination"),
  destDetach:         cmd("destination detach", "my-destination"),
  help:               cmd("--help"),
  stageHelp:          cmd("stage --help"),
  stageSyncHelp:      cmd("stage sync --help"),
  broadcastHelp:      cmd("stage broadcast --help"),  // kept for info/title/category subcommands
  version:            cmd("version"),
  guide:              cmd("guide"),
};

/** Detect if the visitor is on Windows. */
export function isWindows(): boolean {
  return navigator.platform?.startsWith("Win") || /windows/i.test(navigator.userAgent);
}

/** OS-appropriate install command. */
export function installCommand(): string {
  return isWindows()
    ? "irm https://dazzle.fm/install.ps1 | iex"
    : "curl -sSL https://dazzle.fm/install.sh | sh";
}

// Unique subcommand paths -- extracted by CI smoke test
export const CLI_SUBCOMMANDS = [...new Set(
  Object.values(cli).map(c => c.subcommand)
)];
