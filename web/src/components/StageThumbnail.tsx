import { useEffect, useRef, useState } from "react";

interface StageThumbnailProps {
  slug: string;
  refreshInterval?: number;
  className?: string;
}

export function StageThumbnail({
  slug,
  refreshInterval = 30_000,
  className = "w-full h-full object-cover",
}: StageThumbnailProps) {
  const [src, setSrc] = useState<string | null>(null);
  const prevUrl = useRef<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function fetchThumbnail() {
      try {
        const resp = await fetch(`/watch/${slug}/thumbnail`);
        if (!resp.ok || cancelled) return;
        const blob = await resp.blob();
        if (cancelled) return;
        const url = URL.createObjectURL(blob);
        if (prevUrl.current) URL.revokeObjectURL(prevUrl.current);
        prevUrl.current = url;
        setSrc(url);
      } catch {
        // ignore
      }
    }

    fetchThumbnail();
    const id = setInterval(fetchThumbnail, refreshInterval);

    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [slug, refreshInterval]);

  useEffect(() => {
    return () => {
      if (prevUrl.current) URL.revokeObjectURL(prevUrl.current);
    };
  }, []);

  if (!src) return <div className="w-full h-full bg-black/50" />;
  return <img src={src} className={className} alt="" />;
}
