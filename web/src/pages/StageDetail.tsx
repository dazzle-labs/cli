import { useEffect, useState, useRef } from "react";
import { useParams, Link, useNavigate } from "react-router-dom";
import { stageClient, streamClient } from "../client.js";
import type { Stage } from "../gen/api/v1/stage_pb.js";
import type { StreamDestination } from "../gen/api/v1/stream_pb.js";
import { timestampDate } from "@bufbuild/protobuf/wkt";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Trash2, Cpu, Globe, Check, ArrowUpRight, Pencil, X as XIcon, Link2, RefreshCw, ExternalLink } from "lucide-react";
import { Input } from "@/components/ui/input";
import { StreamPreview } from "@/components/StreamPreview";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Breadcrumb, BreadcrumbItem, BreadcrumbLink, BreadcrumbList, BreadcrumbPage, BreadcrumbSeparator } from "@/components/ui/breadcrumb";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { AnimatedPage } from "@/components/AnimatedPage";
import { CopyButton } from "@/components/CopyButton";
import { Spinner } from "@/components/ui/spinner";

const cliCommands = [
  { label: "Set as default stage", cmd: (name: string) => `dazzle stage default "${name}"` },
  { label: "Activate this stage", cmd: () => `dazzle stage activate` },
  { label: "Push content", cmd: () => `dazzle stage script set app.jsx` },
  { label: "Screenshot to verify", cmd: () => `dazzle stage screenshot` },
  { label: "Go live", cmd: () => `dazzle stage broadcast on` },
];

