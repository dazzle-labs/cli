import { useEffect, useRef, useCallback, useState } from "react";
import { useParams } from "react-router-dom";
import Hls from "hls.js";

type StreamState = "connecting" | "live" | "offline";

const STALE_TIMEOUT_MS = 5000;

export function WatchPage() {
  const { slug } = useParams<{ slug: string }>();
  const videoRef = useRef<HTMLVideoElement>(null);
  const hlsRef = useRef<Hls | null>(null);
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const staleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastFragTimeRef = useRef<number>(0);
  const [streamState, setStreamState] = useState<StreamState>("connecting");

  const clearStaleTimer = useCallback(() => {
    if (staleTimerRef.current) {
      clearTimeout(staleTimerRef.current);
      staleTimerRef.current = null;
    }
  }, []);

  const resetStaleTimer = useCallback(() => {
    clearStaleTimer();
    staleTimerRef.current = setTimeout(() => {
      setStreamState("offline");
    }, STALE_TIMEOUT_MS);
  }, [clearStaleTimer]);

  const destroyHls = useCallback(() => {
    if (retryTimerRef.current) {
      clearTimeout(retryTimerRef.current);
      retryTimerRef.current = null;
    }
    clearStaleTimer();
    if (hlsRef.current) {
      hlsRef.current.destroy();
      hlsRef.current = null;
    }
  }, [clearStaleTimer]);

  useEffect(() => {
    if (!slug || !videoRef.current) return;

    const hlsUrl = `/watch/${slug}/index.m3u8`;

    if (!Hls.isSupported()) {
      const video = videoRef.current;
      video.src = hlsUrl;
      return () => {
        video.src = "";
        video.load();
      };
    }

    function initHls() {
      if (!videoRef.current) return;

      const hls = new Hls({
        liveSyncDurationCount: 1,
        liveMaxLatencyDurationCount: 3,
        maxBufferLength: 3,
        backBufferLength: 3,
        lowLatencyMode: true,
      });

      hls.loadSource(hlsUrl);
      hls.attachMedia(videoRef.current);

      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        videoRef.current?.play().catch(() => {});
      });

      hls.on(Hls.Events.FRAG_LOADED, () => {
        lastFragTimeRef.current = Date.now();
        setStreamState("live");
        resetStaleTimer();
      });

      hls.on(Hls.Events.ERROR, (_event, data) => {
        if (data.fatal) {
          // If we never received a fragment, this is an immediate offline
          // (manifest 404/503). If we were live, the stale timer handles it.
          if (lastFragTimeRef.current === 0) {
            setStreamState("offline");
          }
          destroyHls();
          retryTimerRef.current = setTimeout(() => {
            initHls();
          }, 3000);
        }
      });

      hlsRef.current = hls;
    }

    initHls();
    return destroyHls;
  }, [slug, destroyHls, resetStaleTimer]);

  if (!slug) {
    return (
      <div className="flex items-center justify-center h-screen bg-[#0a0a0a]">
        <p className="text-zinc-500 text-lg">Invalid watch link.</p>
      </div>
    );
  }

  return (
    <div className="relative flex items-center justify-center h-screen bg-[#0a0a0a]">
      <video
        ref={videoRef}
        className={`max-w-full max-h-screen bg-black ${streamState !== "live" ? "hidden" : ""}`}
        autoPlay
        muted
        playsInline
        controls
      />
      {streamState !== "live" && <OfflineOverlay state={streamState} />}
    </div>
  );
}

function OfflineOverlay({ state }: { state: "connecting" | "offline" }) {
  return (
    <div className="flex flex-col items-center gap-4 text-zinc-500 select-none">
      {state === "connecting" ? (
        <>
          <div className="size-10 rounded-full border-2 border-zinc-700 border-t-zinc-400 animate-spin" />
          <p className="text-sm tracking-wide">Connecting...</p>
        </>
      ) : (
        <>
          <div className="flex items-center gap-2">
            <div className="size-2.5 rounded-full bg-zinc-600" />
            <p className="text-lg font-medium text-zinc-400">Stream is offline</p>
          </div>
          <p className="text-sm">Waiting for stream — will connect automatically</p>
        </>
      )}
    </div>
  );
}
