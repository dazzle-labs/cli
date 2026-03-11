import { useEffect, useRef, useCallback } from "react";
import { motion } from "motion/react";
import { useAuth } from "@clerk/react";
import Hls from "hls.js";
import { springs } from "@/lib/motion";

interface StreamPreviewProps {
  stageId: string;
  status: "starting" | "running" | "stopped";
}

export function StreamPreview({ stageId, status }: StreamPreviewProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const hlsRef = useRef<Hls | null>(null);
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const { getToken } = useAuth();

  const destroyHls = useCallback(() => {
    if (retryTimerRef.current) {
      clearTimeout(retryTimerRef.current);
      retryTimerRef.current = null;
    }
    if (hlsRef.current) {
      hlsRef.current.destroy();
      hlsRef.current = null;
    }
  }, []);

  useEffect(() => {
    if (status !== "running" || !videoRef.current) return;

    const hlsUrl = `/stage/${stageId}/hls/stream.m3u8`;

    if (!Hls.isSupported()) {
      // Safari native HLS — no custom headers possible, best-effort
      const video = videoRef.current;
      video.src = hlsUrl;
      return () => {
        video.src = "";
        video.load();
      };
    }

    // Pre-fetch the token so xhrSetup can use it synchronously
    let authToken: string | null = null;

    async function initHls() {
      authToken = await getToken();

      if (!videoRef.current) return;

      const hls = new Hls({
        liveSyncDurationCount: 1,
        liveMaxLatencyDurationCount: 3,
        maxBufferLength: 3,
        backBufferLength: 3,
        lowLatencyMode: true,
        xhrSetup: (xhr) => {
          if (authToken) {
            xhr.setRequestHeader("Authorization", `Bearer ${authToken}`);
          }
        },
      });

      hls.loadSource(hlsUrl);
      hls.attachMedia(videoRef.current);
      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        videoRef.current?.play().catch(() => {});
      });

      hls.on(Hls.Events.ERROR, (_event, data) => {
        if (data.fatal) {
          destroyHls();
          // Retry after 3s — but don't loop via state/effect
          retryTimerRef.current = setTimeout(() => {
            initHls();
          }, 3000);
        }
      });

      hlsRef.current = hls;
    }

    initHls();

    return destroyHls;
  }, [stageId, status, getToken, destroyHls]);

  if (status === "starting") {
    return (
      <div className="aspect-video rounded-xl bg-card border border-border flex items-center justify-center overflow-hidden relative">
        <div className="absolute inset-0 bg-gradient-to-r from-transparent via-muted/40 to-transparent animate-pulse" />
        <p className="text-base text-muted-foreground z-10">
          Starting up...
        </p>
      </div>
    );
  }

  if (status !== "running") {
    return (
      <div className="aspect-video rounded-xl bg-card border border-border flex items-center justify-center relative overflow-hidden">
        {/* Animated gradient border hint */}
        <div className="absolute inset-0 rounded-xl ring-1 ring-inset ring-emerald-500/10 animate-live-pulse" />
        <p className="text-base text-muted-foreground text-center px-8 leading-relaxed">
          Your stage is dark.
          <br />
          It'll light up when the stage is activated.
        </p>
      </div>
    );
  }

  return (
    <motion.div
      className="aspect-video rounded-xl bg-card border border-border overflow-hidden"
      initial={{ scale: 0.97, opacity: 0 }}
      animate={{ scale: 1, opacity: 1 }}
      transition={springs.gentle}
    >
      <video
        ref={videoRef}
        className="w-full h-full object-contain bg-black"
        autoPlay
        muted
        playsInline
      />
    </motion.div>
  );
}
