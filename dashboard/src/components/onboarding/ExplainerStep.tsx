import { Button } from "@/components/ui/button";
import { ArrowRight, Globe, Cpu, Eye } from "lucide-react";

interface ExplainerStepProps {
  onNext: () => void;
}

export function ExplainerStep({ onNext }: ExplainerStepProps) {
  const steps = [
    {
      icon: Globe,
      label: "Production environment",
      desc: "A production environment runs in the cloud — your agent drives it like a user would.",
    },
    {
      icon: Cpu,
      label: "Agent drives via MCP",
      desc: "Your agent connects over MCP to navigate, click, type, and interact with real websites and apps.",
    },
    {
      icon: Eye,
      label: "Stream it live",
      desc: "The screen is streamed in real time — let your audience watch your agent work.",
    },
  ];

  return (
    <div className="flex flex-col items-center">
      <h2
        className="text-2xl tracking-[-0.02em] text-white mb-2"
        style={{ fontFamily: "'DM Serif Display', serif" }}
      >
        What is Dazzle?
      </h2>
      <p className="text-sm text-zinc-500 mb-10 max-w-md text-center">
        Dazzle gives your AI agent a production environment it can drive — and lets
        you stream the action live.
      </p>

      <div className="flex flex-col sm:flex-row items-center gap-4 w-full max-w-lg mb-10">
        {steps.map((s, i) => (
          <div key={s.label} className="flex-1 flex flex-col items-center text-center">
            <div className="flex items-center gap-3 sm:flex-col sm:gap-0">
              <div className="h-12 w-12 rounded-xl bg-emerald-500/10 flex items-center justify-center mb-0 sm:mb-3">
                <s.icon className="h-6 w-6 text-emerald-400" />
              </div>
              {i < steps.length - 1 && (
                <div className="hidden sm:block absolute" />
              )}
            </div>
            <p className="text-sm font-medium text-white mb-1">{s.label}</p>
            <p className="text-xs text-zinc-500 leading-relaxed">{s.desc}</p>
          </div>
        ))}
      </div>

      <Button
        onClick={onNext}
        className="bg-emerald-500 text-zinc-950 hover:bg-emerald-400 font-semibold"
      >
        Got it, let's go
        <ArrowRight className="h-4 w-4 ml-1" />
      </Button>
    </div>
  );
}
