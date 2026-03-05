import { useEffect, useState } from "react";
import { streamClient } from "../client.js";
import type { StreamDestination } from "../gen/api/v1/stream_pb.js";
import { StreamDestinationForm } from "@/components/onboarding/StreamDestinationForm.js";
import type { StreamDestinationData } from "@/components/onboarding/StreamDestinationForm.js";
import { Button } from "@/components/ui/button";
import { Plus, X, Trash2, Radio, ToggleLeft, ToggleRight } from "lucide-react";

export function StreamConfig() {
  const [destinations, setDestinations] = useState<StreamDestination[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  async function refresh() {
    const resp = await streamClient.listStreamDestinations({});
    setDestinations(resp.destinations);
    setLoading(false);
  }

  useEffect(() => {
    refresh();
  }, []);

  async function handleCreate(data: StreamDestinationData) {
    try {
      await streamClient.createStreamDestination({
        name: data.name,
        platform: data.platform,
        rtmpUrl: data.rtmpUrl,
        streamKey: data.streamKey,
        enabled: true,
      });
      setShowForm(false);
      await refresh();
    } catch {
      // ignore
    }
  }

  async function handleUpdate(id: string, data: StreamDestinationData) {
    try {
      const existing = destinations.find(d => d.id === id);
      await streamClient.updateStreamDestination({
        id,
        name: data.name,
        platform: data.platform,
        rtmpUrl: data.rtmpUrl,
        streamKey: data.streamKey,
        enabled: existing?.enabled ?? true,
      });
      setEditingId(null);
      await refresh();
    } catch {
      // ignore
    }
  }

  async function handleToggle(dest: StreamDestination) {
    try {
      await streamClient.updateStreamDestination({
        id: dest.id,
        name: dest.name,
        platform: dest.platform,
        rtmpUrl: dest.rtmpUrl,
        streamKey: "",
        enabled: !dest.enabled,
      });
      await refresh();
    } catch {
      // ignore
    }
  }

  async function handleDelete(id: string) {
    try {
      await streamClient.deleteStreamDestination({ id });
      if (editingId === id) setEditingId(null);
      await refresh();
    } catch {
      // ignore
    }
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
          onClick={() => {
            if (showForm || editingId) { setShowForm(false); setEditingId(null); }
            else { setShowForm(true); }
          }}
          className={
            showForm || editingId
              ? "bg-transparent border border-white/[0.1] text-zinc-300 hover:bg-white/[0.03]"
              : "bg-emerald-500 text-zinc-950 hover:bg-emerald-400 font-semibold"
          }
        >
          {showForm || editingId ? (
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

      {/* Add/Edit form */}
      {(showForm || editingId) && (
        <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-6 mb-8">
          <h3 className="text-sm font-semibold text-white mb-5">
            {editingId ? "Edit Destination" : "New Destination"}
          </h3>
          <StreamDestinationForm
            key={editingId ?? "new"}
            compact
            hideSkip
            streamKeyOptional={!!editingId}
            initial={editingId ? (() => {
              const d = destinations.find(d => d.id === editingId);
              return d ? { name: d.name, platform: d.platform, rtmpUrl: d.rtmpUrl, streamKey: "" } : undefined;
            })() : undefined}
            submitLabel={editingId ? "Save" : "Create"}
            onNext={(data) => {
              if (data) {
                if (editingId) {
                  handleUpdate(editingId, data);
                } else {
                  handleCreate(data);
                }
              }
            }}
          />
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
                <tr
                  key={d.id}
                  onClick={() => { setEditingId(d.id); setShowForm(false); setConfirmDeleteId(null); }}
                  className="border-b border-white/[0.04] last:border-0 hover:bg-white/[0.02] transition-colors cursor-pointer"
                >
                  <td className="py-3 px-4 text-zinc-300">{d.name}</td>
                  <td className="py-3 px-4">
                    <span className="text-xs font-mono text-zinc-400 bg-white/[0.04] px-2 py-0.5 rounded">
                      {d.platform}
                    </span>
                  </td>
                  <td className="py-3 px-4">
                    <code className="text-xs text-zinc-500 font-mono">{d.rtmpUrl}</code>
                  </td>
                  <td className="py-3 px-4" onClick={(e) => e.stopPropagation()}>
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
                  <td className="py-3 px-4 text-right" onClick={(e) => e.stopPropagation()}>
                    {confirmDeleteId === d.id ? (
                      <div className="flex items-center gap-2 justify-end">
                        <span className="text-xs text-zinc-400">Unlinks from stages. Delete?</span>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-red-400 hover:bg-red-500/10"
                          onClick={() => { handleDelete(d.id); setConfirmDeleteId(null); }}
                        >
                          Delete
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-zinc-500"
                          onClick={() => setConfirmDeleteId(null)}
                        >
                          Cancel
                        </Button>
                      </div>
                    ) : (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-zinc-500 hover:text-red-400 hover:bg-red-500/10"
                        onClick={() => setConfirmDeleteId(d.id)}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    )}
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
