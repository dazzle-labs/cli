import { useEffect, useState } from "react";
import { stageClient } from "@/client";
import { StageFilter } from "@/gen/api/v1/stage_pb";

// Module-level cache so the count survives component remounts during routing.
let cachedCount = 0;

/** Poll the number of live stages every 30s. Persists across remounts. */
export function useLiveCount(): number {
  const [count, setCount] = useState(cachedCount);

  useEffect(() => {
    let cancelled = false;

    function poll() {
      stageClient
        .listStages({ filters: [StageFilter.LIVE] })
        .then((res) => {
          if (cancelled) return;
          const n = res.stages.filter((s) => s.slug).length;
          cachedCount = n;
          setCount(n);
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
