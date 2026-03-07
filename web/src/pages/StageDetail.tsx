import { useEffect, useState, useRef } from "react";
import { useParams, Link, useNavigate } from "react-router-dom";
import { stageClient, streamClient } from "../client.js";
import type { Stage } from "../gen/api/v1/stage_pb.js";
import type { StreamDestination } from "../gen/api/v1/stream_pb.js";
import { timestampDate } from "@bufbuild/protobuf/wkt";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Trash2, Cpu, Globe, ArrowLeft, Copy, Check, ArrowUpRight } from "lucide-react";
import { StreamPreview } from "@/components/StreamPreview";

export function StageDetail() {
  const { stageId } = useParams<{ stageId: string }>();
  const navigate = useNavigate();
  const [stage, setStage] = useState<Stage | null>(null);
  const [destinations, setDestinations] = useState<StreamDestination[]>([]);
  const [loading, setLoading] = useState(true);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const copyTimeoutRef = useRef<ReturnType<typeof setTimeout>>(null);

  async function refresh() {
    if (!stageId) return;
    try {
      const [stageResp, streamResp] = await Promise.all([
        stageClient.getStage({ id: stageId }),
        streamClient.listStreamDestinations({}),
      ]);
      setStage(stageResp.stage ?? null);
      setDestinations(streamResp.destinations);
    } catch {
      // stage may not exist
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refresh();
  }, [stageId]);

  useEffect(() => {
    return () => {
      if (copyTimeoutRef.current) clearTimeout(copyTimeoutRef.current);
    };
  }, []);

  async function handleCopy(text: string, id: string) {
    if (copyTimeoutRef.current) clearTimeout(copyTimeoutRef.current);
    try {
      await navigator.clipboard.writeText(text);
      setCopiedId(id);
      copyTimeoutRef.current = setTimeout(() => setCopiedId(null), 2000);
    } catch {
      // clipboard not available
    }
  }

  async function handleDelete() {
    if (!stageId) return;
    try {
      await stageClient.deleteStage({ id: stageId });
    } catch {
      // ignore
    }
    navigate("/");
  }

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-zinc-500 text-sm pt-12">
        <div className="h-4 w-4 border-2 border-zinc-600 border-t-emerald-400 rounded-full animate-spin" />
        Loading stage...
      </div>
    );
  }

  if (!stage) {
    return (
      <div className="pt-12 text-center">
        <p className="text-zinc-500 text-sm mb-4">Stage not found.</p>
        <Link to="/" className="text-emerald-400 hover:text-emerald-300 text-sm">
          Back to stages
        </Link>
      </div>
    );
  }

  const cliSnippet = `# Activate this stage
dazzle s up -s ${stage?.name || stageId}

# Push content
dazzle s sc set app.jsx -s ${stage?.name || stageId}

# Screenshot to verify
dazzle s ss -s ${stage?.name || stageId}

# Go live
dazzle s bc on -s ${stage?.name || stageId}`;

  return (
    <div>
      {/* Back + header */}
      <Link
        to="/"
        className="inline-flex items-center gap-1.5 text-sm text-zinc-500 hover:text-zinc-300 transition-colors mb-6"
      >
        <ArrowLeft className="h-4 w-4" />
        Back to stages
      </Link>

      <div className="flex items-center gap-3 mb-8">
        <code className="text-sm font-mono text-zinc-300 bg-white/[0.04] px-2.5 py-1 rounded-lg">
          {stage.id}
        </code>
        <Badge variant={stage.status === "running" ? "success" : stage.status === "starting" ? "warning" : "default"}>
          {stage.status === "running" ? "active" : stage.status || "inactive"}
        </Badge>
      </div>

      {/* Two-column layout */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
        {/* Left: Stream Preview */}
        <div>
          <p className="text-xs font-medium text-zinc-400 mb-3">Preview</p>
          <StreamPreview
            stageId={stageId!}
            status={stage.status === "running" ? "running" : stage.status === "starting" ? "starting" : "stopped"}
          />
        </div>

        {/* Right: Metadata + Streaming */}
        <div className="flex flex-col gap-6">
          {/* Metadata */}
          <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-5">
            <p className="text-xs font-medium text-zinc-400 mb-3">Details</p>
            <div className="flex flex-col gap-2.5">
              {stage.podName && (
                <div className="flex items-center gap-2 text-xs text-zinc-500">
                  <Cpu className="h-3.5 w-3.5 shrink-0" />
                  <span className="font-mono truncate">{stage.podName}</span>
                </div>
              )}
              {stage.directPort > 0 && (
                <div className="flex items-center gap-2 text-xs text-zinc-500">
                  <Globe className="h-3.5 w-3.5 shrink-0" />
                  <span>Port {stage.directPort}</span>
                </div>
              )}
              <div className="flex items-center gap-2 text-xs text-zinc-500">
                <span className="text-zinc-600 w-[52px]">Created</span>
                <span>{stage.createdAt ? timestampDate(stage.createdAt).toLocaleDateString() : "\u2014"}</span>
              </div>
              {stage.name && stage.name !== "default" && (
                <div className="flex items-center gap-2 text-xs text-zinc-500">
                  <span className="text-zinc-600 w-[52px]">Name</span>
                  <span>{stage.name}</span>
                </div>
              )}
            </div>
          </div>

          {/* Streaming */}
          <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-5">
            <p className="text-xs font-medium text-zinc-400 mb-3">Streaming</p>
            {destinations.length > 0 ? (
              <>
                <select
                  value={stage.destinationId || ""}
                  onChange={async (e) => {
                    try {
                      await stageClient.setStageDestination({ stageId: stageId!, destinationId: e.target.value });
                      await refresh();
                    } catch {
                      // ignore
                    }
                  }}
                  className="w-full rounded-lg border border-white/[0.06] bg-zinc-950/50 px-3 py-2 text-xs text-zinc-300 focus:outline-none focus:ring-1 focus:ring-emerald-500/50 mb-3"
                >
                  <option value="">Select destination...</option>
                  {destinations.map((d) => (
                    <option key={d.id} value={d.id}>{d.name} ({d.platform})</option>
                  ))}
                </select>
                <Link
                  to="/destinations"
                  className="inline-flex items-center gap-1 text-xs text-zinc-500 hover:text-emerald-400 transition-colors"
                >
                  Manage destinations
                  <ArrowUpRight className="h-3 w-3" />
                </Link>
              </>
            ) : (
              <Link
                to="/destinations"
                className="inline-flex items-center gap-1 text-xs text-zinc-500 hover:text-emerald-400 transition-colors"
              >
                No destinations yet. Create one
                <ArrowUpRight className="h-3 w-3" />
              </Link>
            )}
          </div>
        </div>
      </div>

      {/* CLI usage section */}
      <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-5 mb-8">
        <p className="text-xs font-medium text-zinc-400 mb-4">CLI Usage</p>
        <div className="relative">
          <pre className="font-mono text-sm text-zinc-300 bg-zinc-950/50 rounded-lg px-4 py-3 border border-white/[0.06] whitespace-pre-wrap overflow-x-auto">
            {cliSnippet}
          </pre>
          <button
            onClick={() => handleCopy(cliSnippet, "cli")}
            className="absolute top-2 right-2 text-zinc-500 hover:text-emerald-400 p-1.5 rounded-md transition-colors cursor-pointer"
          >
            {copiedId === "cli" ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
          </button>
        </div>
      </div>

      {/* Danger zone */}
      <div className="rounded-xl border border-red-500/10 bg-red-500/[0.02] p-5">
        <p className="text-xs font-medium text-zinc-400 mb-3">Danger zone</p>
        {!confirmingDelete ? (
          <Button
            variant="ghost"
            size="sm"
            className="text-zinc-500 hover:text-red-400 hover:bg-red-500/10"
            onClick={() => setConfirmingDelete(true)}
          >
            <Trash2 className="h-3.5 w-3.5 mr-1" />
            Delete stage
          </Button>
        ) : (
          <div>
            <p className="text-sm text-zinc-400 mb-3">
              Delete this stage? If active, it will be stopped.
            </p>
            <div className="flex items-center gap-2">
              <Button
                variant="ghost"
                size="sm"
                className="text-zinc-500"
                onClick={() => setConfirmingDelete(false)}
              >
                Cancel
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="text-red-400 hover:bg-red-500/10"
                onClick={handleDelete}
              >
                <Trash2 className="h-3.5 w-3.5 mr-1" />
                Delete
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
