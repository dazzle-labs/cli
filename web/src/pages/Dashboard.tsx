import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { cn } from "@/lib/utils";
import { motion, AnimatePresence } from "motion/react";
import { stageClient, streamClient } from "../client.js";
import type { Stage } from "../gen/api/v1/stage_pb.js";
import type { StreamDestination } from "../gen/api/v1/stream_pb.js";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Radio, X, Loader2, Rocket, Plus, Zap } from "lucide-react";
import { Spinner } from "@/components/ui/spinner";
import { OnboardingWizard } from "@/components/onboarding/OnboardingWizard";
import { toast } from "sonner";
import { Alert, AlertTitle, AlertAction } from "@/components/ui/alert";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { AnimatedPage } from "@/components/AnimatedPage";
import { AnimatedList, AnimatedListItem } from "@/components/AnimatedList";
import { StageThumbnail } from "@/components/StageThumbnail";
import { springs, fadeInUp } from "@/lib/motion";

export function Dashboard() {
  const [stages, setStages] = useState<Stage[]>([]);
  const [destinations, setDestinations] = useState<StreamDestination[]>([]);
  const [loading, setLoading] = useState(true);

  const [createOpen, setCreateOpen] = useState(false);
  const [createName, setCreateName] = useState("");
  const [createGPU, setCreateGPU] = useState(false);
  const [creatingStage, setCreatingStage] = useState(false);
  const [wizardOpen, setWizardOpen] = useState(false);
  const [wizardSkipIntro, setWizardSkipIntro] = useState(false);

  // Streaming banner
  const [bannerDismissed, setBannerDismissed] = useState(
    () => localStorage.getItem("dazzle-stream-banner-dismissed") === "true"
  );

  async function refresh() {
    try {
      const [stageResp, streamResp] = await Promise.all([
        stageClient.listStages({}),
        streamClient.listStreamDestinations({}),
      ]);
      setStages(stageResp.stages);
      setDestinations(streamResp.destinations);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refresh();

    // Handle OAuth callback redirect (onboarding flow)
    const searchParams = new URLSearchParams(window.location.search);
    const connected = searchParams.get("connected");
    const onboarding = searchParams.get("onboarding");
    if (connected) {
      toast.success(`Connected to ${connected.charAt(0).toUpperCase() + connected.slice(1)}!`);
    }
    if (onboarding === "true") {
      setWizardSkipIntro(true);
      setWizardOpen(true);
    }
    if (connected || onboarding) {
      window.history.replaceState(null, "", "/");
    }
  }, []);

  function dismissBanner() {
    setBannerDismissed(true);
    localStorage.setItem("dazzle-stream-banner-dismissed", "true");
  }

  const navigate = useNavigate();

  async function handleCreateStage() {
    setCreatingStage(true);
    try {
      const resp = await stageClient.createStage({
        name: createName.trim(),
        capabilities: createGPU ? ["gpu"] : [],
      });
      if (resp.stage) {
        setCreateOpen(false);
        setCreateName("");
        setCreateGPU(false);
        navigate(`/stage/${resp.stage.slug || resp.stage.id}`);
      }
    } catch {
      // ignore
    } finally {
      setCreatingStage(false);
    }
  }

  const activeStageCount = stages.filter((s) => s.status !== "inactive").length;
  const hasStreamDests = destinations.length > 0;
  const showStreamBanner = activeStageCount > 0 && !hasStreamDests && !bannerDismissed;

  return (
    <AnimatedPage>
      {/* Streaming banner */}
      <AnimatePresence>
        {showStreamBanner && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            transition={springs.snappy}
          >
            <Alert className="mb-6 border-primary/20 bg-primary/[0.04]">
              <Radio className="h-4 w-4 text-primary" />
              <AlertTitle className="text-foreground">
                Your agent has a stage. Ready to open the curtains?
              </AlertTitle>
              <AlertAction>
                <div className="flex items-center gap-2">
                  <Button
                    size="sm"
                    className="font-semibold text-sm"
                    asChild
                  >
                    <Link to="/destinations">Set up streaming</Link>
                  </Button>
                  <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-foreground" onClick={dismissBanner} aria-label="Dismiss">
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              </AlertAction>
            </Alert>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Header */}
      <div className="mb-8">
        <div className="flex items-center justify-between">
          <h1 className="text-3xl tracking-[-0.02em] text-foreground font-display">
            Stages
          </h1>
          {stages.length > 0 && (
            <Button
              onClick={() => setCreateOpen(true)}
              variant="outline"
              size="sm"
              className="text-primary border-primary/25 hover:bg-primary/10 hover:border-primary/40"
            >
              <Plus className="h-4 w-4" />
              <span className="sm:hidden">Create</span>
              <span className="hidden sm:inline">Create Stage</span>
            </Button>
          )}
        </div>
        <p className="text-base text-muted-foreground mt-1 max-w-[70%] sm:max-w-none">
          Cloud environments your agents can control and broadcast from.
        </p>
      </div>

      {/* Create stage dialog */}
      <Dialog open={createOpen} onOpenChange={(open) => {
        setCreateOpen(open);
        if (!open) { setCreateName(""); setCreateGPU(false); }
      }}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Create Stage</DialogTitle>
            <DialogDescription>
              A cloud environment your AI agent can control.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-2">
              <Label htmlFor="stage-name">Name</Label>
              <Input
                id="stage-name"
                placeholder="my-stage"
                value={createName}
                onChange={(e) => setCreateName(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") handleCreateStage(); }}
              />
            </div>
            <div className="flex items-center justify-between rounded-lg border p-3">
              <div className="flex items-center gap-2">
                <Zap className="h-4 w-4 text-amber-500" />
                <Label htmlFor="gpu-toggle" className="cursor-pointer font-normal">GPU-accelerated</Label>
              </div>
              <Switch id="gpu-toggle" checked={createGPU} onCheckedChange={setCreateGPU} />
            </div>
          </div>
          <DialogFooter>
            <Button onClick={handleCreateStage} disabled={creatingStage}>
              {creatingStage && <Loader2 className="h-4 w-4 animate-spin" />}
              Create
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Onboarding wizard overlay */}
      <OnboardingWizard
        open={wizardOpen}
        skipIntro={wizardSkipIntro}
        onClose={() => {
          setWizardOpen(false);
          setWizardSkipIntro(false);
          refresh();
        }}
      />

      {/* Stages grid */}
      {loading ? (
        <div className="flex items-center justify-center py-12">
          <Spinner className="text-primary" />
        </div>
      ) : stages.length === 0 ? (
        <motion.div
          className="flex flex-col items-center pt-24"
          variants={fadeInUp}
          initial="hidden"
          animate="visible"
          transition={springs.gentle}
        >
          <h2 className="text-xl font-display text-foreground mb-2">
            Give your agent a stage
          </h2>
          <p className="text-base text-muted-foreground mb-6 max-w-sm text-center">
            A cloud environment your AI agent can control and stream from.
          </p>
          <Button
            onClick={() => setWizardOpen(true)}
            className="font-semibold"
            size="lg"
          >
            <Rocket className="h-4 w-4 mr-2" />
            Get Started
          </Button>
        </motion.div>
      ) : (
        <AnimatedList className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {stages.map((stage) => {
            const isRunning = stage.status === "running";
            const isStarting = stage.status === "starting";
            return (
              <AnimatedListItem key={stage.id}>
                <Link to={`/stage/${stage.slug || stage.id}`} className="group">
                  <motion.div
                    whileHover={{ y: -2 }}
                    whileTap={{ scale: 0.98 }}
                    transition={springs.quick}
                  >
                    <Card className={cn("transition-colors duration-200 hover:border-primary/15 hover:bg-primary/[0.02] overflow-hidden", isRunning && "border-l-2 border-l-emerald-500/40")}>
                      <div className="relative aspect-video bg-black/60 overflow-hidden">
                        {isRunning ? (
                          <StageThumbnail stageId={stage.id} />
                        ) : (
                          <div className="absolute inset-0 flex items-center justify-center">
                            <div className="text-zinc-700 text-xs uppercase tracking-widest">
                              {isStarting ? "Starting..." : "Offline"}
                            </div>
                          </div>
                        )}
                        {/* Badges overlay */}
                        <div className="absolute top-2.5 right-2.5 flex items-center gap-1.5">
                          {stage.capabilities.includes("gpu") && (
                            <Badge variant="outline" className="text-amber-500 border-amber-500/30 bg-black/60 backdrop-blur-sm gap-1 px-1.5 text-[11px]">
                              <Zap className="h-3 w-3" />
                              GPU
                            </Badge>
                          )}
                          <Badge
                            variant={isRunning ? "success" : isStarting ? "warning" : "secondary"}
                            className="bg-black/60 backdrop-blur-sm text-[11px]"
                          >
                            {(isRunning || isStarting) && (
                              <span className="relative flex h-1.5 w-1.5 mr-1">
                                <span className={cn("animate-ping absolute inline-flex h-full w-full rounded-full opacity-75", isRunning ? "bg-emerald-400" : "bg-amber-400")} />
                                <span className={cn("relative inline-flex rounded-full h-1.5 w-1.5", isRunning ? "bg-emerald-500" : "bg-amber-500")} />
                              </span>
                            )}
                            {isRunning ? "active" : stage.status || "inactive"}
                          </Badge>
                        </div>
                      </div>
                      <CardContent className="px-4 py-3">
                        <span className="text-sm font-medium text-foreground truncate block">
                          {stage.name || "Untitled Stage"}
                        </span>
                      </CardContent>
                    </Card>
                  </motion.div>
                </Link>
              </AnimatedListItem>
            );
          })}
        </AnimatedList>
      )}
    </AnimatedPage>
  );
}
