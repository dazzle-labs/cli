import { useEffect, useState } from "react";
import { streamClient } from "../client.js";
import type { StreamDestination } from "../gen/api/v1/stream_pb.js";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Plus, X, Trash2, Radio, ToggleLeft, ToggleRight } from "lucide-react";

const platforms = ["custom", "twitch", "youtube", "restream"];

export function StreamConfig() {
  const [destinations, setDestinations] = useState<StreamDestination[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ name: "", platform: "custom", rtmpUrl: "", streamKey: "", enabled: true });

  async function refresh() {
    const resp = await streamClient.listStreamDestinations({});
    setDestinations(resp.destinations);
    setLoading(false);
  }

  useEffect(() => {
    refresh();
  }, []);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    await streamClient.createStreamDestination({
      name: form.name,
      platform: form.platform,
      rtmpUrl: form.rtmpUrl,
      streamKey: form.streamKey,
      enabled: form.enabled,
    });
    setForm({ name: "", platform: "custom", rtmpUrl: "", streamKey: "", enabled: true });
    setShowForm(false);
    await refresh();
  }

  async function handleToggle(dest: StreamDestination) {
    await streamClient.updateStreamDestination({
      id: dest.id,
      name: dest.name,
      platform: dest.platform,
      rtmpUrl: dest.rtmpUrl,
      streamKey: dest.streamKey,
      enabled: !dest.enabled,
    });
    await refresh();
  }

  async function handleDelete(id: string) {
    await streamClient.deleteStreamDestination({ id });
    await refresh();
  }

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-zinc-500 text-sm pt-12">
        <div className="h-4 w-4 border-2 border-zinc-600 border-t-emerald-400 rounded-full animate-spin" />
        Loading destinations...
      </div>
    );
  }

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1
            className="text-3xl tracking-[-0.02em] text-white mb-1"
            style={{ fontFamily: "'DM Serif Display', serif" }}
          >
            Stream Destinations
          </h1>
          <p className="text-sm text-zinc-500">
            {destinations.length} destination{destinations.length !== 1 && "s"} configured
          </p>
        </div>
        <Button
          onClick={() => setShowForm(!showForm)}
          className={
            showForm
              ? "bg-transparent border border-white/[0.1] text-zinc-300 hover:bg-white/[0.03]"
              : "bg-emerald-500 text-zinc-950 hover:bg-emerald-400 font-semibold"
          }
        >
          {showForm ? (
            <>
              <X className="h-4 w-4 mr-1" /> Cancel
            </>
          ) : (
            <>
              <Plus className="h-4 w-4 mr-1" /> Add Destination
            </>
          )}
        </Button>
      </div>

      {/* Add form */}
      {showForm && (
        <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-6 mb-8">
          <h3 className="text-sm font-semibold text-white mb-5">New Destination</h3>
          <form onSubmit={handleCreate}>
            <div className="grid grid-cols-2 gap-4 mb-5">
              <div>
                <label className="text-xs font-medium text-zinc-500 mb-1.5 block">Name</label>
                <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
              </div>
              <div>
                <label className="text-xs font-medium text-zinc-500 mb-1.5 block">Platform</label>
                <select
                  className="flex h-9 w-full rounded-lg border border-white/[0.08] bg-white/[0.03] px-3 py-1 text-sm text-zinc-300 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-emerald-500/50 transition-colors"
                  value={form.platform}
                  onChange={(e) => setForm({ ...form, platform: e.target.value })}
                >
                  {platforms.map((p) => (
                    <option key={p} value={p}>{p}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-xs font-medium text-zinc-500 mb-1.5 block">RTMP URL</label>
                <Input value={form.rtmpUrl} onChange={(e) => setForm({ ...form, rtmpUrl: e.target.value })} placeholder="rtmp://..." required />
              </div>
              <div>
                <label className="text-xs font-medium text-zinc-500 mb-1.5 block">Stream Key</label>
                <Input type="password" value={form.streamKey} onChange={(e) => setForm({ ...form, streamKey: e.target.value })} required />
              </div>
            </div>
            <div className="flex items-center gap-4">
              <label className="flex items-center gap-2 text-sm text-zinc-400 cursor-pointer">
                <input
                  type="checkbox"
                  checked={form.enabled}
                  onChange={(e) => setForm({ ...form, enabled: e.target.checked })}
                  className="rounded border-white/[0.1] accent-emerald-500"
                />
                Enabled
              </label>
              <Button type="submit" className="bg-emerald-500 text-zinc-950 hover:bg-emerald-400 font-semibold">
                Create
              </Button>
            </div>
          </form>
        </div>
      )}

      {/* Destinations list */}
      {destinations.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-24 text-center">
          <div className="h-16 w-16 rounded-2xl bg-white/[0.03] border border-white/[0.06] flex items-center justify-center mb-5">
            <Radio className="h-7 w-7 text-zinc-600" />
          </div>
          <p className="text-zinc-400 text-sm mb-1">No stream destinations</p>
          <p className="text-zinc-600 text-xs">Add one to start streaming.</p>
        </div>
      ) : (
        <div className="rounded-xl border border-white/[0.06] overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-white/[0.06]">
                <th className="text-left py-3 px-4 text-xs font-medium text-zinc-500 uppercase tracking-wider">Name</th>
                <th className="text-left py-3 px-4 text-xs font-medium text-zinc-500 uppercase tracking-wider">Platform</th>
                <th className="text-left py-3 px-4 text-xs font-medium text-zinc-500 uppercase tracking-wider">RTMP URL</th>
                <th className="text-left py-3 px-4 text-xs font-medium text-zinc-500 uppercase tracking-wider">Status</th>
                <th className="py-3 px-4"></th>
              </tr>
            </thead>
            <tbody>
              {destinations.map((d) => (
                <tr key={d.id} className="border-b border-white/[0.04] last:border-0 hover:bg-white/[0.02] transition-colors">
                  <td className="py-3 px-4 text-zinc-300">{d.name}</td>
                  <td className="py-3 px-4">
                    <span className="text-xs font-mono text-zinc-400 bg-white/[0.04] px-2 py-0.5 rounded">
                      {d.platform}
                    </span>
                  </td>
                  <td className="py-3 px-4">
                    <code className="text-xs text-zinc-500 font-mono">{d.rtmpUrl}</code>
                  </td>
                  <td className="py-3 px-4">
                    <button
                      onClick={() => handleToggle(d)}
                      className={`flex items-center gap-1.5 text-xs font-medium transition-colors cursor-pointer ${
                        d.enabled ? "text-emerald-400" : "text-zinc-600"
                      }`}
                    >
                      {d.enabled ? <ToggleRight className="h-4 w-4" /> : <ToggleLeft className="h-4 w-4" />}
                      {d.enabled ? "On" : "Off"}
                    </button>
                  </td>
                  <td className="py-3 px-4 text-right">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-zinc-500 hover:text-red-400 hover:bg-red-500/10"
                      onClick={() => handleDelete(d.id)}
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
