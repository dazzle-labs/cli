import { useEffect, useRef, useState } from "react";
import { useAuth } from "@clerk/react";

interface StageThumbnailProps {
  stageId: string;
  refreshInterval?: number;
  className?: string;
}

export function StageThumbnail({
  stageId,
  refreshInterval = 30_000,
  className = "w-full h-full object-cover",
}: StageThumbnailProps) {
  const [src, setSrc] = useState<string | null>(null);
  const prevUrl = useRef<string | null>(null);
  const { getToken } = useAuth();

  useEffect(() => {
    let cancelled = false;

    async function fetchThumbnail() {
      const token = await getToken();
      if (!token || cancelled) return;
      try {
        const resp = await fetch(`/stage/${stageId}/thumbnail`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!resp.ok || cancelled) return;
        const blob = await resp.blob();
        if (cancelled) return;
        const url = URL.createObjectURL(blob);
        if (prevUrl.current) URL.revokeObjectURL(prevUrl.current);
        prevUrl.current = url;
        setSrc(url);
      } catch {
        // ignore fetch errors
      }
    }

    fetchThumbnail();
    const id = setInterval(fetchThumbnail, refreshInterval);

    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [stageId, refreshInterval, getToken]);

  useEffect(() => {
    return () => {
      if (prevUrl.current) URL.revokeObjectURL(prevUrl.current);
    };
  }, []);

  if (!src) return <div className="w-full h-full bg-black/50" />;
  return <img src={src} className={className} alt="" />;
}
