import { Twitch, Youtube, Repeat, Settings } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

// Custom Kick "K" icon matching Kick's app icon style
function KickIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className={className}>
      <rect x="3" y="3" width="18" height="18" rx="4" />
      <path d="M9.5 7v10M9.5 12l5-5M9.5 12l5 5" />
    </svg>
  );
}

interface PlatformConfig {
  icon: LucideIcon | typeof KickIcon;
  bg: string;
  label: string;
}

const PLATFORMS: Record<string, PlatformConfig> = {
  twitch: { icon: Twitch, bg: "bg-purple-500/15 text-purple-400", label: "Twitch" },
  youtube: { icon: Youtube, bg: "bg-red-500/15 text-red-400", label: "YouTube" },
  kick: { icon: KickIcon, bg: "bg-green-500/15 text-green-400", label: "Kick" },
  restream: { icon: Repeat, bg: "bg-blue-500/15 text-blue-400", label: "Restream" },
  custom: { icon: Settings, bg: "bg-zinc-500/15 text-zinc-400", label: "Custom" },
};

export const PLATFORM_LIST = Object.entries(PLATFORMS).map(([value, config]) => ({
  value,
  ...config,
}));

/** Per-platform brand-color hover classes for buttons/cards */
export const PLATFORM_HOVER_COLORS: Record<string, string> = {
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
