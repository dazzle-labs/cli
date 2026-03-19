import { Twitch, Youtube, Settings, Zap } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

// Custom Kick "K" icon — 8-bit pixel art style
function KickIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 10 10" fill="currentColor" className={className} shapeRendering="crispEdges">
      <rect x="1" y="1" width="3" height="8" />
      <rect x="6" y="1" width="4" height="1" />
      <rect x="5" y="2" width="4" height="1" />
      <rect x="4" y="3" width="4" height="1" />
      <rect x="3" y="4" width="4" height="1" />
      <rect x="3" y="5" width="4" height="1" />
      <rect x="4" y="6" width="4" height="1" />
      <rect x="5" y="7" width="4" height="1" />
      <rect x="6" y="8" width="4" height="1" />
    </svg>
  );
}

// Custom Restream "R" icon — smooth semibold letter matching official logo
function RestreamIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className}>
      <path d="M4.5 1.5h9a5.8 5.8 0 0 1 1.3 11.46L20.5 22.5h-5.7l-4.3-8H9v8h-4.5V1.5ZM9 5v5h4a2.5 2.5 0 0 0 0-5H9Z" />
    </svg>
  );
}

interface PlatformConfig {
  icon: LucideIcon | typeof KickIcon;
  bg: string;
  label: string;
  comingSoon?: boolean;
}

const PLATFORMS: Record<string, PlatformConfig> = {
  dazzle: { icon: Zap, bg: "bg-amber-500/15 text-amber-400", label: "Dazzle" },
  twitch: { icon: Twitch, bg: "bg-purple-500/15 text-purple-400", label: "Twitch" },
  youtube: { icon: Youtube, bg: "bg-red-500/15 text-red-400", label: "YouTube", comingSoon: true },
  kick: { icon: KickIcon, bg: "bg-green-500/15 text-green-400", label: "Kick" },
  restream: { icon: RestreamIcon, bg: "bg-blue-500/15 text-blue-400", label: "Restream" },
  custom: { icon: Settings, bg: "bg-zinc-500/15 text-zinc-400", label: "Custom" },
};

export const PLATFORM_LIST = Object.entries(PLATFORMS).map(([value, config]) => ({
  value,
  ...config,
}));

/** Per-platform brand-color hover classes for buttons/cards */
export const PLATFORM_HOVER_COLORS: Record<string, string> = {
  dazzle: "hover:border-amber-500/20 hover:bg-amber-500/[0.03]",
  twitch: "hover:border-purple-500/20 hover:bg-purple-500/[0.03]",
  youtube: "hover:border-red-500/20 hover:bg-red-500/[0.03]",
  kick: "hover:border-green-500/20 hover:bg-green-500/[0.03]",
  restream: "hover:border-blue-500/20 hover:bg-blue-500/[0.03]",
  custom: "hover:border-zinc-400/20 hover:bg-zinc-400/[0.03]",
};

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
