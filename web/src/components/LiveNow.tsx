import { Link, useLocation } from "react-router-dom";
import { motion } from "motion/react";
import { cn } from "@/lib/utils";
import { springs } from "@/lib/motion";
import { useLiveCount } from "@/hooks/use-live-count";
import {
  SidebarGroup,
  SidebarMenu,
  SidebarMenuItem,
  SidebarMenuButton,
} from "@/components/ui/sidebar";

export function LiveNow() {
  const count = useLiveCount();
  const location = useLocation();
  const active = location.pathname === "/live";

  if (count === 0) return null;

  return (
    <SidebarGroup>
      <SidebarMenu>
        <SidebarMenuItem className="relative">
          {active && (
            <motion.div
              layoutId="nav-indicator"
              className="absolute left-0 top-1 bottom-1 w-[2px] rounded-full bg-primary"
              transition={springs.snappy}
            />
          )}
          <SidebarMenuButton
            asChild
            isActive={active}
            className={cn(
              active
                ? "bg-primary/10 text-primary hover:bg-primary/15 hover:text-primary active:bg-primary/15 active:text-primary"
                : "text-muted-foreground hover:text-primary hover:bg-primary/[0.06]"
            )}
          >
            <Link to="/live">
              <span className="relative flex h-2 w-2 mr-0.5">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
              </span>
              <span>Live Now</span>
              <span className="ml-auto text-xs text-muted-foreground">{count}</span>
            </Link>
          </SidebarMenuButton>
        </SidebarMenuItem>
      </SidebarMenu>
    </SidebarGroup>
  );
}
