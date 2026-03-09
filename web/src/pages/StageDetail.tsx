import { useEffect, useState, useRef } from "react";
import { useParams, Link, useNavigate } from "react-router-dom";
import { stageClient, streamClient } from "../client.js";
import type { Stage } from "../gen/api/v1/stage_pb.js";
import type { StreamDestination } from "../gen/api/v1/stream_pb.js";
import { timestampDate } from "@bufbuild/protobuf/wkt";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Trash2, Cpu, Globe, ArrowLeft, Copy, Check, ArrowUpRight, Pencil, X as XIcon, Link2, RefreshCw, ExternalLink } from "lucide-react";
import { StreamPreview } from "@/components/StreamPreview";
import { CodeBlock } from "@/components/ui/code-block";

export function StageDetail() {
  const { stageId } = useParams<{ stageId: string }>();
  const navigate = useNavigate();
  const [stage, setStage] = useState<Stage | null>(null);
  const [destinations, setDestinations] = useState<StreamDestination[]>([]);
  const [loading, setLoading] = useState(true);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [confirmingRegen, setConfirmingRegen] = useState(false);
  const copyTimeoutRef = useRef<ReturnType<typeof setTimeout>>(null);

  // Inline name editing
  const [editingName, setEditingName] = useState(false);
  const [nameValue, setNameValue] = useState("");
  const nameInputRef = useRef<HTMLInputElement>(null);

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

  function startEditingName() {
    setNameValue(stage?.name || "");
    setEditingName(true);
    setTimeout(() => nameInputRef.current?.focus(), 0);
  }

  async function saveName() {
    if (!stageId || !nameValue.trim()) {
      setEditingName(false);
      return;
    }
    try {
      const resp = await stageClient.updateStage({
        stage: { id: stageId, name: nameValue.trim() },
        updateMask: { paths: ["name"] },
      });
      setStage(resp.stage ?? null);
    } catch {
      // ignore
    }
    setEditingName(false);
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

  const cliSnippet = `# Set as default stage (then -s flag is optional)
dazzle stage default "${stage?.name || stageId}"

# Activate this stage
dazzle stage activate

# Push content
dazzle stage script set app.jsx

# Screenshot to verify
dazzle stage screenshot

# Go live
dazzle stage broadcast on`;

  const displayName = stage.name && stage.name !== "default" ? stage.name : "Untitled Stage";

  return (
    <div>
      {/* Back */}
      <Link
        to="/"
        className="inline-flex items-center gap-1.5 text-sm text-zinc-500 hover:text-zinc-300 transition-colors mb-6"
      >
        <ArrowLeft className="h-4 w-4" />
        Back to stages
      </Link>

      {/* Stage name + status */}
      <div className="flex items-center gap-3 mb-8">
        {editingName ? (
          <div className="flex items-center gap-2">
            <input
              ref={nameInputRef}
              value={nameValue}
              onChange={(e) => setNameValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") saveName();
                if (e.key === "Escape") setEditingName(false);
              }}
              className="text-2xl tracking-[-0.02em] text-white bg-transparent border-b border-emerald-500/50 outline-none px-1 py-0.5"
              style={{ fontFamily: "'DM Serif Display', serif" }}
            />
            <button
              onClick={saveName}
              className="text-emerald-400 hover:text-emerald-300 p-1 cursor-pointer"
            >
              <Check className="h-4 w-4" />
            </button>
            <button
              onClick={() => setEditingName(false)}
              className="text-zinc-500 hover:text-zinc-300 p-1 cursor-pointer"
            >
              <XIcon className="h-4 w-4" />
            </button>
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <h1
              className="text-2xl tracking-[-0.02em] text-white"
              style={{ fontFamily: "'DM Serif Display', serif" }}
            >
              {displayName}
            </h1>
            <button
              onClick={startEditingName}
              className="text-zinc-600 hover:text-zinc-300 p-1 cursor-pointer transition-colors"
              title="Rename stage"
            >
              <Pencil className="h-3.5 w-3.5" />
            </button>
          </div>
        )}
        <Badge variant={stage.status === "running" ? "success" : stage.status === "starting" ? "warning" : "default"}>
          {stage.status === "running" ? "active" : stage.status || "inactive"}
        </Badge>
      </div>

      {/* Main + Sidebar layout */}
      <div className="xl:flex xl:gap-6">
        {/* Main: Stream Preview */}
        <div className="flex-1 min-w-0 mb-8 xl:mb-0">
          <StreamPreview
            stageId={stageId!}
            status={stage.status === "running" ? "running" : stage.status === "starting" ? "starting" : "stopped"}
          />
          {stage.preview && (
            <div className="mt-3 rounded-xl border border-white/[0.06] bg-white/[0.02] px-3 py-2">
              <div className="flex items-center gap-1.5">
                <Link2 className="h-3 w-3 text-zinc-600 shrink-0" />
                <code className="flex-1 text-xs font-mono text-zinc-500 truncate">
                  {stage.preview.watchUrl.replace(/token=.*/, "token=••••••••")}
                </code>
                <button
                  onClick={() => handleCopy(stage.preview!.watchUrl, "preview-watch")}
                  className="text-zinc-500 hover:text-emerald-400 p-1 rounded transition-colors cursor-pointer shrink-0"
                  title="Copy preview URL"
                >
                  {copiedId === "preview-watch" ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
                </button>
                <a
                  href={stage.preview.watchUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-zinc-500 hover:text-emerald-400 p-1 rounded transition-colors shrink-0"
                  title="Open preview"
                >
                  <ExternalLink className="h-3 w-3" />
                </a>
                {!confirmingRegen ? (
                  <button
                    onClick={() => setConfirmingRegen(true)}
                    className="text-zinc-600 hover:text-zinc-400 p-1 rounded transition-colors cursor-pointer shrink-0"
                    title="Regenerate preview URL"
                  >
                    <RefreshCw className="h-3 w-3" />
                  </button>
                ) : (
                  <div className="flex items-center gap-1.5 shrink-0">
                    <button
                      onClick={async () => {
                        try {
                          await stageClient.regeneratePreviewToken({ id: stageId! });
                          await refresh();
                        } catch { /* ignore */ }
                        setConfirmingRegen(false);
                      }}
                      className="text-[10px] text-emerald-400 hover:text-emerald-300 cursor-pointer"
                    >
                      Confirm
                    </button>
                    <button
                      onClick={() => setConfirmingRegen(false)}
                      className="text-[10px] text-zinc-500 hover:text-zinc-300 cursor-pointer"
                    >
                      Cancel
                    </button>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Sidebar */}
        <div className="xl:w-[340px] xl:shrink-0 flex flex-col gap-6">
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
            </div>
          </div>

          {/* Broadcast destination */}
          <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-5">
            <p className="text-xs font-medium text-zinc-400 mb-3">Broadcast Destination</p>
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
                    <option key={d.id} value={d.id}>{d.name || d.platformUsername || d.platform} ({d.platform})</option>
                  ))}
                </select>
                {!stage.destinationId && (
                  <Link
                    to="/destinations"
                    className="inline-flex items-center gap-2 rounded-lg bg-emerald-500 text-zinc-950 font-semibold text-xs px-4 py-2 hover:bg-emerald-400 transition-colors"
                  >
                    Add a streaming destination
                    <ArrowUpRight className="h-3 w-3" />
                  </Link>
                )}
                {stage.destinationId && (
                  <div className="flex flex-col gap-1.5">
                    <Link
                      to="/destinations"
                      className="inline-flex items-center gap-1 text-xs text-zinc-500 hover:text-emerald-400 transition-colors"
                    >
                      Manage destinations
                      <ArrowUpRight className="h-3 w-3" />
                    </Link>
                    <Link
                      to="/api-keys"
                      className="inline-flex items-center gap-1 text-xs text-zinc-500 hover:text-emerald-400 transition-colors"
                    >
                      Manage API keys
                      <ArrowUpRight className="h-3 w-3" />
                    </Link>
                  </div>
                )}
              </>
            ) : (
              <Link
                to="/destinations"
                className="inline-flex items-center gap-2 rounded-lg bg-emerald-500 text-zinc-950 font-semibold text-xs px-4 py-2 hover:bg-emerald-400 transition-colors"
              >
                Add a streaming destination
                <ArrowUpRight className="h-3 w-3" />
              </Link>
            )}
          </div>

          {/* CLI usage */}
          <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-5">
            <p className="text-xs font-medium text-zinc-400 mb-4">CLI Usage</p>
            <div className="relative">
              <CodeBlock code={cliSnippet} />
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
      </div>
    </div>
  );
}
