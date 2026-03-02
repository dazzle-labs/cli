import { useEffect, useState } from "react";
import { timestampDate } from "@bufbuild/protobuf/wkt";
import { apiKeyClient } from "../client.js";
import type { ApiKey } from "../gen/api/v1/apikey_pb.js";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Key, Trash2, Copy, Check, ChevronDown, ChevronRight } from "lucide-react";

export function ApiKeys() {
  const [keys, setKeys] = useState<ApiKey[]>([]);
  const [loading, setLoading] = useState(true);
  const [name, setName] = useState("");
  const [newSecret, setNewSecret] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [copiedExample, setCopiedExample] = useState<string | null>(null);
  const [showScoping, setShowScoping] = useState(false);

  async function refresh() {
    const resp = await apiKeyClient.listApiKeys({});
    setKeys(resp.keys);
    setLoading(false);
  }

  useEffect(() => {
    refresh();
  }, []);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    const resp = await apiKeyClient.createApiKey({ name: name.trim() });
    setNewSecret(resp.secret);
    setName("");
    await refresh();
  }

  async function handleDelete(id: string) {
    await apiKeyClient.deleteApiKey({ id });
    await refresh();
  }

  async function handleCopy() {
    if (!newSecret) return;
    await navigator.clipboard.writeText(newSecret);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  async function copyExample(text: string, id: string) {
    await navigator.clipboard.writeText(text);
    setCopiedExample(id);
    setTimeout(() => setCopiedExample(null), 2000);
  }

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-zinc-500 text-sm pt-12">
        <div className="h-4 w-4 border-2 border-zinc-600 border-t-emerald-400 rounded-full animate-spin" />
        Loading API keys...
      </div>
    );
  }

  return (
    <div>
      {/* Header */}
      <div className="mb-8">
        <h1
          className="text-3xl tracking-[-0.02em] text-white mb-1"
          style={{ fontFamily: "'DM Serif Display', serif" }}
        >
          API Keys
        </h1>
        <p className="text-sm text-zinc-500">
          Keys for agent and MCP authentication. The full key is shown only once.
        </p>
      </div>

      {/* Create form */}
      <form onSubmit={handleCreate} className="flex gap-3 mb-8">
        <Input
          type="text"
          placeholder="Key name (e.g. my-agent)"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="max-w-xs"
        />
        <Button type="submit" className="bg-emerald-500 text-zinc-950 hover:bg-emerald-400 font-semibold">
          Create Key
        </Button>
      </form>

      {/* New key reveal */}
      {newSecret && (
        <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/[0.05] p-5 mb-8">
          <p className="text-sm font-medium text-emerald-400 mb-3">New API key created — copy it now:</p>
          <div className="flex items-center gap-2">
            <pre className="flex-1 font-mono text-sm text-zinc-200 bg-zinc-950/50 rounded-lg px-4 py-2.5 break-all border border-white/[0.06]">
              {newSecret}
            </pre>
            <Button
              variant="ghost"
              size="sm"
              onClick={handleCopy}
              className="text-zinc-400 hover:text-emerald-400 hover:bg-emerald-500/10 shrink-0"
            >
              {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
            </Button>
          </div>
          <button
            onClick={() => setNewSecret(null)}
            className="text-xs text-zinc-600 hover:text-zinc-400 mt-3 transition-colors cursor-pointer"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Keys table */}
      {keys.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-24 text-center">
          <div className="h-16 w-16 rounded-2xl bg-white/[0.03] border border-white/[0.06] flex items-center justify-center mb-5">
            <Key className="h-7 w-7 text-zinc-600" />
          </div>
          <p className="text-zinc-400 text-sm mb-1">No API keys yet</p>
          <p className="text-zinc-600 text-xs">Create one to authenticate your agents.</p>
        </div>
      ) : (
        <div className="rounded-xl border border-white/[0.06] overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-white/[0.06]">
                <th className="text-left py-3 px-4 text-xs font-medium text-zinc-500 uppercase tracking-wider">Name</th>
                <th className="text-left py-3 px-4 text-xs font-medium text-zinc-500 uppercase tracking-wider">Prefix</th>
                <th className="text-left py-3 px-4 text-xs font-medium text-zinc-500 uppercase tracking-wider">Created</th>
                <th className="text-left py-3 px-4 text-xs font-medium text-zinc-500 uppercase tracking-wider">Last Used</th>
                <th className="py-3 px-4"></th>
              </tr>
            </thead>
            <tbody>
              {keys.map((k) => (
                <tr key={k.id} className="border-b border-white/[0.04] last:border-0 hover:bg-white/[0.02] transition-colors">
                  <td className="py-3 px-4 text-zinc-300">{k.name}</td>
                  <td className="py-3 px-4">
                    <code className="font-mono text-xs text-zinc-400 bg-white/[0.04] px-2 py-0.5 rounded">
                      {k.prefix}
                    </code>
                  </td>
                  <td className="py-3 px-4 text-zinc-500">
                    {k.createdAt ? timestampDate(k.createdAt).toLocaleDateString() : ""}
                  </td>
                  <td className="py-3 px-4 text-zinc-500">
                    {k.lastUsedAt ? timestampDate(k.lastUsedAt).toLocaleDateString() : "Never"}
                  </td>
                  <td className="py-3 px-4 text-right">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-zinc-500 hover:text-red-400 hover:bg-red-500/10"
                      onClick={() => handleDelete(k.id)}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* MCP Setup Guide */}
      <div className="mt-12 mb-4">
        <h2
          className="text-xl tracking-[-0.02em] text-white mb-1"
          style={{ fontFamily: "'DM Serif Display', serif" }}
        >
          MCP Setup
        </h2>
        <p className="text-sm text-zinc-500 mb-6">
          Use an API key to authenticate MCP connections from any agent framework.
        </p>

        {/* URL structure */}
        <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-5 mb-4">
          <p className="text-xs font-medium text-zinc-400 mb-3">MCP endpoint format</p>
          <code className="block text-sm font-mono text-zinc-300 bg-zinc-950/50 rounded-lg px-4 py-2.5 border border-white/[0.06]">
            {window.location.origin}/mcp/<span className="text-emerald-400">&lt;agent-uuid&gt;</span>
          </code>
          <p className="text-xs text-zinc-600 mt-3">
            Each UUID maps to an isolated streaming environment. Use different UUIDs to run separate agents or projects in parallel.
          </p>
        </div>

        {/* Claude Code example */}
        <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] overflow-hidden mb-4">
          <div className="flex items-center justify-between px-4 py-2.5 border-b border-white/[0.06]">
            <span className="text-xs font-medium text-zinc-500">Claude Code — CLI</span>
            <button
              onClick={() => copyExample(
                `claude mcp add --transport http -H "Authorization: Bearer $DAZZLE_API_KEY" dazzle ${window.location.origin}/mcp/YOUR_UUID`,
                "claude-cli"
              )}
              className="flex items-center gap-1.5 text-xs text-zinc-500 hover:text-emerald-400 transition-colors cursor-pointer"
            >
              {copiedExample === "claude-cli" ? (
                <><Check className="h-3.5 w-3.5" />Copied</>
              ) : (
                <><Copy className="h-3.5 w-3.5" />Copy</>
              )}
            </button>
          </div>
          <pre className="p-4 text-sm font-mono text-zinc-300 overflow-x-auto leading-relaxed whitespace-pre-wrap">{`claude mcp add --transport http \\
  -H "Authorization: Bearer $DAZZLE_API_KEY" \\
  dazzle ${window.location.origin}/mcp/YOUR_UUID`}</pre>
        </div>

        {/* JSON config example */}
        <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] overflow-hidden mb-4">
          <div className="flex items-center justify-between px-4 py-2.5 border-b border-white/[0.06]">
            <span className="text-xs font-medium text-zinc-500">Claude Code — JSON config</span>
            <button
              onClick={() => copyExample(
                JSON.stringify({ mcpServers: { dazzle: { type: "http", url: `${window.location.origin}/mcp/YOUR_UUID`, headers: { Authorization: "Bearer ${DAZZLE_API_KEY}" } } } }, null, 2),
                "claude-json"
              )}
              className="flex items-center gap-1.5 text-xs text-zinc-500 hover:text-emerald-400 transition-colors cursor-pointer"
            >
              {copiedExample === "claude-json" ? (
                <><Check className="h-3.5 w-3.5" />Copied</>
              ) : (
                <><Copy className="h-3.5 w-3.5" />Copy</>
              )}
            </button>
          </div>
          <pre className="p-4 text-sm font-mono text-zinc-300 overflow-x-auto leading-relaxed">{JSON.stringify(
            { mcpServers: { dazzle: { type: "http", url: `${window.location.origin}/mcp/YOUR_UUID`, headers: { Authorization: "Bearer ${DAZZLE_API_KEY}" } } } },
            null, 2
          )}</pre>
        </div>

        {/* Env var */}
        <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-5 mb-4">
          <p className="text-xs font-medium text-zinc-400 mb-2">Set your API key as an environment variable</p>
          <div className="flex items-center gap-2">
            <code className="flex-1 text-sm font-mono text-zinc-300 bg-zinc-950/50 rounded-lg px-4 py-2.5 border border-white/[0.06]">
              export DAZZLE_API_KEY=bstr_...
            </code>
            <button
              onClick={() => copyExample("export DAZZLE_API_KEY=", "env")}
              className="text-zinc-400 hover:text-emerald-400 hover:bg-emerald-500/10 p-2 rounded-md transition-colors cursor-pointer shrink-0"
            >
              {copiedExample === "env" ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
            </button>
          </div>
          <p className="text-xs text-zinc-600 mt-2">
            Add this to your <code className="text-zinc-500">.bashrc</code>, <code className="text-zinc-500">.zshrc</code>, or project <code className="text-zinc-500">.env</code> file. Never hardcode keys in config files.
          </p>
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
              <p className="text-xs text-zinc-600">How to scope sessions to different projects or agents</p>
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
                    Environments are created on first use and cleaned up after idle timeout.
                  </p>
                </div>
                <div>
                  <p className="text-xs font-medium text-zinc-400 mb-1.5">Multiple agents in parallel</p>
                  <p className="text-xs text-zinc-500 leading-relaxed">
                    Each UUID gets its own isolated environment. Run multiple agents simultaneously by
                    giving each a different UUID. For example, scope by project:
                  </p>
                  <pre className="mt-2 text-xs font-mono text-zinc-400 bg-zinc-950/50 rounded-lg px-4 py-2.5 border border-white/[0.06] overflow-x-auto leading-relaxed">{`# Project A — always uses the same environment
/mcp/a1b2c3d4-e5f6-7890-abcd-ef1234567890

# Project B — separate environment
/mcp/f9e8d7c6-b5a4-3210-fedc-ba0987654321`}</pre>
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
                    A single API key works across all your sessions. Or create separate keys per project or
                    team member for easier auditing — revoke one without affecting others.
                  </p>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
