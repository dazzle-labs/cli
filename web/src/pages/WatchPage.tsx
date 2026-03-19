import { useEffect, useRef, useCallback } from "react";
import { useParams } from "react-router-dom";
import Hls from "hls.js";

export function WatchPage() {
  const { slug } = useParams<{ slug: string }>();
  const videoRef = useRef<HTMLVideoElement>(null);
  const hlsRef = useRef<Hls | null>(null);
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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
    if (!slug || !videoRef.current) return;

    const hlsUrl = `/watch/${slug}/hls/stream.m3u8`;

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

      hls.on(Hls.Events.ERROR, (_event, data) => {
        if (data.fatal) {
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
  }, [slug, destroyHls]);

  if (!slug) {
    return (
      <div className="flex items-center justify-center h-screen bg-[#0a0a0a]">
        <p className="text-zinc-500 text-lg">Invalid watch link.</p>
      </div>
    );
  }

  return (
    <div className="flex items-center justify-center h-screen bg-[#0a0a0a]">
      <video
        ref={videoRef}
        className="max-w-full max-h-screen bg-black"
        autoPlay
        muted
        playsInline
        controls
      />
    </div>
  );
}