export function StageDetail() {
  const { stageId } = useParams<{ stageId: string }>();
  const navigate = useNavigate();
  const [stage, setStage] = useState<Stage | null>(null);
  const [destinations, setDestinations] = useState<StreamDestination[]>([]);
  const [loading, setLoading] = useState(true);
  const [confirmingRegen, setConfirmingRegen] = useState(false);

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
      <div className="flex items-center gap-2 text-muted-foreground text-base pt-12">
        <Spinner className="text-primary" />
        Loading stage...
      </div>
    );
  }

  if (!stage) {
    return (
      <div className="pt-12 text-center">
        <p className="text-muted-foreground text-base mb-4">Stage not found.</p>
        <Link to="/" className="text-primary hover:text-primary/80 text-base">
          Back to stages
        </Link>
      </div>
    );
  }

  const displayName = stage.name && stage.name !== "default" ? stage.name : "Untitled Stage";
  const isRunning = stage.status === "running";
  const isStarting = stage.status === "starting";
  const allCmds = cliCommands.map(c => c.cmd(stage?.name || stageId!)).join("\n");

  return (
    <AnimatedPage>
      {/* Breadcrumb */}
      <Breadcrumb className="mb-6">
        <BreadcrumbList>
          <BreadcrumbItem><BreadcrumbLink asChild><Link to="/">Stages</Link></BreadcrumbLink></BreadcrumbItem>
          <BreadcrumbSeparator />
          <BreadcrumbItem><BreadcrumbPage>{displayName}</BreadcrumbPage></BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>

      {/* Stage name + status */}
      <div className="flex items-center gap-3 mb-8">
        {editingName ? (
          <div className="flex items-center gap-2">
            <Input
              ref={nameInputRef}
              value={nameValue}
              onChange={(e) => setNameValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") saveName();
                if (e.key === "Escape") setEditingName(false);
              }}
              className="text-2xl tracking-[-0.02em] text-foreground border-primary/50 max-w-xs font-display"
            />
            <Button variant="ghost" size="icon" className="text-primary hover:text-primary/80" onClick={saveName}>
              <Check className="h-4 w-4" />
            </Button>
            <Button variant="ghost" size="icon" className="text-muted-foreground hover:text-foreground" onClick={() => setEditingName(false)}>
              <XIcon className="h-4 w-4" />
            </Button>
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <h1 className="text-2xl tracking-[-0.02em] text-foreground font-display">
              {displayName}
            </h1>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-foreground" onClick={startEditingName}>
                  <Pencil className="h-3.5 w-3.5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Rename stage</TooltipContent>
            </Tooltip>
          </div>
        )}
        <div className="flex items-center gap-2">
          {(isRunning || isStarting) && (
            <span className="relative flex h-2.5 w-2.5">
              <span className={`animate-ping absolute inline-flex h-full w-full rounded-full opacity-75 ${isRunning ? "bg-emerald-400" : "bg-amber-400"}`} />
              <span className={`relative inline-flex rounded-full h-2.5 w-2.5 ${isRunning ? "bg-emerald-500" : "bg-amber-500"}`} />
            </span>
          )}
          <Badge variant={isRunning ? "success" : isStarting ? "warning" : "secondary"}>
            {isRunning ? "active" : stage.status || "inactive"}
          </Badge>
        </div>
      </div>

      {/* Main + Sidebar layout */}
      <div className="3xl:flex 3xl:gap-6">
        {/* Main: Stream Preview */}
        <div className="flex-1 min-w-0 mb-8 3xl:mb-0">
          <StreamPreview
            stageId={stageId!}
            status={isRunning ? "running" : isStarting ? "starting" : "stopped"}
          />
          {stage.preview && (
            <div className="mt-3 rounded-xl border border-border bg-card px-3 py-2">
              <div className="flex items-center gap-1.5">
                <Link2 className="h-3 w-3 text-muted-foreground shrink-0" />
                <code className="flex-1 text-sm font-mono text-muted-foreground truncate">
                  {stage.preview.watchUrl.replace(/token=.*/, "token=••••••••")}
                </code>
                <CopyButton text={stage.preview.watchUrl} tooltip="Copy preview URL" size="icon" iconSize="h-3 w-3" className="h-6 w-6" />
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-6 w-6 text-muted-foreground hover:text-primary shrink-0"
                      asChild
                    >
                      <a href={stage.preview.watchUrl} target="_blank" rel="noopener noreferrer">
                        <ExternalLink className="h-3 w-3" />
                      </a>
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>Open preview</TooltipContent>
                </Tooltip>
                {!confirmingRegen ? (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-6 w-6 text-muted-foreground hover:text-foreground shrink-0"
                        onClick={() => setConfirmingRegen(true)}
                      >
                        <RefreshCw className="h-3 w-3" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>Regenerate preview URL</TooltipContent>
                  </Tooltip>
                ) : (
                  <div className="flex items-center gap-1.5 shrink-0">
                    <Button
                      variant="link"
                      size="sm"
                      className="text-xs text-primary hover:text-primary/80 h-auto p-0"
                      onClick={async () => {
                        try {
                          await stageClient.regeneratePreviewToken({ id: stageId! });
                          await refresh();
                        } catch { /* ignore */ }
                        setConfirmingRegen(false);
                      }}
                    >
                      Confirm
                    </Button>
                    <Button
                      variant="link"
                      size="sm"
                      className="text-xs text-muted-foreground hover:text-foreground h-auto p-0"
                      onClick={() => setConfirmingRegen(false)}
                    >
                      Cancel
                    </Button>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Sidebar */}
        <div className="3xl:w-[340px] 3xl:shrink-0 flex flex-col gap-6">
          {/* Metadata */}
          <Card>
            <CardHeader>
              <CardTitle className="text-sm font-medium text-muted-foreground">Details</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex flex-col gap-2.5">
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <span className="text-muted-foreground w-[52px]">ID</span>
                  <code className="font-mono text-muted-foreground">{stage.id}</code>
                </div>
                {stage.podName && (
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Cpu className="h-3.5 w-3.5 shrink-0" />
                    <span className="font-mono truncate">{stage.podName}</span>
                  </div>
                )}
                {stage.directPort > 0 && (
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Globe className="h-3.5 w-3.5 shrink-0" />
                    <span>Port {stage.directPort}</span>
                  </div>
                )}
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <span className="text-muted-foreground w-[52px]">Created</span>
                  <span>{stage.createdAt ? timestampDate(stage.createdAt).toLocaleDateString() : "\u2014"}</span>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Streaming */}
          <Card>
            <CardHeader>
              <CardTitle className="text-sm font-medium text-muted-foreground">Streaming</CardTitle>
            </CardHeader>
            <CardContent>
              {destinations.length > 0 ? (
                <>
                  <Select
                    value={stage.destinationId || undefined}
                    onValueChange={async (val) => {
                      try {
                        await stageClient.setStageDestination({ stageId: stageId!, destinationId: val });
                        await refresh();
                      } catch {
                        // ignore
                      }
                    }}
                  >
                    <SelectTrigger className="w-full mb-3">
                      <SelectValue placeholder="Select destination..." />
                    </SelectTrigger>
                    <SelectContent>
                      {destinations.map((d) => (
                        <SelectItem key={d.id} value={d.id}>
                          {d.name || d.platformUsername || d.platform} ({d.platform})
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {!stage.destinationId && (
                    <Button size="sm" className="font-semibold text-sm" asChild>
                      <Link to="/destinations">
                        Add a streaming destination
                        <ArrowUpRight className="h-3 w-3 ml-1" />
                      </Link>
                    </Button>
                  )}
                  {stage.destinationId && (
                    <div className="flex flex-col gap-1.5">
                      <Button variant="link" size="sm" className="text-sm text-muted-foreground hover:text-primary h-auto p-0 justify-start" asChild>
                        <Link to="/destinations">
                          Manage destinations
                          <ArrowUpRight className="h-3 w-3 ml-1" />
                        </Link>
                      </Button>
                      <Button variant="link" size="sm" className="text-sm text-muted-foreground hover:text-primary h-auto p-0 justify-start" asChild>
                        <Link to="/api-keys">
                          Manage API keys
                          <ArrowUpRight className="h-3 w-3 ml-1" />
                        </Link>
                      </Button>
                    </div>
                  )}
                </>
              ) : (
                <Button size="sm" className="font-semibold text-sm" asChild>
                  <Link to="/destinations">
                    Add a streaming destination
                    <ArrowUpRight className="h-3 w-3 ml-1" />
                  </Link>
                </Button>
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      {/* CLI usage */}
      <Card className="mb-8 mt-6 gap-0 py-0">
        <CardHeader className="py-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm font-medium text-muted-foreground">CLI Usage</CardTitle>
            <CopyButton
              text={allCmds}
              tooltip="Copy all commands"
              size="icon"
              iconSize="h-4 w-4"
            />
          </div>
        </CardHeader>
        <CardContent className="px-0 pb-0">
          <div className="bg-zinc-900 overflow-x-auto py-3">
            {cliCommands.map((cmd, i) => {
              const cmdText = cmd.cmd(stage?.name || stageId!);
              return (
                <div key={i} className={`group/cmd${i > 0 ? " mt-2.5" : ""}`}>
                  <div className="px-5">
                    <span className="text-xs font-mono text-zinc-500 select-none">
                      {"# "}{cmd.label}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 px-5 py-0.5 hover:bg-white/[0.06] transition-colors">
                    <code className="text-sm font-mono text-zinc-200 whitespace-nowrap">{cmdText}</code>
                    <CopyButton
                      text={cmdText}
                      tooltip="Copy"
                      size="icon-xs"
                      iconSize="h-3.5 w-3.5"
                      className="text-zinc-500 hover:text-primary hover:bg-white/[0.08] shrink-0"
                    />
                  </div>
                </div>
              );
            })}
            <div className="h-1" />
          </div>
        </CardContent>
      </Card>

      {/* Danger zone */}
      <Card className="border-destructive/10 bg-destructive/[0.02]">
        <CardHeader>
          <CardTitle className="text-sm font-medium text-muted-foreground">Danger zone</CardTitle>
        </CardHeader>
        <CardContent>
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="ghost" size="sm" className="text-muted-foreground hover:text-destructive hover:bg-destructive/10">
                <Trash2 className="h-3.5 w-3.5 mr-1" />
                Delete stage
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Delete this stage?</AlertDialogTitle>
                <AlertDialogDescription>If active, it will be stopped. This cannot be undone.</AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction variant="destructive" onClick={handleDelete}>Delete</AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </CardContent>
      </Card>
    </AnimatedPage>
  );
}
