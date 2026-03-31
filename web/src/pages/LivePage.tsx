import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { motion } from "motion/react";
import { stageClient } from "@/client";
import type { Stage } from "@/gen/api/v1/stage_pb";
import { StageFilter } from "@/gen/api/v1/stage_pb";
import { Spinner } from "@/components/ui/spinner";
import { StageThumbnail } from "@/components/StageThumbnail";
import { StageCardMenu } from "@/components/StageCardMenu";
import { AnimatedPage } from "@/components/AnimatedPage";
import { AnimatedList, AnimatedListItem } from "@/components/AnimatedList";
import { useIsDeveloper } from "@/hooks/use-is-developer";
import { springs } from "@/lib/motion";

export function LivePage() {
  const [streams, setStreams] = useState<Stage[]>([]);
  const [loading, setLoading] = useState(true);
  const isDev = useIsDeveloper();

  const poll = useCallback(() => {
    stageClient
      .listStages({ filters: [StageFilter.LIVE] })
      .then((res) => {
        setStreams(res.stages.filter((s) => s.slug));
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  useEffect(() => {
    poll();
    const interval = setInterval(poll, 30_000);
    return () => clearInterval(interval);
  }, [poll]);

  return (
    <AnimatedPage>
      <div className="mb-8">
        <h1 className="text-3xl tracking-[-0.02em] text-foreground font-display">
          Live
        </h1>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-12">
          <Spinner className="text-primary" />
        </div>
      ) : streams.length === 0 ? (
        <div className="flex flex-col items-center pt-24">
          <p className="text-base text-muted-foreground">
            No one is live right now.
          </p>
        </div>
      ) : (
        <AnimatedList className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {streams.map((stage) => (
            <AnimatedListItem key={stage.slug}>
              <Link to={`/watch/${stage.slug}`} target="_blank" className="group">
                <motion.div
                  whileHover={{ y: -2 }}
                  whileTap={{ scale: 0.98 }}
                  transition={springs.quick}
                >
                  <div className="rounded-xl border border-white/[0.08] bg-white/[0.015] overflow-hidden transition-colors duration-300 hover:border-emerald-500/20 hover:bg-emerald-500/[0.01]">
                    <div className="relative aspect-video bg-black">
                      <StageThumbnail slug={stage.slug} />
                      {isDev && (
                        <StageCardMenu
                          stageId={stage.slug}
                          stageName={stage.name}
                          onDeleted={poll}
                        />
                      )}
                    </div>
                    <div className="px-4 py-3">
                      <h3 className="text-sm font-medium text-white truncate">
                        {stage.name}
                      </h3>
                    </div>
                  </div>
                </motion.div>
              </Link>
            </AnimatedListItem>
          ))}
        </AnimatedList>
      )}
    </AnimatedPage>
  );
}
