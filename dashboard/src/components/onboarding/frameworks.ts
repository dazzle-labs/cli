export interface Framework {
  id: string;
  name: string;
  language: string;
  description: string;
  getSnippet: (mcpUrl: string, apiKey: string) => string;
}

export const FRAMEWORKS: Framework[] = [
  {
    id: "claude-code",
    name: "Claude Code",
    language: "Shell",
    description: "Anthropic's CLI coding agent",
    getSnippet: (mcpUrl) =>
      `claude mcp add dazzle ${mcpUrl} \\\n  --transport http \\\n  --header "Authorization: Bearer $DAZZLE_API_KEY"`,
  },
  {
    id: "openai-agents",
    name: "OpenAI Agents SDK",
    language: "Python",
    description: "OpenAI's multi-agent framework",
    getSnippet: (mcpUrl) =>
      `import os
from agents.mcp import MCPServerStreamableHTTP

dazzle = MCPServerStreamableHTTP(
    url="${mcpUrl}",
    headers={"Authorization": f"Bearer {os.environ['DAZZLE_API_KEY']}"},
)

agent = Agent(
    name="my-agent",
    mcp_servers=[dazzle],
)`,
  },
  {
    id: "openclaw",
    name: "OpenClaw",
    language: "YAML",
    description: "Declarative agent orchestration",
    getSnippet: (mcpUrl) =>
      `mcp_servers:
  dazzle:
    url: "${mcpUrl}"
    headers:
      Authorization: "Bearer \${DAZZLE_API_KEY}"`,
  },
  {
    id: "crewai",
    name: "CrewAI",
    language: "Python",
    description: "Role-based agent collaboration",
    getSnippet: (mcpUrl) =>
      `import os
from crewai.tools import MCPServerAdapter

dazzle = MCPServerAdapter(
    server_url="${mcpUrl}",
    headers={"Authorization": f"Bearer {os.environ['DAZZLE_API_KEY']}"},
)

agent = Agent(
    role="My Agent",
    tools=[dazzle],
)`,
  },
  {
    id: "langgraph",
    name: "LangGraph",
    language: "Python",
    description: "LangChain's stateful agent graphs",
    getSnippet: (mcpUrl) =>
      `import os
from langchain_mcp_adapters.client import MCPClient

client = MCPClient(
    transport="streamable_http",
    url="${mcpUrl}",
    headers={"Authorization": f"Bearer {os.environ['DAZZLE_API_KEY']}"},
)

tools = await client.get_tools()`,
  },
  {
    id: "autogen",
    name: "AutoGen",
    language: "Python",
    description: "Microsoft's multi-agent framework",
    getSnippet: (mcpUrl) =>
      `import os
from autogen_ext.tools.mcp import McpWorkbench

workbench = McpWorkbench(
    server_url="${mcpUrl}",
    headers={"Authorization": f"Bearer {os.environ['DAZZLE_API_KEY']}"},
)

agent = AssistantAgent(
    name="my_agent",
    tools=await workbench.get_tools(),
)`,
  },
];
