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
dazzle s new my-stage
dazzle s up

# Push content (JS or JSX, hot-swapped via HMR)
dazzle s sc set ./my-overlay.jsx

# Take a screenshot to verify
dazzle s ss -o preview.png

# Go live
dazzle s bc on`,
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
dazzle s new my-stage
dazzle s up

# Push content and stream
dazzle s sc set app.jsx
dazzle s bc on`,
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
dazzle s new my-stage
dazzle s up

# Push content and stream
dazzle s sc set app.jsx
dazzle s bc on`,
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
dazzle s new my-stage
dazzle s up

# Push content and stream
dazzle s sc set app.jsx
dazzle s bc on`,
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
dazzle s new my-stage
dazzle s up

# Push content and stream
dazzle s sc set app.jsx
dazzle s bc on`,
  },
];
