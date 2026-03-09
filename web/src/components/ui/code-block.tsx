import { useMemo } from "react";
import hljs from "highlight.js/lib/core";
import bash from "highlight.js/lib/languages/bash";
import { cn } from "@/lib/utils";

hljs.registerLanguage("bash", bash);

interface CodeBlockProps {
  code: string;
  language?: string;
  className?: string;
}

export function CodeBlock({ code, language = "bash", className }: CodeBlockProps) {
  const html = useMemo(
    () => hljs.highlight(code, { language }).value,
    [code, language]
  );

  return (
    <pre
      className={cn("font-mono text-sm bg-card rounded-lg px-4 py-3 border border-border whitespace-pre-wrap overflow-x-auto", className)}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
