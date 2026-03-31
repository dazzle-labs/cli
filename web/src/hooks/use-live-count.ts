import { create } from "zustand";
import { stageClient } from "@/client";
import { StageFilter } from "@/gen/api/v1/stage_pb";

interface LiveCountState {
  count: number;
}

const useLiveCountStore = create<LiveCountState>()(() => ({ count: 0 }));

// Single global poller — starts once, never tears down.
let polling = false;

function startPolling() {
  if (polling) return;
  polling = true;

  function poll() {
    stageClient
      .listStages({ filters: [StageFilter.LIVE] })
      .then((res) => {
        useLiveCountStore.setState({
          count: res.stages.filter((s) => s.slug).length,
        });
      })
      .catch(() => {});
  }

  poll();
  setInterval(poll, 30_000);
}

/** Returns the number of live stages. Polling starts on first call. */
export function useLiveCount(): number {
  startPolling();
  return useLiveCountStore((s) => s.count);
}
