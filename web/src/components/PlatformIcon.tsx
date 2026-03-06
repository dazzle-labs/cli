import { Tv, Play, Zap, Repeat, Settings } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

interface PlatformConfig {
  icon: LucideIcon;
  bg: string;
  label: string;
}

const PLATFORMS: Record<string, PlatformConfig> = {
  twitch: { icon: Tv, bg: "bg-purple-500/15 text-purple-400", label: "Twitch" },
  youtube: { icon: Play, bg: "bg-red-500/15 text-red-400", label: "YouTube" },
  kick: { icon: Zap, bg: "bg-green-500/15 text-green-400", label: "Kick" },
  restream: { icon: Repeat, bg: "bg-blue-500/15 text-blue-400", label: "Restream" },
  custom: { icon: Settings, bg: "bg-zinc-500/15 text-zinc-400", label: "Custom" },
};

export const PLATFORM_LIST = Object.entries(PLATFORMS).map(([value, config]) => ({
  value,
  ...config,
}));

export function PlatformIcon({
  platform,
  className,
  size = "md",
}: {
  platform: string;
  className?: string;
  size?: "sm" | "md";
}) {
  const config = PLATFORMS[platform] ?? PLATFORMS.custom;
  const Icon = config.icon;
  const sizeClasses = size === "sm" ? "h-8 w-8 rounded-lg" : "h-12 w-12 rounded-xl";
  const iconSize = size === "sm" ? "h-4 w-4" : "h-5 w-5";

  return (
    <div className={cn("flex items-center justify-center", sizeClasses, config.bg, className)}>
      <Icon className={iconSize} />
    </div>
  );
}
