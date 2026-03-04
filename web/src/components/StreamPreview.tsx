import { useEffect, useRef, useCallback } from "react";
import { useAuth } from "@clerk/clerk-react";
import Hls from "hls.js";

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

    // Pre-fetch the token for both Safari native HLS and HLS.js
    let authToken: string | null = null;

    async function initHls() {
      authToken = await getToken();

      if (!videoRef.current) return;

      const tokenQS = authToken ? `?token=${encodeURIComponent(authToken)}` : "";
      const hlsUrl = `/stage/${stageId}/hls/stream.m3u8${tokenQS}`;

      if (!Hls.isSupported()) {
        // Safari native HLS — token in query string is the only option
        const video = videoRef.current;
        video.src = hlsUrl;
        return;
      }

      const hls = new Hls({
        liveSyncDurationCount: 3,
        liveMaxLatencyDurationCount: 6,
        maxBufferLength: 5,
        lowLatencyMode: true,
        xhrSetup: (xhr, url) => {
          // For segment requests (.ts), add auth header.
          // The manifest URL already has the token in the query string.
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
          hls.destroy();
          hlsRef.current = null;
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

  if (status !== "running") {
    return (
      <div className="aspect-video rounded-xl bg-zinc-900 border border-white/[0.06] flex items-center justify-center">
        <p
          className="text-sm text-zinc-600 text-center px-8 leading-relaxed"
          style={{ fontFamily: "'Outfit', sans-serif" }}
        >
          Your agent's stage is dark.
          <br />
          It'll light up when your agent connects.
        </p>
      </div>
    );
  }

  return (
    <div className="aspect-video rounded-xl bg-zinc-900 border border-white/[0.06] overflow-hidden">
      <video
        ref={videoRef}
        className="w-full h-full object-contain bg-black"
        autoPlay
        muted
        playsInline
      />
    </div>
  );
}
