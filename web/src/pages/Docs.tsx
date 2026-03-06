import { useState } from "react";
import { Copy, Check, ChevronDown, ChevronRight } from "lucide-react";
import { FRAMEWORKS } from "@/components/onboarding/frameworks";
import { MCP_TOOLS } from "@/components/onboarding/mcp-tools";
import { ENDPOINT_GROUPS } from "@/components/onboarding/api-endpoints";

const MCP_URL = `${window.location.origin}/stage/YOUR_UUID/mcp`;

export function Docs() {
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [showScoping, setShowScoping] = useState(false);
  const [expandedTool, setExpandedTool] = useState<string | null>(null);
  const [expandedGroup, setExpandedGroup] = useState<string | null>(null);
  const [expandedEndpoint, setExpandedEndpoint] = useState<string | null>(null);

  async function copy(text: string, id: string) {
    await navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  }

  function CopyBtn({ id, text }: { id: string; text: string }) {
    return (
      <button
        onClick={() => copy(text, id)}
        className="flex items-center gap-1.5 text-xs text-zinc-500 hover:text-emerald-400 transition-colors cursor-pointer"
      >
        {copiedId === id ? (
          <><Check className="h-3.5 w-3.5" />Copied</>
        ) : (
          <><Copy className="h-3.5 w-3.5" />Copy</>
        )}
      </button>
    );
  }

  const claudeJsonSnippet = JSON.stringify(
    { mcpServers: { dazzle: { type: "http", url: MCP_URL, headers: { Authorization: "Bearer ${DAZZLE_API_KEY}" } } } },
    null, 2
  );

  return (
    <div>
      {/* Header */}
      <div className="mb-8">
        <h1
          className="text-3xl tracking-[-0.02em] text-white mb-1"
          style={{ fontFamily: "'DM Serif Display', serif" }}
        >
          Docs
        </h1>
        <p className="text-sm text-zinc-500">
          Connect your agent to Dazzle via MCP.
        </p>
      </div>

      {/* Endpoint format */}
      <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-5 mb-4">
        <p className="text-xs font-medium text-zinc-400 mb-3">MCP stage URL format</p>
        <code className="block text-sm font-mono text-zinc-300 bg-zinc-950/50 rounded-lg px-4 py-2.5 border border-white/[0.06]">
          {window.location.origin}/stage/<span className="text-emerald-400">&lt;uuid&gt;</span>/mcp
        </code>
        <p className="text-xs text-zinc-600 mt-3">
          Each UUID maps to an isolated stage. Use different UUIDs to run separate agents or projects in parallel.
        </p>
      </div>

      {/* Env var */}
      <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-5 mb-6">
        <p className="text-xs font-medium text-zinc-400 mb-2">Set your API key as an environment variable</p>
        <div className="flex items-center gap-2">
          <code className="flex-1 text-sm font-mono text-zinc-300 bg-zinc-950/50 rounded-lg px-4 py-2.5 border border-white/[0.06]">
            export DAZZLE_API_KEY=bstr_...
          </code>
          <button
            onClick={() => copy("export DAZZLE_API_KEY=", "env")}
            className="text-zinc-400 hover:text-emerald-400 hover:bg-emerald-500/10 p-2 rounded-md transition-colors cursor-pointer shrink-0"
          >
            {copiedId === "env" ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
          </button>
        </div>
        <p className="text-xs text-zinc-600 mt-2">
          Add to your <code className="text-zinc-500">.bashrc</code>, <code className="text-zinc-500">.zshrc</code>, or project <code className="text-zinc-500">.env</code>. Never hardcode keys in config files.
        </p>
      </div>

      {/* Framework snippets */}
      <h2
        className="text-xl tracking-[-0.02em] text-white mb-1"
        style={{ fontFamily: "'DM Serif Display', serif" }}
      >
        Client setup
      </h2>
      <p className="text-sm text-zinc-500 mb-4">
        Copy the snippet for your framework. Replace <code className="text-zinc-400 bg-white/[0.04] px-1 py-0.5 rounded text-xs">YOUR_UUID</code> with a fixed UUID per project.
      </p>

      <div className="flex flex-col gap-3 mb-4">
        {FRAMEWORKS.map((fw) => {
          const snippet = fw.getSnippet(MCP_URL, "");
          return (
            <div key={fw.id} className="rounded-xl border border-white/[0.06] bg-white/[0.02] overflow-hidden">
              <div className="flex items-center justify-between px-4 py-2.5 border-b border-white/[0.06]">
                <div className="flex items-center gap-3">
                  <span className="text-sm font-medium text-zinc-300">{fw.name}</span>
                  <span className="text-xs text-zinc-600">{fw.language}</span>
                </div>
                <CopyBtn id={fw.id} text={snippet} />
              </div>
              <pre className="p-4 text-sm font-mono text-zinc-300 overflow-x-auto leading-relaxed whitespace-pre-wrap">
                {snippet}
              </pre>
            </div>
          );
        })}

        {/* Claude Code JSON config (additional) */}
        <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] overflow-hidden">
          <div className="flex items-center justify-between px-4 py-2.5 border-b border-white/[0.06]">
            <div className="flex items-center gap-3">
              <span className="text-sm font-medium text-zinc-300">Claude Code</span>
              <span className="text-xs text-zinc-600">.mcp.json</span>
            </div>
            <CopyBtn id="claude-json" text={claudeJsonSnippet} />
          </div>
          <pre className="p-4 text-sm font-mono text-zinc-300 overflow-x-auto leading-relaxed">
            {claudeJsonSnippet}
          </pre>
        </div>
      </div>

      {/* Scoping section */}
      <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] overflow-hidden">
        <button
          onClick={() => setShowScoping(!showScoping)}
          className="w-full flex items-center gap-2 px-5 py-4 text-left cursor-pointer hover:bg-white/[0.02] transition-colors"
        >
          {showScoping ? (
            <ChevronDown className="h-4 w-4 text-zinc-500 shrink-0" />
          ) : (
            <ChevronRight className="h-4 w-4 text-zinc-500 shrink-0" />
          )}
          <div>
            <p className="text-sm font-medium text-zinc-300">Per-project and multi-agent setups</p>
            <p className="text-xs text-zinc-600">How to scope stages to different projects or agents</p>
          </div>
        </button>
        {showScoping && (
          <div className="px-5 pb-5 pt-0">
            <div className="border-t border-white/[0.06] pt-4 flex flex-col gap-4">
              <div>
                <p className="text-xs font-medium text-zinc-400 mb-1.5">One UUID per project</p>
                <p className="text-xs text-zinc-500 leading-relaxed">
                  The UUID in the MCP URL determines which environment your agent connects to.
                  Use a consistent UUID per project so the same agent always reconnects to the same workspace.
                  Stages persist until you explicitly stop them.
                </p>
              </div>
              <div>
                <p className="text-xs font-medium text-zinc-400 mb-1.5">Multiple agents in parallel</p>
                <p className="text-xs text-zinc-500 leading-relaxed">
                  Each UUID gets its own isolated environment. Run multiple agents simultaneously by
                  giving each a different UUID. For example, scope by project:
                </p>
                <pre className="mt-2 text-xs font-mono text-zinc-400 bg-zinc-950/50 rounded-lg px-4 py-2.5 border border-white/[0.06] overflow-x-auto leading-relaxed">{`# Project A — always uses the same environment
/stage/a1b2c3d4-e5f6-7890-abcd-ef1234567890/mcp

# Project B — separate stage
/stage/f9e8d7c6-b5a4-3210-fedc-ba0987654321/mcp`}</pre>
              </div>
              <div>
                <p className="text-xs font-medium text-zinc-400 mb-1.5">Project-scoped config</p>
                <p className="text-xs text-zinc-500 leading-relaxed">
                  For Claude Code, add the MCP config to your project's <code className="text-zinc-400 bg-white/[0.04] px-1 py-0.5 rounded">.mcp.json</code> so
                  each repo gets its own Dazzle environment. The UUID stays fixed per project, and the environment
                  spins up automatically when the agent first connects.
                </p>
              </div>
              <div>
                <p className="text-xs font-medium text-zinc-400 mb-1.5">Shared API key</p>
                <p className="text-xs text-zinc-500 leading-relaxed">
                  A single API key works across all your stages. Or create separate keys per project or
                  team member for easier auditing — revoke one without affecting others.
                </p>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* MCP Tools Reference */}
      <h2
        className="text-xl tracking-[-0.02em] text-white mb-1 mt-8"
        style={{ fontFamily: "'DM Serif Display', serif" }}
      >
        MCP Tools
      </h2>
      <p className="text-sm text-zinc-500 mb-4">
        Tools available to your agent via the MCP connection. Click to expand.
      </p>

      <div className="flex flex-col gap-2">
        {MCP_TOOLS.map((tool) => {
          const isExpanded = expandedTool === tool.id;
          return (
            <div
              key={tool.id}
              className="rounded-xl border border-white/[0.06] bg-white/[0.02] overflow-hidden"
            >
              <button
                onClick={() => setExpandedTool(isExpanded ? null : tool.id)}
                className="w-full flex items-center gap-3 px-5 py-3.5 text-left cursor-pointer hover:bg-white/[0.02] transition-colors"
              >
                {isExpanded ? (
                  <ChevronDown className="h-4 w-4 text-zinc-500 shrink-0" />
                ) : (
                  <ChevronRight className="h-4 w-4 text-zinc-500 shrink-0" />
                )}
                <code className="text-sm font-mono text-emerald-400">{tool.name}</code>
                {tool.comingSoon && (
                  <span className="shrink-0 rounded-full bg-amber-500/10 px-2 py-0.5 text-[10px] font-medium text-amber-400 border border-amber-500/20">
                    Coming Soon
                  </span>
                )}
                <span className="text-xs text-zinc-500 truncate">{tool.description}</span>
              </button>

              {isExpanded && (
                <div className="px-5 pb-5 pt-0">
                  <div className="border-t border-white/[0.06] pt-4 flex flex-col gap-4">
                    <p className="text-sm text-zinc-400 leading-relaxed">{tool.description}</p>

                    {tool.params.length > 0 && (
                      <div>
                        <p className="text-xs font-medium text-zinc-400 mb-2">Parameters</p>
                        <div className="rounded-lg border border-white/[0.06] overflow-hidden">
                          <table className="w-full text-xs">
                            <thead>
                              <tr className="bg-white/[0.02] text-zinc-500">
                                <th className="text-left px-3 py-2 font-medium">Name</th>
                                <th className="text-left px-3 py-2 font-medium">Type</th>
                                <th className="text-left px-3 py-2 font-medium">Required</th>
                                <th className="text-left px-3 py-2 font-medium">Description</th>
                              </tr>
                            </thead>
                            <tbody>
                              {tool.params.map((p) => (
                                <tr key={p.name} className="border-t border-white/[0.06]">
                                  <td className="px-3 py-2 font-mono text-emerald-400">{p.name}</td>
                                  <td className="px-3 py-2 font-mono text-zinc-400">{p.type}</td>
                                  <td className="px-3 py-2 text-zinc-500">{p.required ? "Yes" : "No"}</td>
                                  <td className="px-3 py-2 text-zinc-400">{p.description}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    )}

                    <div>
                      <div className="flex items-center justify-between mb-2">
                        <p className="text-xs font-medium text-zinc-400">Example</p>
                        <CopyBtn id={`tool-${tool.id}`} text={tool.example} />
                      </div>
                      <pre className="text-sm font-mono text-zinc-300 bg-zinc-950/50 rounded-lg px-4 py-3 border border-white/[0.06] overflow-x-auto leading-relaxed">
                        {tool.example}
                      </pre>
                    </div>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* API Endpoints Reference */}
      <h2
        className="text-xl tracking-[-0.02em] text-white mb-1 mt-8"
        style={{ fontFamily: "'DM Serif Display', serif" }}
      >
        API Endpoints
      </h2>
      <p className="text-sm text-zinc-500 mb-2">
        All ConnectRPC services use <code className="text-zinc-400 bg-white/[0.04] px-1 py-0.5 rounded text-xs">POST</code> with
        path <code className="text-zinc-400 bg-white/[0.04] px-1 py-0.5 rounded text-xs">{window.location.origin}/api.v1.&lt;Service&gt;/&lt;Method&gt;</code>.
        Authenticate with <code className="text-zinc-400 bg-white/[0.04] px-1 py-0.5 rounded text-xs">Authorization: Bearer &lt;token&gt;</code>.
      </p>
      <p className="text-xs text-zinc-600 mb-4">
        Supports Connect, gRPC, and gRPC-Web protocols with Protobuf and JSON codecs. CORS is enabled for all origins.
      </p>

      <div className="flex flex-col gap-3">
        {ENDPOINT_GROUPS.map((group) => {
          const isGroupExpanded = expandedGroup === group.id;
          return (
            <div
              key={group.id}
              className="rounded-xl border border-white/[0.06] bg-white/[0.02] overflow-hidden"
            >
              <button
                onClick={() => setExpandedGroup(isGroupExpanded ? null : group.id)}
                className="w-full flex items-center gap-2 px-5 py-4 text-left cursor-pointer hover:bg-white/[0.02] transition-colors"
              >
                {isGroupExpanded ? (
                  <ChevronDown className="h-4 w-4 text-zinc-500 shrink-0" />
                ) : (
                  <ChevronRight className="h-4 w-4 text-zinc-500 shrink-0" />
                )}
                <div>
                  <p className="text-sm font-medium text-zinc-300">{group.name}</p>
                  <p className="text-xs text-zinc-600">{group.description}</p>
                </div>
              </button>

              {isGroupExpanded && (
                <div className="px-5 pb-4 pt-0">
                  <div className="border-t border-white/[0.06] pt-3 flex flex-col gap-2">
                    {group.endpoints.map((ep) => {
                      const isEpExpanded = expandedEndpoint === ep.id;
                      return (
                        <div
                          key={ep.id}
                          className="rounded-lg border border-white/[0.06] bg-white/[0.01] overflow-hidden"
                        >
                          <button
                            onClick={() => setExpandedEndpoint(isEpExpanded ? null : ep.id)}
                            className="w-full flex items-center gap-3 px-4 py-3 text-left cursor-pointer hover:bg-white/[0.02] transition-colors"
                          >
                            {isEpExpanded ? (
                              <ChevronDown className="h-3.5 w-3.5 text-zinc-600 shrink-0" />
                            ) : (
                              <ChevronRight className="h-3.5 w-3.5 text-zinc-600 shrink-0" />
                            )}
                            <span className="text-xs font-mono font-medium text-amber-400/80 shrink-0">{ep.method}</span>
                            <code className="text-xs font-mono text-zinc-300 truncate">{ep.path}</code>
                          </button>

                          {isEpExpanded && (
                            <div className="px-4 pb-4 pt-0">
                              <div className="border-t border-white/[0.06] pt-3 flex flex-col gap-3">
                                <p className="text-xs text-zinc-400 leading-relaxed">{ep.description}</p>

                                <div className="flex gap-4">
                                  <div>
                                    <span className="text-xs text-zinc-600">Auth: </span>
                                    <span className="text-xs text-zinc-400">{ep.auth}</span>
                                  </div>
                                </div>

                                {ep.params && ep.params.length > 0 && (
                                  <div>
                                    <p className="text-xs font-medium text-zinc-400 mb-2">Request fields</p>
                                    <div className="rounded-lg border border-white/[0.06] overflow-hidden">
                                      <table className="w-full text-xs">
                                        <thead>
                                          <tr className="bg-white/[0.02] text-zinc-500">
                                            <th className="text-left px-3 py-1.5 font-medium">Name</th>
                                            <th className="text-left px-3 py-1.5 font-medium">Type</th>
                                            <th className="text-left px-3 py-1.5 font-medium">Required</th>
                                            <th className="text-left px-3 py-1.5 font-medium">Description</th>
                                          </tr>
                                        </thead>
                                        <tbody>
                                          {ep.params.map((p) => (
                                            <tr key={p.name} className="border-t border-white/[0.06]">
                                              <td className="px-3 py-1.5 font-mono text-emerald-400">{p.name}</td>
                                              <td className="px-3 py-1.5 font-mono text-zinc-400">{p.type}</td>
                                              <td className="px-3 py-1.5 text-zinc-500">{p.required ? "Yes" : "No"}</td>
                                              <td className="px-3 py-1.5 text-zinc-400">{p.description}</td>
                                            </tr>
                                          ))}
                                        </tbody>
                                      </table>
                                    </div>
                                  </div>
                                )}

                                {ep.notes && (
                                  <p className="text-xs text-zinc-500 leading-relaxed italic">{ep.notes}</p>
                                )}

                                {ep.responseExample && (
                                  <div>
                                    <div className="flex items-center justify-between mb-1.5">
                                      <p className="text-xs font-medium text-zinc-400">Response</p>
                                      <CopyBtn id={`ep-${ep.id}`} text={ep.responseExample} />
                                    </div>
                                    <pre className="text-xs font-mono text-zinc-400 bg-zinc-950/50 rounded-lg px-4 py-2.5 border border-white/[0.06] overflow-x-auto leading-relaxed">
                                      {ep.responseExample}
                                    </pre>
                                  </div>
                                )}
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
