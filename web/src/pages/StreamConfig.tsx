import { useEffect, useState } from "react";
import { streamClient } from "../client.js";
import type { StreamDestination } from "../gen/api/v1/stream_pb.js";
import { StreamDestinationForm } from "@/components/onboarding/StreamDestinationForm.js";
import type { StreamDestinationData } from "@/components/onboarding/StreamDestinationForm.js";
import { Button } from "@/components/ui/button";
import { X, Trash2, Radio } from "lucide-react";
import { PlatformIcon, PLATFORM_LIST } from "@/components/PlatformIcon";

export function StreamConfig() {
  const [destinations, setDestinations] = useState<StreamDestination[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedPlatform, setSelectedPlatform] = useState<string | null>(null);
  const [showPlatformPicker, setShowPlatformPicker] = useState(false);
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
      });
      setSelectedPlatform(null);
      setShowPlatformPicker(false);
      await refresh();
    } catch {
      // ignore
    }
  }

  async function handleUpdate(id: string, data: StreamDestinationData) {
    try {
      await streamClient.updateStreamDestination({
        id,
        name: data.name,
        platform: data.platform,
        rtmpUrl: data.rtmpUrl,
        streamKey: data.streamKey,
      });
      setEditingId(null);
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

  function handleCancel() {
    setShowPlatformPicker(false);
    setSelectedPlatform(null);
    setEditingId(null);
  }

  const showingForm = selectedPlatform !== null || editingId !== null;

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
            if (showingForm || showPlatformPicker) { handleCancel(); }
            else { setShowPlatformPicker(true); }
          }}
          className={
            showingForm || showPlatformPicker
              ? "bg-transparent border border-white/[0.1] text-zinc-300 hover:bg-white/[0.03]"
              : "bg-emerald-500 text-zinc-950 hover:bg-emerald-400 font-semibold"
          }
        >
          {showingForm || showPlatformPicker ? (
            <>
              <X className="h-4 w-4 mr-1" /> Cancel
            </>
          ) : (
            "Add Destination"
          )}
        </Button>
      </div>

      {/* Platform picker grid */}
      {showPlatformPicker && !selectedPlatform && (
        <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-6 mb-8">
          <h3 className="text-sm font-semibold text-white mb-4">Choose a platform</h3>
          <div className="grid grid-cols-3 sm:grid-cols-5 gap-3">
            {PLATFORM_LIST.map((p) => (
              <button
                key={p.value}
                type="button"
                onClick={() => setSelectedPlatform(p.value)}
                className="flex flex-col items-center gap-2 rounded-xl border border-white/[0.06] bg-white/[0.02] p-4 transition-all hover:border-emerald-500/20 hover:bg-emerald-500/[0.02] cursor-pointer"
              >
                <PlatformIcon platform={p.value} />
                <span className="text-xs text-zinc-400">{p.label}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Add/Edit form */}
      {(selectedPlatform || editingId) && (
        <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-6 mb-8">
          <h3 className="text-sm font-semibold text-white mb-5">
            {editingId ? "Edit Destination" : "New Destination"}
          </h3>
          <StreamDestinationForm
            key={editingId ?? selectedPlatform ?? "new"}
            compact
            hideSkip
            streamKeyOptional={!!editingId}
            lockedPlatform={selectedPlatform ?? undefined}
            initial={editingId ? (() => {
              const d = destinations.find(d => d.id === editingId);
              return d ? { name: d.name, platform: d.platform, rtmpUrl: d.rtmpUrl, streamKey: "" } : undefined;
            })() : selectedPlatform ? { name: "", platform: selectedPlatform, rtmpUrl: "", streamKey: "" } : undefined}
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
        <>
          {/* Desktop table */}
          <div className="rounded-xl border border-white/[0.06] overflow-hidden hidden sm:block">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-white/[0.06]">
                  <th className="text-left py-3 px-4 text-xs font-medium text-zinc-500 uppercase tracking-wider">Name</th>
                  <th className="text-left py-3 px-4 text-xs font-medium text-zinc-500 uppercase tracking-wider">Platform</th>
                  <th className="text-left py-3 px-4 text-xs font-medium text-zinc-500 uppercase tracking-wider">RTMP URL</th>
                  <th className="py-3 px-4"></th>
                </tr>
              </thead>
              <tbody>
                {destinations.map((d) => (
                  <tr
                    key={d.id}
                    onClick={() => { setEditingId(d.id); setShowPlatformPicker(false); setSelectedPlatform(null); setConfirmDeleteId(null); }}
                    className="border-b border-white/[0.04] last:border-0 hover:bg-white/[0.02] transition-colors cursor-pointer"
                  >
                    <td className="py-3 px-4 text-zinc-300">{d.name}</td>
                    <td className="py-3 px-4">
                      <div className="flex items-center gap-2">
                        <PlatformIcon platform={d.platform} size="sm" />
                        <span className="text-xs text-zinc-400">{d.platform}</span>
                      </div>
                    </td>
                    <td className="py-3 px-4">
                      <code className="text-xs text-zinc-500 font-mono">{d.rtmpUrl}</code>
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

          {/* Mobile cards */}
          <div className="flex flex-col gap-3 sm:hidden">
            {destinations.map((d) => (
              <div
                key={d.id}
                onClick={() => { setEditingId(d.id); setShowPlatformPicker(false); setSelectedPlatform(null); setConfirmDeleteId(null); }}
                className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-4 cursor-pointer hover:border-emerald-500/15 transition-all"
              >
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm text-zinc-300 font-medium">{d.name}</span>
                  <div className="flex items-center gap-2">
                    <PlatformIcon platform={d.platform} size="sm" />
                    <span className="text-xs text-zinc-500">{d.platform}</span>
                  </div>
                </div>
                <code className="text-xs text-zinc-600 font-mono break-all">{d.rtmpUrl}</code>
                <div className="mt-3 flex justify-end" onClick={(e) => e.stopPropagation()}>
                  {confirmDeleteId === d.id ? (
                    <div className="flex items-center gap-2">
                      <Button variant="ghost" size="sm" className="text-red-400 hover:bg-red-500/10" onClick={() => { handleDelete(d.id); setConfirmDeleteId(null); }}>
                        Delete
                      </Button>
                      <Button variant="ghost" size="sm" className="text-zinc-500" onClick={() => setConfirmDeleteId(null)}>
                        Cancel
                      </Button>
                    </div>
                  ) : (
                    <Button variant="ghost" size="sm" className="text-zinc-500 hover:text-red-400 hover:bg-red-500/10" onClick={() => setConfirmDeleteId(d.id)}>
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
