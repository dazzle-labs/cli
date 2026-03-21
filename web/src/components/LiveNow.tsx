import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Radio } from "lucide-react";
import { stageClient } from "@/client";
import { StageFilter } from "@/gen/api/v1/stage_pb";
import {
  SidebarGroup,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuItem,
  SidebarMenuButton,
} from "@/components/ui/sidebar";

interface LiveStage {
  slug: string;
  name: string;
  watchUrl: string;
}

export function LiveNow() {
  const [streams, setStreams] = useState<LiveStage[]>([]);

  useEffect(() => {
    let cancelled = false;

    function poll() {
      stageClient
        .listStages({ filters: [StageFilter.LIVE] })
        .then((res) => {
          if (cancelled) return;
          setStreams(
            (res.stages ?? [])
              .filter((s) => s.slug)
              .map((s) => ({ slug: s.slug, name: s.name, watchUrl: s.watchUrl }))
          );
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

  if (streams.length === 0) return null;

  return (
    <SidebarGroup>
      <SidebarGroupLabel className="flex items-center gap-1.5">
        <span className="relative flex h-2 w-2">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-red-400 opacity-75" />
          <span className="relative inline-flex h-2 w-2 rounded-full bg-red-500" />
        </span>
        Live Now
      </SidebarGroupLabel>
      <SidebarMenu>
        {streams.map((s) => (
          <SidebarMenuItem key={s.slug}>
            <SidebarMenuButton asChild className="text-muted-foreground hover:text-primary hover:bg-primary/[0.06]">
              <Link to={`/watch/${s.slug}`} target="_blank">
                <Radio className="h-3.5 w-3.5 text-red-400 shrink-0" />
                <span className="truncate">{s.name}</span>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        ))}
      </SidebarMenu>
    </SidebarGroup>
  );
}
