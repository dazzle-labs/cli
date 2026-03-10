import { CopyButton } from "@/components/CopyButton";
import { cn } from "@/lib/utils";

/** Single-line command block with inline copy. */
export function CommandLine({ cmd, className }: { cmd: string; className?: string }) {
  return (
    <div className={cn("rounded-lg bg-zinc-900 px-4 py-2.5 overflow-x-auto", className)}>
      <div className="flex items-center gap-2">
        <code className="text-sm font-mono text-zinc-200 whitespace-nowrap">{cmd}</code>
        <CopyButton
          text={cmd}
          tooltip="Copy"
          size="icon-xs"
          iconSize="h-3.5 w-3.5"
          className="text-zinc-500 hover:text-primary shrink-0"
        />
      </div>
    </div>
  );
}

/** Multi-line block: comments rendered as labels, commands get per-line copy. */
export function TerminalBlock({ code, className }: { code: string; className?: string }) {
  const lines = code.split("\n");

  return (
    <div className={cn("rounded-lg bg-zinc-900 overflow-x-auto py-3", className)}>
      {lines.map((line, i) => {
        const trimmed = line.trim();
        if (!trimmed) return <div key={i} className="h-2" />;
        if (trimmed.startsWith("#")) {
          return (
            <div key={i} className="px-5">
              <span className="text-xs font-mono text-zinc-500 select-none">{line}</span>
            </div>
          );
        }
        return (
          <div
            key={i}
            className="group/cmd flex items-center gap-2 px-5 py-0.5 hover:bg-white/[0.06] transition-colors"
          >
            <code className="text-sm font-mono text-zinc-200 whitespace-nowrap">{line}</code>
            <CopyButton
              text={line}
              tooltip="Copy"
              size="icon-xs"
              iconSize="h-3.5 w-3.5"
              className="text-zinc-500 hover:text-primary shrink-0"
            />
          </div>
        );
      })}
    </div>
  );
}
