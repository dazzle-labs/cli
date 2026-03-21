import { useEffect, useRef, useState, useCallback } from "react";
import { Link } from "react-router-dom";
import Hls from "hls.js";
import { Radio } from "lucide-react";
import { featuredClient } from "@/client";

interface FeaturedData {
  slug: string;
  title: string;
  category: string;
}

export function useFeaturedStream() {
  const [data, setData] = useState<FeaturedData | null>(null);

  useEffect(() => {
    let cancelled = false;
    featuredClient.getFeatured({}).then((res) => {
      if (!cancelled && res.live) {
        setData({ slug: res.slug, title: res.title, category: res.category });
      }
    }).catch(() => {});
    return () => { cancelled = true; };
  }, []);

  return data;
}

export function FeaturedStreamCard({ data }: { data: FeaturedData }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const hlsRef = useRef<Hls | null>(null);
  const [playing, setPlaying] = useState(false);

  const initHls = useCallback(() => {
    if (!videoRef.current) return;
    const hlsUrl = `/watch/${data.slug}/index.m3u8`;

    if (!Hls.isSupported()) {
      videoRef.current.src = hlsUrl;
      videoRef.current.play().catch(() => {});
      setPlaying(true);
      return;
    }

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
      setPlaying(true);
    });
    hls.on(Hls.Events.ERROR, (_e, d) => {
      if (d.fatal) {
        hls.destroy();
        hlsRef.current = null;
        setPlaying(false);
      }
    });
    hlsRef.current = hls;
  }, [data]);

  useEffect(() => {
    initHls();
    return () => {
      hlsRef.current?.destroy();
      hlsRef.current = null;
    };
  }, [initHls]);

  return (
    <Link
      to={`/watch/${data.slug}`}
      className="block group rounded-xl border border-white/[0.08] overflow-hidden transition-all duration-500 hover:border-emerald-500/15"
    >
      <div className="relative aspect-video bg-black">
        <video
          ref={videoRef}
          className={`w-full h-full object-contain ${!playing ? "opacity-0" : ""}`}
          autoPlay
          muted
          playsInline
        />
        {!playing && (
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="size-6 rounded-full border-2 border-zinc-700 border-t-zinc-400 animate-spin" />
          </div>
        )}
      </div>
      <div className="flex items-center gap-2.5 px-4 py-2.5 bg-white/[0.02]">
        <span className="relative flex items-center gap-1.5 text-red-400">
          <span className="absolute -left-0.5 size-2.5 rounded-full bg-red-400/40 animate-ping" />
          <Radio className="relative h-3.5 w-3.5" />
          <span className="text-xs font-medium uppercase tracking-wide">Live</span>
        </span>
        <span className="text-sm text-white font-medium truncate">
          {data.title}
        </span>
        {data.category && (
          <span className="text-xs text-zinc-500 ml-auto shrink-0">
            {data.category}
          </span>
        )}
      </div>
    </Link>
  );
}
