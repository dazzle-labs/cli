/** A single CLI command entry used throughout the frontend. */
export interface CLICommand {
  /** Raw command path validated by CI, e.g. `"stage sync"`. */
  subcommand: string;
  /** `dazzle` + subcommand, e.g. `"dazzle stage sync"`. Use when appending context-specific args like `-s <stage>`. */
  base: string;
  /** Complete copy-paste example with default args, e.g. `"dazzle stage sync ./my-app"`. Use in docs/onboarding where no customization is needed. */
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
  stageSync:          cmd("stage sync", "./my-app"),
  stageSyncWatch:     cmd("stage sync", "./my-app --watch"),
  stageScreenshot:    cmd("stage screenshot"),
  stageScreenshotOut: cmd("stage screenshot", "-o preview.png"),
  stageBroadcastOn:   cmd("stage broadcast on"),
  stageBroadcastOff:  cmd("stage broadcast off"),
  stageStatus:        cmd("stage status"),
  stageStats:         cmd("stage stats"),
  stageRefresh:       cmd("stage refresh"),
  stageEventEmit:     cmd("stage event emit", "score '{\"points\": 42}'"),
  stageLogs:          cmd("stage logs"),
  destAdd:            cmd("destination add"),
  destList:           cmd("destination list"),
  help:               cmd("--help"),
  stageHelp:          cmd("stage --help"),
  stageSyncHelp:      cmd("stage sync --help"),
  broadcastHelp:      cmd("stage broadcast --help"),
  version:            cmd("version"),
  guide:              cmd("guide"),
};

// Unique subcommand paths -- extracted by CI smoke test
export const CLI_SUBCOMMANDS = [...new Set(
  Object.values(cli).map(c => c.subcommand)
)];
