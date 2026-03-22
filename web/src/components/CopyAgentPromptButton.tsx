import { useState } from "react";
import { Copy, Check, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";

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
      <Button
        variant="outline"
        size="sm"
        onClick={handleCopy}
        className="text-xs text-muted-foreground hover:text-primary hover:border-primary/20 hover:bg-primary/[0.03]"
      >
        {copied ? (
          <><Check className="h-3.5 w-3.5" />Copied!</>
        ) : (
          <><Sparkles className="h-3.5 w-3.5" />Copy AI setup prompt</>
        )}
      </Button>
    );
  }

  return (
    <button
      onClick={handleCopy}
      className={`group w-full rounded-xl border p-6 text-left transition-all duration-300 cursor-pointer ${
        copied
          ? "border-primary/30 bg-primary/[0.06]"
          : "border-dashed border-border bg-card/50 hover:border-primary/20 hover:bg-primary/[0.02]"
      }`}
    >
      <div className="flex items-center gap-4">
        <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg transition-colors ${
          copied
            ? "bg-primary/20 text-primary"
            : "bg-primary/10 text-primary group-hover:bg-primary/20"
        }`}>
          {copied ? <Check className="h-5 w-5" /> : <Sparkles className="h-5 w-5" />}
        </div>
        <div>
          <h3 className="text-base font-semibold text-foreground mb-0.5">
            {copied ? "Copied!" : "Let your AI agent figure it out"}
          </h3>
          <p className="text-xs text-muted-foreground leading-relaxed">
            {copied
              ? "Paste the setup prompt into your AI agent's context."
              : "Copy a setup prompt to your clipboard. Paste it into any AI agent and it'll handle the rest."}
          </p>
        </div>
        {!copied && <Copy className="h-4 w-4 text-muted-foreground shrink-0 ml-auto" />}
      </div>
    </button>
  );
}
