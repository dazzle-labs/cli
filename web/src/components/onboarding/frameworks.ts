export interface Framework {
  id: string;
  name: string;
  language: string;
  description: string;
  getSnippet: () => string;
}

export const FRAMEWORKS: Framework[] = [
  {
    id: "claude-code",
    name: "Claude Code",
    language: "Shell",
    description: "Anthropic's CLI coding agent",
    getSnippet: () =>
      `# Install the Dazzle CLI
curl -sSL https://stream.dazzle.fm/install.sh | sh

# Authenticate
dazzle login

# Create and activate a stage
dazzle stage create my-stage
dazzle stage activate

# Push content (JS or JSX, hot-swapped via HMR)
dazzle stage script set ./my-overlay.jsx

# Take a screenshot to verify
dazzle stage screenshot -o preview.png

# Go live
dazzle stage broadcast on`,
  },
  {
    id: "openai-agents",
    name: "OpenAI Agents SDK",
    language: "Shell",
    description: "OpenAI's multi-agent framework",
    getSnippet: () =>
      `# Install the Dazzle CLI
curl -sSL https://stream.dazzle.fm/install.sh | sh

# Authenticate and create a stage
dazzle login
dazzle stage create my-stage
dazzle stage activate

# Push content and stream
dazzle stage script set app.jsx
dazzle stage broadcast on`,
  },
  {
    id: "crewai",
    name: "CrewAI",
    language: "Shell",
    description: "Role-based agent collaboration",
    getSnippet: () =>
      `# Install the Dazzle CLI
curl -sSL https://stream.dazzle.fm/install.sh | sh

# Authenticate and create a stage
dazzle login
dazzle stage create my-stage
dazzle stage activate

# Push content and stream
dazzle stage script set app.jsx
dazzle stage broadcast on`,
  },
  {
    id: "langgraph",
    name: "LangGraph",
    language: "Shell",
    description: "LangChain's stateful agent graphs",
    getSnippet: () =>
      `# Install the Dazzle CLI
curl -sSL https://stream.dazzle.fm/install.sh | sh

# Authenticate and create a stage
dazzle login
dazzle stage create my-stage
dazzle stage activate

# Push content and stream
dazzle stage script set app.jsx
dazzle stage broadcast on`,
  },
  {
    id: "autogen",
    name: "AutoGen",
    language: "Shell",
    description: "Microsoft's multi-agent framework",
    getSnippet: () =>
      `# Install the Dazzle CLI
curl -sSL https://stream.dazzle.fm/install.sh | sh

# Authenticate and create a stage
dazzle login
dazzle stage create my-stage
dazzle stage activate

# Push content and stream
dazzle stage script set app.jsx
dazzle stage broadcast on`,
  },
];
