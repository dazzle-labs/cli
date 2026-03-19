import { useEffect, useState, useRef } from "react";
import { useParams, Link, useNavigate } from "react-router-dom";
import { cn } from "@/lib/utils";
import { stageClient, streamClient } from "../client.js";
import type { Stage } from "../gen/api/v1/stage_pb.js";
import type { StreamDestination } from "../gen/api/v1/stream_pb.js";
import { timestampDate } from "@bufbuild/protobuf/wkt";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Trash2, Cpu, Globe, Check, ArrowUpRight, Pencil, X as XIcon, Link2, ExternalLink, Zap } from "lucide-react";
import { Input } from "@/components/ui/input";
import { StreamPreview } from "@/components/StreamPreview";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Breadcrumb, BreadcrumbItem, BreadcrumbLink, BreadcrumbList, BreadcrumbPage, BreadcrumbSeparator } from "@/components/ui/breadcrumb";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { AnimatedPage } from "@/components/AnimatedPage";
import { CopyButton } from "@/components/CopyButton";
import { Spinner } from "@/components/ui/spinner";
import { cli } from "@/lib/cli-commands";

const cliCommands = [
  { label: "Start this stage", cmd: (name: string) => `${cli.stageUp.base} -s "${name}"` },
  { label: "Push content", cmd: (name: string) => `${cli.stageSync.base} ./my-app -s "${name}"` },
  { label: "Screenshot to verify", cmd: (name: string) => `${cli.stageScreenshot.base} -s "${name}"` },
  { label: "Check status", cmd: (name: string) => `${cli.stageStatus.base} -s "${name}"` },
];

