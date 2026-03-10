export const INSTALL_SNIPPET_UNIX =
  "curl -sSL https://stream.dazzle.fm/install.sh | sh";

export const INSTALL_SNIPPET_WINDOWS =
  "irm https://stream.dazzle.fm/install.ps1 | iex";

export const QUICK_START_SNIPPET = `# Authenticate
dazzle login

# Create and activate a stage
dazzle stage create my-stage
dazzle stage activate

# Push content (JS or JSX, hot-swapped via HMR)
dazzle stage script set ./my-overlay.jsx

# Take a screenshot to verify
dazzle stage screenshot -o preview.png

# Go live
dazzle stage broadcast on`;

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
