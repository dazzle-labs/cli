import { UserButton } from "@clerk/react";
import { Link, useLocation } from "react-router-dom";
import { Monitor, Radio, Key, Rocket, BookOpen } from "lucide-react";
import { useEffect } from "react";
import type { ReactNode } from "react";
import { OnboardingWizard } from "./onboarding/OnboardingWizard";
import { useState } from "react";
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
  SidebarTrigger,
  useSidebar,
} from "@/components/ui/sidebar";
import { Separator } from "@/components/ui/separator";

const navItems = [
  { path: "/", label: "Stages", icon: Monitor },
  { path: "/destinations", label: "Destinations", icon: Radio },
  { path: "/api-keys", label: "API Keys", icon: Key },
  { path: "/docs", label: "Docs", icon: BookOpen },
];

function SidebarNav({ onGetStarted }: { onGetStarted: () => void }) {
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
              <span className="text-[15px] font-semibold tracking-tight text-foreground">
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
            <SidebarMenuItem>
              <SidebarMenuButton
                onClick={onGetStarted}
                className="bg-primary text-primary-foreground hover:bg-primary/80 hover:text-primary-foreground active:bg-primary/80 active:text-primary-foreground font-semibold cursor-pointer"
              >
                <Rocket className="h-4 w-4" />
                <span>Get Started</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
            {navItems.map((item) => {
              const active = location.pathname === item.path;
              return (
                <SidebarMenuItem key={item.path}>
                  <SidebarMenuButton
                    asChild
                    isActive={active}
                    className={active ? "bg-primary/10 text-primary hover:bg-primary/15 hover:text-primary active:bg-primary/15 active:text-primary" : ""}
                  >
                    <Link to={item.path}>
                      <item.icon className="h-4 w-4" />
                      <span>{item.label}</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              );
            })}
          </SidebarMenu>
        </SidebarGroup>
      </SidebarContent>
    </Sidebar>
  );
}

export function Layout({ children }: { children: ReactNode }) {
  const [wizardOpen, setWizardOpen] = useState(false);

  return (
    <SidebarProvider>
      <SidebarNav onGetStarted={() => setWizardOpen(true)} />
      <SidebarInset>
        <header className="flex h-14 items-center gap-2 border-b px-4 md:hidden">
          <SidebarTrigger />
          <Separator orientation="vertical" className="mr-2 h-4" />
          <span className="text-[15px] font-semibold tracking-tight text-foreground">
            Dazzle
          </span>
          <div className="ml-auto">
            <UserButton />
          </div>
        </header>
        <main className="flex-1 relative">
          {/* Subtle top-left emerald glow */}
          <div className="pointer-events-none absolute inset-0 overflow-hidden">
            <div
              className="absolute -top-[30%] -left-[10%] w-[60%] aspect-square rounded-full opacity-[0.035]"
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
      <OnboardingWizard open={wizardOpen} onClose={() => setWizardOpen(false)} />
    </SidebarProvider>
  );
}
