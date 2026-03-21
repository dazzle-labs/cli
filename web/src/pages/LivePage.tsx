import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { motion } from "motion/react";
import { stageClient } from "@/client";
import type { Stage } from "@/gen/api/v1/stage_pb";
import { StageFilter } from "@/gen/api/v1/stage_pb";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Radio } from "lucide-react";
import { Spinner } from "@/components/ui/spinner";
import { StageThumbnail } from "@/components/StageThumbnail";
import { AnimatedPage } from "@/components/AnimatedPage";
import { AnimatedList, AnimatedListItem } from "@/components/AnimatedList";
import { springs } from "@/lib/motion";

export function LivePage() {
  const [streams, setStreams] = useState<Stage[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    function poll() {
      stageClient
        .listStages({ filters: [StageFilter.LIVE] })
        .then((res) => {
          if (cancelled) return;
          setStreams(res.stages.filter((s) => s.slug));
          setLoading(false);
        })
        .catch(() => setLoading(false));
    }

    poll();
    const interval = setInterval(poll, 30_000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  return (
    <AnimatedPage>
      <div className="mb-8">
        <div className="flex items-center gap-3">
          <h1 className="text-3xl tracking-[-0.02em] text-foreground font-display">
            Live Now
          </h1>
          {streams.length > 0 && (
            <span className="relative flex h-2.5 w-2.5">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-red-400 opacity-75" />
              <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-red-500" />
            </span>
          )}
        </div>
        <p className="text-base text-muted-foreground mt-1">
          Stages currently broadcasting.
        </p>
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
                  <Card className="transition-colors duration-200 hover:border-red-500/20 hover:bg-red-500/[0.02] overflow-hidden border-l-2 border-l-red-500/40">
                    <div className="relative aspect-video bg-black overflow-hidden">
                      <StageThumbnail slug={stage.slug} />
                      <div className="absolute top-2.5 left-2.5">
                        <Badge className="bg-red-500/90 text-white border-0 gap-1 text-[11px]">
                          <Radio className="h-3 w-3" />
                          LIVE
                        </Badge>
                      </div>
                    </div>
                    <CardContent className="px-4 py-3">
                      <span className="text-sm font-medium text-foreground truncate block">
                        {stage.name}
                      </span>
                    </CardContent>
                  </Card>
                </motion.div>
              </Link>
            </AnimatedListItem>
          ))}
        </AnimatedList>
      )}
    </AnimatedPage>
  );
}
