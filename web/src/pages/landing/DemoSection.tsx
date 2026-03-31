import { useState, useEffect, useRef, useMemo } from "react";
import { useInView } from "motion/react";
import hljs from "highlight.js/lib/core";
import type { PersonaConfig, TermLine, CodeFile } from "./personas";

// Register languages lazily — track what's been registered
const registeredLangs = new Set<string>();

async function ensureLanguage(lang: string) {
  if (registeredLangs.has(lang)) return;
  registeredLangs.add(lang);
  try {
    const mod = await import(
      /* @vite-ignore */ `../../../node_modules/highlight.js/es/languages/${lang}.js`
    );
    hljs.registerLanguage(lang, mod.default);
  } catch {
    // Fall back to plaintext if language module not found
    registeredLangs.delete(lang);
  }
}

export function DemoSection({ persona }: { persona: PersonaConfig }) {
  const terminalLines = persona.terminalLines;
  const codeFiles = persona.codeFiles;
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, margin: "-20px" });
  const [visibleLines, setVisibleLines] = useState(0);
  const [typedChars, setTypedChars] = useState(0);
  const [cursorVisible, setCursorVisible] = useState(true);
  const [codeFileIdx, setCodeFileIdx] = useState(0);
  const [mobilePreview, setMobilePreview] = useState(false);
  const [langsReady, setLangsReady] = useState(false);
  const terminalRef = useRef<HTMLDivElement>(null);

  // Register all needed highlight.js languages
  useEffect(() => {
    const langs = [...new Set(codeFiles.map((f) => f.language))];
    Promise.all(langs.map(ensureLanguage)).then(() => setLangsReady(true));
  }, [codeFiles]);

  // Reset animation when persona changes
  useEffect(() => {
    setVisibleLines(0);
    setTypedChars(0);
    setCodeFileIdx(0);
    setMobilePreview(false);
  }, [persona.id]);

  // Auto-scroll terminal to bottom as new lines appear
  useEffect(() => {
    terminalRef.current?.scrollTo({ top: terminalRef.current.scrollHeight });
  }, [visibleLines, typedChars]);

  // Cursor blink — only when in view
  useEffect(() => {
    if (!inView) return;
    const id = setInterval(() => setCursorVisible((v) => !v), 530);
    return () => clearInterval(id);
  }, [inView]);

  // Typing animation
  useEffect(() => {
    if (!inView) return;

    const currentLine = terminalLines[visibleLines];
    if (!currentLine) return;

    const isTyped = currentLine.type === "user";
    if (
      currentLine.type === "out" ||
      currentLine.type === "agent" ||
      currentLine.type === "cmd" ||
      currentLine.type === "exec" ||
      (isTyped && typedChars >= currentLine.text.length)
    ) {
      const delay = isTyped
        ? 400
        : currentLine.type === "cmd" || currentLine.type === "exec"
          ? 300
          : currentLine.type === "agent"
            ? 600
            : currentLine.text === ""
              ? 200
              : 300;
      const timer = setTimeout(() => {
        setVisibleLines((v) => v + 1);
        setTypedChars(0);
      }, delay);
      return () => clearTimeout(timer);
    }

    const speed = 15 + Math.random() * 20;
    const timer = setTimeout(() => setTypedChars((c) => c + 1), speed);
    return () => clearTimeout(timer);
  }, [inView, visibleLines, typedChars, terminalLines]);

  const codeLines = useMemo(
    () => codeFiles[codeFileIdx].code.split("\n"),
    [codeFiles, codeFileIdx],
  );

  const currentLang = codeFiles[codeFileIdx].language;

  function highlightLine(line: string, language: string): string {
    if (!langsReady || !registeredLangs.has(language)) return escapeHtml(line);
    try {
      return hljs.highlight(line, { language }).value;
    } catch {
      return escapeHtml(line);
    }
  }

  return (
    <div ref={ref} className="mx-auto max-w-5xl">
      <div className="rounded-xl border border-white/[0.08] bg-[#1e1e1e] overflow-hidden">
        {/* ── Title bar ── */}
        <div className="flex items-center px-4 py-2 bg-[#323233] border-b border-[#191919]">
          <div className="flex items-center gap-1.5">
            <div className="h-3 w-3 rounded-full bg-[#ff5f57]" />
            <div className="h-3 w-3 rounded-full bg-[#febc2e]" />
            <div className="h-3 w-3 rounded-full bg-[#28c840]" />
          </div>
          <span className="flex-1 text-center text-xs text-zinc-500 font-sans">
            {persona.demoTitleBar}
          </span>
        </div>

        {/* ── Editor area: code + preview side by side ── */}
        <div className="flex border-b border-[#191919]">
          {/* Code editor */}
          <div className="flex-1 min-w-0 md:border-r border-[#191919]">
            {/* Tab bar */}
            <div className="flex items-center bg-[#252526] border-b border-[#191919]">
              {codeFiles.map((f: CodeFile, i: number) => (
                <button
                  key={f.name}
                  className={`px-4 py-1.5 text-xs font-mono transition-colors border-r border-[#191919] ${!mobilePreview && codeFileIdx === i ? "text-zinc-200 bg-[#1e1e1e] border-t-2 border-t-emerald-400" : "text-zinc-500 bg-[#2d2d2d] hover:text-zinc-400"}`}
                  onClick={() => {
                    setMobilePreview(false);
                    setCodeFileIdx(i);
                  }}
                >
                  {f.name}
                </button>
              ))}
              {/* Preview tab — mobile only */}
              <button
                className={`md:hidden px-4 py-1.5 text-xs font-mono transition-colors border-r border-[#191919] flex items-center gap-1.5 ${mobilePreview ? "text-zinc-200 bg-[#1e1e1e] border-t-2 border-t-emerald-400" : "text-zinc-500 bg-[#2d2d2d] hover:text-zinc-400"}`}
                onClick={() => setMobilePreview(true)}
              >
                {mobilePreview && (
                  <span className="relative flex h-1.5 w-1.5">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                    <span className="relative inline-flex rounded-full h-full w-full bg-emerald-400" />
                  </span>
                )}
                preview
              </button>
            </div>
            {/* Code with line numbers OR mobile preview */}
            {mobilePreview ? (
              <div className="md:hidden bg-[#0a0a0a] flex items-center justify-center p-2 h-[300px]">
                <div className="relative w-full aspect-video max-h-full">
                  <iframe
                    srcDoc={persona.previewHtml}
                    title="Live preview"
                    className="absolute inset-0 w-full h-full border-0 rounded"
                    sandbox="allow-scripts allow-same-origin"
                  />
                </div>
              </div>
            ) : (
              <div className="overflow-auto max-h-[300px] vscode-scroll">
                <table className="w-full border-collapse">
                  <tbody>
                    {codeLines.map((_: string, i: number) => (
                      <tr key={i} className="leading-[1.65]">
                        <td className="text-right pr-4 pl-4 text-zinc-600 text-[12px] font-mono select-none w-[1%] whitespace-nowrap align-top">
                          {i + 1}
                        </td>
                        <td className="pr-4">
                          <pre
                            className="font-mono text-[13px] hljs whitespace-pre inline"
                            dangerouslySetInnerHTML={{
                              __html: highlightLine(codeLines[i], currentLang),
                            }}
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Preview pane */}
          <div className="hidden md:flex flex-col w-[40%] shrink-0">
            {/* Preview tab bar */}
            <div className="flex items-center bg-[#252526] border-b border-[#191919]">
              <span className="px-4 py-1.5 text-xs font-mono text-zinc-200 bg-[#1e1e1e] border-r border-[#191919] border-t-2 border-t-emerald-400 flex items-center gap-1.5">
                <span className="relative flex h-1.5 w-1.5">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                  <span className="relative inline-flex rounded-full h-full w-full bg-emerald-400" />
                </span>
                preview
              </span>
            </div>
            {/* 16:9 preview container */}
            <div className="flex-1 bg-[#0a0a0a] flex items-center justify-center p-2">
              <div className="relative w-full aspect-video">
                <iframe
                  srcDoc={persona.previewHtml}
                  title="Live preview"
                  className="absolute inset-0 w-full h-full border-0 rounded"
                  sandbox="allow-scripts allow-same-origin"
                />
              </div>
            </div>
          </div>
        </div>

        {/* ── Terminal panel ── */}
        <div className="border-b border-[#191919]">
          {/* Terminal tab bar */}
          <div className="flex items-center bg-[#252526] border-b border-[#191919] px-2">
            <span className="px-3 py-1.5 text-[11px] font-mono text-zinc-400 uppercase tracking-wider">
              agent
            </span>
          </div>
          <div
            ref={terminalRef}
            className="px-5 py-3 font-mono text-[13px] leading-relaxed bg-[#1e1e1e] h-[260px] overflow-auto vscode-scroll"
          >
            {terminalLines.slice(0, visibleLines + 1).map((line: TermLine, i: number) => {
              const isCurrentLine = i === visibleLines;
              if (line.text === "" && !isCurrentLine)
                return <div key={i} className="h-4" />;

              if (line.type === "out" && i < visibleLines) {
                return (
                  <div key={i} className="text-zinc-500">
                    {line.text}
                  </div>
                );
              }

              if (line.type === "agent" && i < visibleLines) {
                return (
                  <div key={i} className="text-sky-400/80 italic">
                    {line.text}
                  </div>
                );
              }

              if (line.type === "cmd") {
                return (
                  <div
                    key={i}
                    className={
                      isCurrentLine ? "animate-in fade-in duration-200" : ""
                    }
                  >
                    <span className="text-emerald-400">$ </span>
                    <span className="text-zinc-200">{line.text}</span>
                  </div>
                );
              }

              if (line.type === "exec") {
                return (
                  <div
                    key={i}
                    className={
                      isCurrentLine ? "animate-in fade-in duration-200" : ""
                    }
                  >
                    <span className="text-red-400">! </span>
                    <span className="text-zinc-200">{line.text}</span>
                  </div>
                );
              }

              if (line.type === "user") {
                const chars = isCurrentLine ? typedChars : line.text.length;
                const typed = line.text.slice(0, chars);
                const showCursor = isCurrentLine && chars < line.text.length;
                return (
                  <div key={i}>
                    <span className="text-amber-400">&gt; </span>
                    <span className="text-zinc-200">{typed}</span>
                    {showCursor && (
                      <span
                        className={`inline-block w-[8px] h-[14px] -mb-[2px] ml-px ${cursorVisible ? "bg-emerald-400" : "bg-transparent"}`}
                      />
                    )}
                  </div>
                );
              }

              if (
                isCurrentLine &&
                (line.type === "out" || line.type === "agent")
              ) {
                return (
                  <div
                    key={i}
                    className={`animate-in fade-in duration-200 ${line.type === "agent" ? "text-sky-400/80 italic" : "text-zinc-500"}`}
                  >
                    {line.text}
                  </div>
                );
              }

              return null;
            })}
            {visibleLines >= terminalLines.length && (
              <div>
                <span className="text-emerald-400">$ </span>
                <span
                  className={`inline-block w-[8px] h-[14px] -mb-[2px] ${cursorVisible ? "bg-emerald-400" : "bg-transparent"}`}
                />
              </div>
            )}
          </div>
        </div>

        {/* ── Status bar ── */}
        <div className="flex items-center justify-between px-3 py-0.5 bg-[#007acc] text-white text-[11px] font-sans">
          <div className="flex items-center gap-3">
            <span>main</span>
          </div>
          <div className="flex items-center gap-3">
            <span>{persona.statusBarLanguage}</span>
            <span>UTF-8</span>
          </div>
        </div>
      </div>
    </div>
  );
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
