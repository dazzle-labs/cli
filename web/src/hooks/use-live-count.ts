import { useEffect, useState } from "react";
import { stageClient } from "@/client";
import { StageFilter } from "@/gen/api/v1/stage_pb";

/** Poll the number of live stages every 30s. Returns 0 while loading. */
export function useLiveCount(): number {
  const [count, setCount] = useState(0);

  useEffect(() => {
    let cancelled = false;

    function poll() {
      stageClient
        .listStages({ filters: [StageFilter.LIVE] })
        .then((res) => {
          if (!cancelled) setCount(res.stages.filter((s) => s.slug).length);
        })
        .catch(() => {});
    }

    poll();
    const interval = setInterval(poll, 30_000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  return count;
}