export function StageDetail() {
  const { stageId } = useParams<{ stageId: string }>();
  const navigate = useNavigate();
  const [stage, setStage] = useState<Stage | null>(null);
  const [destinations, setDestinations] = useState<StreamDestination[]>([]);
  const [loading, setLoading] = useState(true);

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

  const displayName = stage?.name && stage.name !== "default" ? stage.name : loading ? "Loading\u2026" : "Untitled Stage";
  const isRunning = stage?.status === "running";
  const isStarting = stage?.status === "starting";
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

      {loading ? (
        <div className="flex items-center justify-center py-12">
          <Spinner className="text-primary" />
        </div>
      ) : !stage ? (
        <div className="pt-12 text-center">
          <p className="text-muted-foreground text-base mb-4">Stage not found.</p>
          <Link to="/" className="text-primary hover:text-primary/80 text-base">
            Back to stages
          </Link>
        </div>
      ) : (
      <>
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
          {stage.capabilities.includes("gpu") && (
            <Badge variant="outline" className="text-amber-500 border-amber-500/30 gap-1 px-1.5">
              <Zap className="h-3 w-3" />
              GPU
            </Badge>
          )}
          {(isRunning || isStarting) && (
            <span className="relative flex h-2.5 w-2.5">
              <span className={cn("animate-ping absolute inline-flex h-full w-full rounded-full opacity-75", isRunning ? "bg-emerald-400" : "bg-amber-400")} />
              <span className={cn("relative inline-flex rounded-full h-2.5 w-2.5", isRunning ? "bg-emerald-500" : "bg-amber-500")} />
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
            slug={stage.slug}
            status={isRunning ? "running" : isStarting ? "starting" : "stopped"}
          />
          {stage.watchUrl && (
            <div className="mt-3 rounded-xl border border-border bg-card px-3 py-2">
              <div className="flex items-center gap-1.5">
                <Link2 className="h-3 w-3 text-muted-foreground shrink-0" />
                <code className="flex-1 text-sm font-mono text-muted-foreground truncate">
                  {stage.watchUrl}
                </code>
                <CopyButton text={stage.watchUrl} tooltip="Copy watch URL" size="icon" iconSize="h-3 w-3" className="h-6 w-6" />
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-6 w-6 text-muted-foreground hover:text-primary shrink-0"
                      asChild
                    >
                      <a href={stage.watchUrl} target="_blank" rel="noopener noreferrer">
                        <ExternalLink className="h-3 w-3" />
                      </a>
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>Open watch page</TooltipContent>
                </Tooltip>
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
                  <span className="text-muted-foreground">ID</span>
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
                  <span className="text-muted-foreground">Created</span>
                  <span>{stage.createdAt ? timestampDate(stage.createdAt).toLocaleDateString() : "\u2014"}</span>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Streaming */}
          <Card>
            <CardHeader>
              <CardTitle className="text-sm font-medium text-muted-foreground">Destinations</CardTitle>
            </CardHeader>
            <CardContent>
              {stage.destinations.length > 0 && (
                <div className="flex flex-col gap-2 mb-3">
                  {stage.destinations.map((sd) => {
                    const isDazzle = sd.platform === "dazzle";
                    return (
                      <div key={sd.id} className={cn("flex items-center justify-between gap-2 rounded-lg border px-3 py-2", sd.enabled ? "border-border" : "border-border/50 opacity-60")}>
                        <div className="min-w-0">
                          <div className="text-sm font-medium text-foreground truncate">
                            {isDazzle ? "Dazzle" : sd.name || sd.platformUsername || sd.platform}
                          </div>
                          {!isDazzle && <div className="text-xs text-muted-foreground">{sd.platform}</div>}
                        </div>
                        {isDazzle ? (
                          <Switch
                            checked={sd.enabled}
                            onCheckedChange={async (checked) => {
                              try {
                                if (checked) {
                                  await stageClient.setStageDestination({ stageId: stageId!, destinationId: sd.destinationId });
                                } else {
                                  await stageClient.removeStageDestination({ stageId: stageId!, destinationId: sd.destinationId });
                                }
                                await refresh();
                              } catch { /* ignore */ }
                            }}
                          />
                        ) : (
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7 text-muted-foreground hover:text-destructive shrink-0"
                            onClick={async () => {
                              try {
                                await stageClient.removeStageDestination({ stageId: stageId!, destinationId: sd.destinationId });
                                await refresh();
                              } catch { /* ignore */ }
                            }}
                          >
                            <XIcon className="h-3.5 w-3.5" />
                          </Button>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
              {/* Add destination — show unlinked user destinations */}
              {(() => {
                const linkedIds = new Set(stage.destinations.map((sd) => sd.destinationId));
                const unlinked = destinations.filter((d) => !linkedIds.has(d.id));
                if (unlinked.length > 0) {
                  return (
                    <Select
                      value=""
                      onValueChange={async (val) => {
                        try {
                          await stageClient.setStageDestination({ stageId: stageId!, destinationId: val });
                          await refresh();
                        } catch { /* ignore */ }
                      }}
                    >
                      <SelectTrigger className="w-full">
                        <SelectValue placeholder="Add destination..." />
                      </SelectTrigger>
                      <SelectContent>
                        {unlinked.map((d) => (
                          <SelectItem key={d.id} value={d.id}>
                            {d.name || d.platformUsername || d.platform} ({d.platform})
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  );
                }
                if (destinations.length === 0) {
                  return (
                    <Button size="sm" className="font-semibold text-sm" asChild>
                      <Link to="/destinations">
                        Add a streaming destination
                        <ArrowUpRight className="h-3 w-3 ml-1" />
                      </Link>
                    </Button>
                  );
                }
                return null;
              })()}
              <div className="flex flex-col gap-1.5 mt-3">
                <Button variant="link" size="sm" className="text-sm text-muted-foreground hover:text-primary h-auto p-0 justify-start" asChild>
                  <Link to="/destinations">
                    Manage destinations
                    <ArrowUpRight className="h-3 w-3 ml-1" />
                  </Link>
                </Button>
              </div>
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
                <div key={i} className={cn("group/cmd", i > 0 && "mt-2.5")}>
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
      </>
      )}
    </AnimatedPage>
  );
}
