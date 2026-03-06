import { UserButton } from "@clerk/react";
import { Link, useLocation } from "react-router-dom";
import { Monitor, Radio, Key, Rocket, BookOpen, Menu, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { useState, useEffect } from "react";
import type { ReactNode } from "react";
import { OnboardingWizard } from "./onboarding/OnboardingWizard";

const navItems = [
  { path: "/", label: "Stages", icon: Monitor },
  { path: "/destinations", label: "Destinations", icon: Radio },
  { path: "/api-keys", label: "API Keys", icon: Key },
  { path: "/docs", label: "Docs", icon: BookOpen },
];

export function Layout({ children }: { children: ReactNode }) {
  const location = useLocation();
  const [wizardOpen, setWizardOpen] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);

  // Auto-close sidebar on route change (mobile)
  useEffect(() => {
    setSidebarOpen(false);
  }, [location.pathname]);

  return (
    <div className="flex min-h-screen" style={{ fontFamily: "'Outfit', sans-serif" }}>
      {/* Google Fonts — shared with landing page */}
      <link rel="preconnect" href="https://fonts.googleapis.com" />
      <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
      <link
        href="https://fonts.googleapis.com/css2?family=DM+Serif+Display:ital@0;1&family=Outfit:wght@300;400;500;600;700&display=swap"
        rel="stylesheet"
      />

      {/* Mobile top bar */}
      <div className="fixed top-0 left-0 right-0 z-30 flex items-center justify-between bg-zinc-950 border-b border-white/[0.06] px-4 h-14 md:hidden">
        <button
          type="button"
          onClick={() => setSidebarOpen(true)}
          className="text-zinc-400 hover:text-white transition-colors cursor-pointer p-1"
        >
          <Menu className="h-5 w-5" />
        </button>
        <span className="text-[15px] font-semibold tracking-tight text-white">
          Dazzle
        </span>
        <UserButton />
      </div>

      {/* Mobile backdrop */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-40 bg-zinc-950/80 backdrop-blur-sm md:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Sidebar */}
      <nav
        className={cn(
          "fixed inset-y-0 left-0 z-40 w-56 bg-zinc-950 border-r border-white/[0.06] flex flex-col transition-transform duration-200 ease-out",
          "md:relative md:translate-x-0",
          sidebarOpen ? "translate-x-0" : "-translate-x-full"
        )}
      >
        {/* Brand + user */}
        <div className="px-5 pt-5 pb-6 flex items-center justify-between">
          <span className="text-[15px] font-semibold tracking-tight text-white">
            Dazzle
          </span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setSidebarOpen(false)}
              className="text-zinc-500 hover:text-white transition-colors cursor-pointer p-1 md:hidden"
            >
              <X className="h-4 w-4" />
            </button>
            <div className="hidden md:block">
              <UserButton />
            </div>
          </div>
        </div>

        {/* Get Started button */}
        <div className="px-3 mb-2">
          <button
            type="button"
            onClick={() => setWizardOpen(true)}
            className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-[13px] font-semibold bg-emerald-500 text-zinc-950 hover:bg-emerald-400 transition-all duration-200 cursor-pointer"
          >
            <Rocket className="h-4 w-4" />
            Get Started
          </button>
        </div>

        {/* Nav items */}
        <div className="flex flex-col gap-0.5 px-3">
          {navItems.map((item) => {
            const active = location.pathname === item.path;
            return (
              <Link
                key={item.path}
                to={item.path}
                className={cn(
                  "flex items-center gap-3 rounded-lg px-3 py-2 text-[13px] font-medium transition-all duration-200",
                  active
                    ? "bg-emerald-500/10 text-emerald-400"
                    : "text-zinc-500 hover:bg-white/[0.03] hover:text-zinc-300"
                )}
              >
                <item.icon className={cn("h-4 w-4", active && "text-emerald-400")} />
                {item.label}
              </Link>
            );
          })}
        </div>
      </nav>

      {/* Main content */}
      <main className="flex-1 bg-zinc-900 text-zinc-100 overflow-auto relative">
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
        <div className="relative z-10 p-4 pt-18 md:p-8 md:pt-8">
          {children}
        </div>
      </main>

      <OnboardingWizard open={wizardOpen} onClose={() => setWizardOpen(false)} />
    </div>
  );
}
