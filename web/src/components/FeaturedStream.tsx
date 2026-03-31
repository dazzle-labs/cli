import { useEffect, useRef, useState, useCallback } from "react";
import { Link } from "react-router-dom";
import Hls from "hls.js";
import { Volume2, VolumeOff, ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { featuredClient } from "@/client";
import type { FeaturedStream as FeaturedStreamProto } from "@/gen/api/v1/featured_pb";

export interface FeaturedData {
  slug: string;
  title: string;
  category: string;
}

export function useFeaturedStreams() {
  const [data, setData] = useState<FeaturedData[]>([]);

  useEffect(() => {
    let cancelled = false;
    featuredClient.getFeatured({}).then((res) => {
      if (!cancelled && res.streams.length > 0) {
        setData(res.streams.map((s: FeaturedStreamProto) => ({
          slug: s.slug,
          title: s.title,
          category: s.category,
        })));
      }
    }).catch(() => {});
    return () => { cancelled = true; };
  }, []);

  return data;
}

/** Backwards-compat: returns first stream or null */
export function useFeaturedStream() {
  const streams = useFeaturedStreams();
  return streams.length > 0 ? streams[0] : null;
}

const ROTATE_INTERVAL = 8000;

export function FeaturedCarousel({ streams }: { streams: FeaturedData[] }) {
  const [active, setActive] = useState(0);
  const paused = useRef(false);

  const goNext = useCallback(() => setActive((i) => (i + 1) % streams.length), [streams.length]);
  const goPrev = useCallback(() => setActive((i) => (i - 1 + streams.length) % streams.length), [streams.length]);

  useEffect(() => {
    if (streams.length <= 1) return;
    const id = setInterval(() => {
      if (!paused.current) goNext();
    }, ROTATE_INTERVAL);
    return () => clearInterval(id);
  }, [streams.length, goNext]);

  if (streams.length === 0) return null;

  // Single stream — no coverflow needed
  if (streams.length === 1) {
    return (
      <div className="w-full">
        <FeaturedStreamCard data={streams[0]} />
      </div>
    );
  }

  return (
    <div
      className="w-full"
      style={{ perspective: "1200px" }}
      onMouseEnter={() => { paused.current = true; }}
      onMouseLeave={() => { paused.current = false; }}
    >
      <div className="relative flex items-center justify-center" style={{ height: "clamp(280px, 40vw, 440px)" }}>
        {streams.map((s, i) => {
          const offset = i - active;
          // Wrap around for circular positioning
          const half = streams.length / 2;
          let wrapped = offset;
          if (wrapped > half) wrapped -= streams.length;
          if (wrapped < -half) wrapped += streams.length;

          const isCenter = wrapped === 0;
          const isVisible = Math.abs(wrapped) <= 2;

          if (!isVisible) return null;

          const translateX = isCenter ? 0 : wrapped * 260;
          const translateZ = isCenter ? 0 : -200;
          const rotateY = isCenter ? 0 : wrapped < 0 ? 35 : -35;
          const scale = isCenter ? 1 : 0.65;
          const zIndex = isCenter ? 10 : 5 - Math.abs(wrapped);
          const opacity = isCenter ? 1 : Math.abs(wrapped) === 1 ? 0.7 : 0.4;

          return (
            <div
              key={s.slug}
              className={cn(
                "absolute transition-all duration-500 ease-out",
                isCenter ? "w-[min(600px,80vw)]" : "w-[min(600px,80vw)] cursor-pointer"
              )}
              style={{
                transform: `translateX(${translateX}px) translateZ(${translateZ}px) rotateY(${rotateY}deg) scale(${scale})`,
                zIndex,
                opacity,
                transformStyle: "preserve-3d",
              }}
              onClick={isCenter ? undefined : () => setActive(i)}
            >
              {isCenter ? (
                <FeaturedStreamCard data={s} />
              ) : (
                <SideThumbnail data={s} />
              )}
            </div>
          );
        })}

        {/* Desktop arrow buttons */}
        <button
          onClick={goPrev}
          className="hidden md:flex absolute left-0 top-1/2 -translate-y-1/2 z-20 h-10 w-10 items-center justify-center rounded-full bg-black/50 backdrop-blur-sm border border-white/[0.08] text-white/70 hover:text-white hover:bg-black/70 hover:border-white/[0.15] transition-all cursor-pointer"
          aria-label="Previous stream"
        >
          <ChevronLeft className="h-5 w-5" />
        </button>
        <button
          onClick={goNext}
          className="hidden md:flex absolute right-0 top-1/2 -translate-y-1/2 z-20 h-10 w-10 items-center justify-center rounded-full bg-black/50 backdrop-blur-sm border border-white/[0.08] text-white/70 hover:text-white hover:bg-black/70 hover:border-white/[0.15] transition-all cursor-pointer"
          aria-label="Next stream"
        >
          <ChevronRight className="h-5 w-5" />
        </button>
      </div>
      {streams.length > 2 && (
        <div className="flex justify-center gap-2 mt-4">
          {streams.map((s, i) => (
            <button
              key={s.slug}
              onClick={() => setActive(i)}
              className={cn(
                "h-1.5 rounded-full transition-all duration-300 cursor-pointer",
                i === active ? "w-6 bg-emerald-400" : "w-1.5 bg-white/20 hover:bg-white/40"
              )}
              aria-label={`Show ${s.title}`}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function SideThumbnail({ data }: { data: FeaturedData }) {
  return (
    <Link
      to={`/watch/${data.slug}`}
      className="block rounded-xl border border-white/[0.08] overflow-hidden"
      onClick={(e) => e.preventDefault()} // Let carousel onClick handle navigation
    >
      <div className="relative aspect-video bg-black">
        <img
          src={`/watch/${data.slug}/thumbnail.png`}
          alt={data.title}
          className="w-full h-full object-cover"
          loading="lazy"
        />
      </div>
      <div className="flex items-center gap-2.5 px-4 py-2.5 bg-white/[0.02]">
        <span className="text-emerald-400 inline-flex items-center gap-1.5">
          <span className="relative flex h-2 w-2">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
            <span className="relative inline-flex rounded-full h-full w-full bg-emerald-400" />
          </span>
          <span className="text-xs font-medium uppercase tracking-wide">Live</span>
        </span>
        <span className="text-sm text-white font-medium truncate">
          {data.title}
        </span>
      </div>
    </Link>
  );
}

export function FeaturedStreamCard({ data }: { data: FeaturedData }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const hlsRef = useRef<Hls | null>(null);
  const [playing, setPlaying] = useState(false);
  const [muted, setMuted] = useState(true);

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

  function toggleMute() {
    if (!videoRef.current) return;
    videoRef.current.muted = !videoRef.current.muted;
    setMuted(videoRef.current.muted);
  }

  return (
    <Link
      to={`/watch/${data.slug}`}
      className="block group rounded-xl border border-white/[0.08] overflow-hidden transition-all duration-500 hover:border-emerald-500/15"
    >
      <div className="relative aspect-video bg-black">
        <video
          ref={videoRef}
          className={`w-full h-full object-cover ${!playing ? "opacity-0" : ""}`}
          autoPlay
          muted
          playsInline
        />
        {!playing && (
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="size-6 rounded-full border-2 border-zinc-700 border-t-zinc-400 animate-spin" />
          </div>
        )}
        {playing && (
          <button
            onClick={(e) => { e.preventDefault(); e.stopPropagation(); toggleMute(); }}
            className="absolute bottom-3 right-3 flex items-center gap-1.5 rounded-lg bg-black/60 backdrop-blur-sm px-2.5 py-1.5 text-white/80 hover:text-white hover:bg-black/80 transition-colors cursor-pointer"
            aria-label={muted ? "Unmute" : "Mute"}
          >
            {muted ? <VolumeOff className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
            {muted && <span className="text-xs font-medium">Unmute</span>}
          </button>
        )}
      </div>
      <div className="flex items-center gap-2.5 px-4 py-2.5 bg-white/[0.02]">
        <span className="text-emerald-400 inline-flex items-center gap-1.5">
          <span className="relative flex h-2 w-2">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
            <span className="relative inline-flex rounded-full h-full w-full bg-emerald-400" />
          </span>
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
