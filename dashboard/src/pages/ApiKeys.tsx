import { useEffect, useState } from "react";
import { timestampDate } from "@bufbuild/protobuf/wkt";
import { apiKeyClient } from "../client.js";
import type { ApiKey } from "../gen/api/v1/apikey_pb.js";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Key, Trash2, Copy, Check } from "lucide-react";

export function ApiKeys() {
  const [keys, setKeys] = useState<ApiKey[]>([]);
  const [loading, setLoading] = useState(true);
  const [name, setName] = useState("");
  const [newSecret, setNewSecret] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

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
    </div>
  );
}
