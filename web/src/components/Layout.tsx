import { UserButton as ClerkUserButton } from "@clerk/react";

const devToken = import.meta.env.VITE_DEV_TOKEN as string | undefined;
function UserButton() {
  if (devToken) return <div className="w-8 h-8 rounded-full bg-muted flex items-center justify-center text-xs font-medium">T</div>;
  return <ClerkUserButton />;
}
import { Link, useLocation } from "react-router-dom";
import { cn } from "@/lib/utils";
import { Monitor, Plug, Key, Rocket, BookOpen } from "lucide-react";
import { useEffect, useState, useCallback, memo } from "react";
import type { ReactNode } from "react";
import { motion } from "motion/react";
import { OnboardingWizard } from "./onboarding/OnboardingWizard";
import { springs } from "@/lib/motion";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarSeparator,
  SidebarTrigger,
  useSidebar,
} from "@/components/ui/sidebar";
import { Separator } from "@/components/ui/separator";

const navItems = [
  { path: "/stages", label: "Stages", icon: Monitor },
  { path: "/integrations", label: "Integrations", icon: Plug },
  { path: "/api-keys", label: "API Keys", icon: Key },
];


const SidebarNav = memo(function SidebarNav({ onGetStarted }: { onGetStarted: () => void }) {
  const location = useLocation();
  const { setOpenMobile } = useSidebar();

  useEffect(() => {
    setOpenMobile(false);
  }, [location.pathname, setOpenMobile]);

  return (
    <Sidebar>
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton size="lg" className="cursor-default hover:bg-transparent active:bg-transparent">
              <span className="text-[15px] font-semibold tracking-wide text-foreground font-display">
                Dazzle
              </span>
              <div className="ml-auto hidden md:block">
                <UserButton />
              </div>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarMenu>
            <SidebarMenuItem className="relative">
              {location.pathname === "/" && (
                <motion.div
                  layoutId="nav-indicator"
                  className="absolute left-0 top-1 bottom-1 w-[2px] rounded-full bg-primary"
                  transition={springs.snappy}
                />
              )}
              <SidebarMenuButton
                asChild
                isActive={location.pathname === "/"}
                className={cn(
                  location.pathname === "/"
                    ? "bg-primary/10 text-foreground hover:bg-primary/15 hover:text-foreground active:bg-primary/15 active:text-foreground"
                    : "text-muted-foreground hover:text-foreground hover:bg-primary/[0.06]"
                )}
              >
                <Link to="/">
                  <span className="flex h-4 w-4 items-center justify-center">
                    <span className="relative flex h-2 w-2">
                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary opacity-75" />
                      <span className="relative inline-flex rounded-full h-full w-full bg-primary" />
                    </span>
                  </span>
                  <span>Live</span>
                </Link>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
          <SidebarSeparator className="my-2" />
          <SidebarMenu>
            {navItems.map((item) => {
              const active = location.pathname === item.path;
              return (
                <SidebarMenuItem key={item.path} className="relative">
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
                    className={cn(active && "bg-primary/10 text-primary hover:bg-primary/15 hover:text-primary active:bg-primary/15 active:text-primary")}
                  >
                    <Link to={item.path}>
                      <item.icon className="h-4 w-4" />
                      <span>{item.label}</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              );
            })}
            <SidebarMenuItem className="relative">
              {location.pathname === "/docs" && (
                <motion.div
                  layoutId="nav-indicator"
                  className="absolute left-0 top-1 bottom-1 w-[2px] rounded-full bg-primary"
                  transition={springs.snappy}
                />
              )}
              <SidebarMenuButton
                asChild
                isActive={location.pathname === "/docs"}
                className={cn(
                  location.pathname === "/docs"
                    ? "bg-primary/10 text-foreground hover:bg-primary/15 hover:text-foreground active:bg-primary/15 active:text-foreground"
                    : "text-muted-foreground hover:text-foreground hover:bg-primary/[0.06]"
                )}
              >
                <Link to="/docs">
                  <BookOpen className="h-4 w-4" />
                  <span>Docs</span>
                </Link>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
          <SidebarSeparator className="my-2" />
          <div className="px-2">
            <button
              onClick={onGetStarted}
              className="w-full flex items-center justify-center gap-2 rounded-lg border border-primary/20 bg-primary/10 px-3 py-2 text-sm font-medium text-primary hover:bg-primary/15 transition-colors cursor-pointer"
            >
              <Rocket className="h-4 w-4" />
              Get Started
            </button>
          </div>
        </SidebarGroup>
      </SidebarContent>
    </Sidebar>
  );
});

export function Layout({ children }: { children: ReactNode }) {
  const [wizardOpen, setWizardOpen] = useState(false);

  const handleGetStarted = useCallback(() => setWizardOpen(true), []);
  const handleCloseWizard = useCallback(() => setWizardOpen(false), []);

  return (
    <SidebarProvider>
      <SidebarNav onGetStarted={handleGetStarted} />
      <SidebarInset>
        <header className="flex h-14 items-center gap-2 border-b px-4 md:hidden">
          <SidebarTrigger />
          <Separator orientation="vertical" className="mr-2 h-4" />
          <span className="text-[15px] font-semibold tracking-wide text-foreground font-display">
            Dazzle
          </span>
          <div className="ml-auto">
            <UserButton />
          </div>
        </header>
        <main className="flex-1 relative min-w-0">
          {/* Subtle top-left emerald glow */}
          <div className="pointer-events-none absolute inset-0 overflow-hidden">
            <div
              className="absolute -top-[30%] -left-[10%] w-[60%] aspect-square rounded-full animate-ambient-glow"
              style={{
                background:
                  "radial-gradient(circle, oklch(0.72 0.19 163) 0%, transparent 60%)",
              }}
            />
          </div>
          <div className="relative z-10 p-4 pt-4 md:p-8">
            {children}
          </div>
        </main>
      </SidebarInset>
      <OnboardingWizard open={wizardOpen} onClose={handleCloseWizard} />
    </SidebarProvider>
  );
}
