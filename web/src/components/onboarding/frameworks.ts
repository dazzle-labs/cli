import { cli, installCommand } from "@/lib/cli-commands";

export interface Framework {
  id: string;
  name: string;
  language: string;
  description: string;
  getSnippet: (stageName?: string) => string;
}

export const FRAMEWORKS: Framework[] = [
  {
    id: "claude-code",
    name: "Claude Code",
    language: "Shell",
    description: "Anthropic's CLI coding agent",
    getSnippet: (stageName?: string) => {
      const s = stageName || "my-stage";
      return `# Install the Dazzle CLI
${installCommand()}

# Authenticate
${cli.login.full}

# Start your stage
${cli.stageUp.base} -s "${s}"

# Push content (sync your app directory, hot-reloads via HMR)
${cli.stageSync.base} -s "${s}" ./my-stage

# Take a screenshot to verify
${cli.stageScreenshotOut.base} -s "${s}"

# Check status
${cli.stageStatus.base} -s "${s}"`;
    },
  },
  {
    id: "openai-agents",
    name: "OpenAI Agents SDK",
    language: "Shell",
    description: "OpenAI's multi-agent framework",
    getSnippet: (stageName?: string) => {
      const s = stageName || "my-stage";
      return `# Install the Dazzle CLI
${installCommand()}

# Authenticate
${cli.login.full}

# Start your stage
${cli.stageUp.base} -s "${s}"

# Push content (streaming starts automatically)
${cli.stageSync.base} -s "${s}" ./my-stage`;
    },
  },
  {
    id: "crewai",
    name: "CrewAI",
    language: "Shell",
    description: "Role-based agent collaboration",
    getSnippet: (stageName?: string) => {
      const s = stageName || "my-stage";
      return `# Install the Dazzle CLI
${installCommand()}

# Authenticate
${cli.login.full}

# Start your stage
${cli.stageUp.base} -s "${s}"

# Push content (streaming starts automatically)
${cli.stageSync.base} -s "${s}" ./my-stage`;
    },
  },
  {
    id: "langgraph",
    name: "LangGraph",
    language: "Shell",
    description: "LangChain's stateful agent graphs",
    getSnippet: (stageName?: string) => {
      const s = stageName || "my-stage";
      return `# Install the Dazzle CLI
${installCommand()}

# Authenticate
${cli.login.full}

# Start your stage
${cli.stageUp.base} -s "${s}"

# Push content (streaming starts automatically)
${cli.stageSync.base} -s "${s}" ./my-stage`;
    },
  },
  {
    id: "autogen",
    name: "AutoGen",
    language: "Shell",
    description: "Microsoft's multi-agent framework",
    getSnippet: (stageName?: string) => {
      const s = stageName || "my-stage";
      return `# Install the Dazzle CLI
${installCommand()}

# Authenticate
${cli.login.full}

# Start your stage
${cli.stageUp.base} -s "${s}"

# Push content (streaming starts automatically)
${cli.stageSync.base} -s "${s}" ./my-stage`;
    },
  },
];
