import { cli } from "@/lib/cli-commands";

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
curl -sSL https://dazzle.fm/install.sh | sh

# Authenticate
${cli.login.full}

# Create and start a stage
${cli.stageCreate.full}
${cli.stageUp.full}

# Push content (sync your app directory, hot-reloads via HMR)
${cli.stageSync.full}

# Take a screenshot to verify
${cli.stageScreenshotOut.full}

# Check status
${cli.stageStatus.full}`,
  },
  {
    id: "openai-agents",
    name: "OpenAI Agents SDK",
    language: "Shell",
    description: "OpenAI's multi-agent framework",
    getSnippet: () =>
      `# Install the Dazzle CLI
curl -sSL https://dazzle.fm/install.sh | sh

# Authenticate and create a stage
${cli.login.full}
${cli.stageCreate.full}
${cli.stageUp.full}

# Push content (streaming starts automatically)
${cli.stageSync.full}`,
  },
  {
    id: "crewai",
    name: "CrewAI",
    language: "Shell",
    description: "Role-based agent collaboration",
    getSnippet: () =>
      `# Install the Dazzle CLI
curl -sSL https://dazzle.fm/install.sh | sh

# Authenticate and create a stage
${cli.login.full}
${cli.stageCreate.full}
${cli.stageUp.full}

# Push content (streaming starts automatically)
${cli.stageSync.full}`,
  },
  {
    id: "langgraph",
    name: "LangGraph",
    language: "Shell",
    description: "LangChain's stateful agent graphs",
    getSnippet: () =>
      `# Install the Dazzle CLI
curl -sSL https://dazzle.fm/install.sh | sh

# Authenticate and create a stage
${cli.login.full}
${cli.stageCreate.full}
${cli.stageUp.full}

# Push content (streaming starts automatically)
${cli.stageSync.full}`,
  },
  {
    id: "autogen",
    name: "AutoGen",
    language: "Shell",
    description: "Microsoft's multi-agent framework",
    getSnippet: () =>
      `# Install the Dazzle CLI
curl -sSL https://dazzle.fm/install.sh | sh

# Authenticate and create a stage
${cli.login.full}
${cli.stageCreate.full}
${cli.stageUp.full}

# Push content (streaming starts automatically)
${cli.stageSync.full}`,
  },
];
