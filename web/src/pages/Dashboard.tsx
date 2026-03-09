import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { stageClient, streamClient } from "../client.js";
import type { Stage } from "../gen/api/v1/stage_pb.js";
import type { StreamDestination } from "../gen/api/v1/stream_pb.js";
import { timestampDate } from "@bufbuild/protobuf/wkt";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Radio, X, Loader2, ArrowRight, Monitor } from "lucide-react";
import { OnboardingWizard } from "@/components/onboarding/OnboardingWizard";
import { toast } from "sonner";
import { Spinner } from "@/components/ui/spinner";
import { Alert, AlertTitle, AlertAction } from "@/components/ui/alert";
import {
  Empty,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
  EmptyDescription,
  EmptyContent,
} from "@/components/ui/empty";

export function Dashboard() {
  const [stages, setStages] = useState<Stage[]>([]);
  const [destinations, setDestinations] = useState<StreamDestination[]>([]);
  const [loading, setLoading] = useState(true);

  const [creatingStage, setCreatingStage] = useState(false);
  const [wizardOpen, setWizardOpen] = useState(false);

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
  }, []);

  function dismissBanner() {
    setBannerDismissed(true);
    localStorage.setItem("dazzle-stream-banner-dismissed", "true");
  }

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-muted-foreground text-sm pt-12">
        <Spinner className="text-primary" />
        Loading stages...
      </div>
    );
  }

  async function handleCreateStage() {
    setCreatingStage(true);
    try {
      await stageClient.createStage({ name: "" });
      await refresh();
      toast.success("Stage created");
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
    <div>
      {/* Streaming banner */}
      {showStreamBanner && (
        <Alert className="mb-6 border-primary/20 bg-primary/[0.04]">
          <Radio className="h-4 w-4 text-primary" />
          <AlertTitle className="text-foreground">
            Your agent has a stage. Ready to open the curtains?
          </AlertTitle>
          <AlertAction>
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                className="font-semibold text-xs"
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
      )}

      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-3xl tracking-[-0.02em] text-foreground mb-1 font-display">
            Stages
          </h1>
          <p className="text-sm text-muted-foreground">
            Cloud environments your agents can control and broadcast from.
          </p>
        </div>
        {stages.length > 0 && (
          <Button
            onClick={handleCreateStage}
            disabled={creatingStage}
            variant="ghost"
            size="sm"
            className="text-muted-foreground hover:text-primary hover:bg-primary/10"
          >
            {creatingStage ? (
              <Loader2 className="h-4 w-4 animate-spin mr-1" />
            ) : null}
            New stage
          </Button>
        )}
      </div>

      {/* Onboarding wizard overlay */}
      <OnboardingWizard
        open={wizardOpen}
        onClose={() => {
          setWizardOpen(false);
          refresh();
        }}
      />

      {/* Stages grid */}
      {stages.length === 0 ? (
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <Monitor className="h-7 w-7" />
            </EmptyMedia>
            <EmptyTitle>No stages yet</EmptyTitle>
            <EmptyDescription>Create one to get started.</EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <Button
              onClick={() => setWizardOpen(true)}
              className="font-semibold"
            >
              Get Started
            </Button>
          </EmptyContent>
        </Empty>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {stages.map((stage) => (
            <Link key={stage.id} to={`/stage/${stage.id}`} className="group">
              <Card className="transition-all duration-200 hover:border-primary/15 hover:bg-primary/[0.02]">
                <CardContent className="p-5">
                  <div className="flex items-center justify-between mb-3">
                    <span className="text-sm font-medium text-foreground">
                      {stage.name || "default"}
                    </span>
                    <Badge
                      variant={
                        stage.status === "running"
                          ? "success"
                          : stage.status === "starting"
                            ? "warning"
                            : "secondary"
                      }
                    >
                      {stage.status === "running"
                        ? "active"
                        : stage.status || "inactive"}
                    </Badge>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-muted-foreground">
                      {stage.createdAt
                        ? timestampDate(stage.createdAt).toLocaleDateString()
                        : ""}
                    </span>
                    <span className="flex items-center gap-1 text-xs text-muted-foreground group-hover:text-primary transition-colors">
                      View details
                      <ArrowRight className="h-3 w-3" />
                    </span>
                  </div>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
