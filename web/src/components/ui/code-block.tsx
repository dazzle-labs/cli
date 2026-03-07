import { useMemo } from "react";
import hljs from "highlight.js/lib/core";
import bash from "highlight.js/lib/languages/bash";

hljs.registerLanguage("bash", bash);

interface CodeBlockProps {
  code: string;
  language?: string;
  className?: string;
}

export function CodeBlock({ code, language = "bash", className = "" }: CodeBlockProps) {
  const html = useMemo(
    () => hljs.highlight(code, { language }).value,
    [code, language]
  );

  return (
    <pre
      className={`font-mono text-sm bg-zinc-950/50 rounded-lg px-4 py-3 border border-white/[0.06] whitespace-pre-wrap overflow-x-auto ${className}`}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
