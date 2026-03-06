import { useState } from "react";
import { Copy, Check, Sparkles } from "lucide-react";

interface CopyAgentPromptButtonProps {
  variant?: "full" | "compact";
}

export function CopyAgentPromptButton({ variant = "full" }: CopyAgentPromptButtonProps) {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    const resp = await fetch("/llms.txt");
    const text = await resp.text();
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
  }

  if (variant === "compact") {
    return (
      <button
        onClick={handleCopy}
        className="flex items-center gap-1.5 text-xs text-zinc-500 hover:text-emerald-400 transition-colors cursor-pointer px-2.5 py-1.5 rounded-lg border border-white/[0.06] hover:border-emerald-500/20 hover:bg-emerald-500/[0.03]"
      >
        {copied ? (
          <><Check className="h-3.5 w-3.5" />Copied!</>
        ) : (
          <><Sparkles className="h-3.5 w-3.5" />Copy AI setup prompt</>
        )}
      </button>
    );
  }

  return (
    <button
      onClick={handleCopy}
      className="group w-full rounded-xl border border-dashed border-white/[0.08] bg-white/[0.01] p-6 text-left transition-all duration-300 hover:border-emerald-500/20 hover:bg-emerald-500/[0.02] cursor-pointer"
    >
      <div className="flex items-center gap-4">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-emerald-500/10 text-emerald-400 transition-colors group-hover:bg-emerald-500/20">
          {copied ? <Check className="h-5 w-5" /> : <Sparkles className="h-5 w-5" />}
        </div>
        <div>
          <h3 className="text-base font-semibold text-white mb-0.5">
            {copied ? "Copied!" : "Let your AI agent figure it out"}
          </h3>
          <p className="text-xs text-zinc-500 leading-relaxed">
            {copied
              ? "Paste the setup prompt into your AI agent's context."
              : "Copy a setup prompt to your clipboard. Paste it into any AI agent and it'll handle the rest."}
          </p>
        </div>
        {!copied && <Copy className="h-4 w-4 text-zinc-600 shrink-0 ml-auto" />}
      </div>
    </button>
  );
}
