import { useState, useEffect, useRef, useMemo } from "react";
import { Link } from "react-router-dom";
import { SignIn } from "@clerk/react";
import { motion, useInView } from "motion/react";
import {
  ArrowRight,
  ChevronDown,
  Download,
  Globe,
  Radio,
} from "lucide-react";
import hljs from "highlight.js/lib/core";
import typescript from "highlight.js/lib/languages/typescript";
import glsl from "highlight.js/lib/languages/glsl";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { useFeaturedStreams, FeaturedCarousel } from "@/components/FeaturedStream";

hljs.registerLanguage("typescript", typescript);
hljs.registerLanguage("glsl", glsl);

/** Green "live" text with pulsing dot — used across landing page headings. */
function LiveText({ children = "live" }: { children?: string }) {
  return (
    <span className="text-emerald-400 inline-flex items-baseline gap-0">
      <span className="relative flex h-[0.3em] w-[0.3em] self-center mr-[0.08em]">
        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
        <span className="relative inline-flex rounded-full h-full w-full bg-emerald-400" />
      </span>
      {children}
    </span>
  );
}

type TermLine = { type: "cmd" | "exec" | "out" | "agent" | "user"; text: string };

function getTerminalLines(): TermLine[] {
  return [
  { type: "user", text: "read dazzle.fm/llms.txt — build a live SF sports dashboard and stream it" },
  { type: "out", text: "" },
  { type: "agent", text: "I'll read the Dazzle docs. First you'll need to install and log in:" },
  { type: "out", text: "" },
  { type: "exec", text: "curl -sSL https://dazzle.fm/install.sh | sh" },
  { type: "out", text: "Dazzle CLI installed." },
  { type: "out", text: "" },
  { type: "exec", text: "dazzle login" },
  { type: "out", text: "\u2713 Logged in as you@example.com" },
  { type: "out", text: "" },
  { type: "user", text: "done, go ahead" },
  { type: "out", text: "" },
  { type: "cmd", text: "dazzle stage create sf-sports" },
  { type: "out", text: 'Stage "sf-sports" created.' },
  { type: "out", text: "" },
  { type: "agent", text: "Wrote Dashboard.tsx, Ticker.tsx, connected ESPN API" },
  { type: "out", text: "" },
  { type: "cmd", text: "npm run build" },
  { type: "out", text: "\u2713 Built in 0.9s" },
  { type: "out", text: "" },
  { type: "cmd", text: "dazzle stage up --stage sf-sports" },
  { type: "out", text: "\u2713 Stage activated." },
  { type: "out", text: "" },
  { type: "cmd", text: "dazzle stage sync ./dist --stage sf-sports" },
  { type: "out", text: "4 files synced." },
  { type: "out", text: "" },
  { type: "agent", text: "Your stage is live at dazzle.fm/s/sf-sports" },
  { type: "out", text: "" },
  { type: "user", text: "now stream it to twitch" },
  { type: "out", text: "" },
  { type: "cmd", text: "dazzle destination add twitch" },
  { type: "out", text: "\u2713 Destination \"twitch\" added." },
  { type: "out", text: "" },
  { type: "cmd", text: "dazzle destination attach twitch --stage sf-sports" },
  { type: "out", text: "\u2713 Streaming to twitch.tv" },
  ];
}

const REACT_CODE = `import { useState, useEffect } from 'react'
import { Ticker } from './Ticker'

const SF_TEAMS = [
  { name: '49ers',       league: 'nfl', color: '#aa0000' },
  { name: 'Warriors',    league: 'nba', color: '#1d428a' },
  { name: 'Giants',      league: 'mlb', color: '#fd5a1e' },
  { name: 'Sharks',      league: 'nhl', color: '#00897b' },
  { name: 'Earthquakes', league: 'mls', color: '#68a' },
  { name: "A's",         league: 'mlb', color: '#006340' },
]

export default function Dashboard() {
  const [games, setGames] = useState<Game[]>([])

  useEffect(() => {
    async function fetchAll() {
      const all = await Promise.all(
        SF_TEAMS.map(t => fetchScores(t))
      )
      setGames(all.flat())
    }
    fetchAll()
    const id = setInterval(fetchAll, 30000)
    return () => clearInterval(id)
  }, [])

  return (
    <div className="dashboard">
      <header>
        <h1>SF Bay Area Sports</h1>
        <Clock />
      </header>
      <div className="grid">
        {games.map(g => (
          <ScoreCard key={g.id} game={g} />
        ))}
      </div>
      <Ticker items={games.flatMap(g => g.headlines)} />
    </div>
  )
}`;

const SHADER_CODE = `// Ticker.tsx — scrolling headline ticker

import { useEffect, useRef, useState } from 'react'

interface Props {
  items: string[]
  speed?: number  // pixels per second
}

export function Ticker({ items, speed = 60 }: Props) {
  const ref = useRef<HTMLDivElement>(null)
  const [offset, setOffset] = useState(0)

  useEffect(() => {
    let raf: number
    let last = performance.now()

    function tick(now: number) {
      const dt = (now - last) / 1000
      last = now
      setOffset(prev => {
        const next = prev + speed * dt
        const el = ref.current
        if (!el) return next
        // loop when fully scrolled
        return next > el.scrollWidth / 2
          ? 0 : next
      })
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [speed])

  // duplicate items for seamless loop
  const doubled = [...items, ...items]

  return (
    <div className="ticker-wrap">
      <div
        ref={ref}
        className="ticker-track"
        style={{ transform: \`translateX(-\${offset}px)\` }}
      >
        {doubled.map((item, i) => (
          <span key={i} className="ticker-item">
            {item}
          </span>
        ))}
      </div>
    </div>
  )
}`;

const PREVIEW_HTML = `<!DOCTYPE html><html><head><meta charset="utf-8">
<style>
*{margin:0;box-sizing:border-box}
body{background:#0a0e1a;color:#fff;font-family:system-ui,-apple-system,sans-serif;overflow:hidden;height:100vh;display:flex;flex-direction:column}
.header{display:flex;align-items:center;justify-content:space-between;padding:3% 4% 2%;flex-shrink:0}
.title{font-size:clamp(10px,2.5vw,18px);font-weight:700;letter-spacing:0.05em;text-transform:uppercase}
.title span{color:#f59e0b}
.clock{font-size:clamp(9px,2vw,14px);color:rgba(255,255,255,0.5);font-variant-numeric:tabular-nums}
.cards{display:grid;grid-template-columns:repeat(3,1fr);grid-template-rows:repeat(2,1fr);gap:clamp(3px,0.8vw,6px);padding:0 4% 2%;flex:1;min-height:0}
.card{border-radius:clamp(3px,0.6vw,6px);padding:clamp(4px,1.2vw,10px);display:flex;flex-direction:column;position:relative;overflow:hidden}
.card-header{font-size:clamp(5px,1vw,8px);text-transform:uppercase;letter-spacing:0.08em;opacity:0.5;margin-bottom:2px}
.matchup{display:flex;align-items:center;justify-content:center;gap:clamp(3px,1vw,8px);flex:1}
.team{text-align:center}
.team-name{font-size:clamp(5px,1.1vw,9px);font-weight:600;margin-bottom:1px}
.score{font-size:clamp(10px,2.8vw,22px);font-weight:800;font-variant-numeric:tabular-nums}
.vs{font-size:clamp(5px,0.9vw,7px);opacity:0.3;text-transform:uppercase}
.status{font-size:clamp(4px,0.8vw,7px);text-align:center;margin-top:auto;padding-top:2px}
.live-dot{display:inline-block;width:clamp(3px,0.6vw,5px);height:clamp(3px,0.6vw,5px);background:#ef4444;border-radius:50%;margin-right:3px;animation:pulse 2s infinite}
.ticker{background:rgba(255,255,255,0.05);padding:clamp(4px,1vw,8px) 0;overflow:hidden;white-space:nowrap;flex-shrink:0;font-size:clamp(6px,1.2vw,9px);color:rgba(255,255,255,0.5)}
.ticker-track{display:inline-block;animation:scroll 25s linear infinite}
.ticker-item{margin:0 clamp(8px,3vw,24px)}
.ticker-item b{color:#f59e0b}
@keyframes pulse{0%,100%{opacity:1}50%{opacity:0.3}}
@keyframes scroll{from{transform:translateX(0)}to{transform:translateX(-50%)}}
</style>
</head><body>
<div class="header">
  <div class="title">SF Bay <span>Sports</span></div>
  <div class="clock" id="clock"></div>
</div>
<div class="cards">
  <div class="card" style="background:linear-gradient(135deg,rgba(170,0,0,0.2),rgba(170,0,0,0.05))">
    <div class="card-header">NFL &bull; Q4 2:31</div>
    <div class="matchup">
      <div class="team"><div class="team-name">49ers</div><div class="score" style="color:#ef4444">28</div></div>
      <div class="vs">&ndash;</div>
      <div class="team"><div class="team-name">Rams</div><div class="score">21</div></div>
    </div>
    <div class="status"><span class="live-dot"></span>LIVE</div>
  </div>
  <div class="card" style="background:linear-gradient(135deg,rgba(29,66,138,0.2),rgba(29,66,138,0.05))">
    <div class="card-header">NBA &bull; 3rd 8:45</div>
    <div class="matchup">
      <div class="team"><div class="team-name">Warriors</div><div class="score" style="color:#3b82f6">94</div></div>
      <div class="vs">&ndash;</div>
      <div class="team"><div class="team-name">Lakers</div><div class="score">88</div></div>
    </div>
    <div class="status"><span class="live-dot"></span>LIVE</div>
  </div>
  <div class="card" style="background:linear-gradient(135deg,rgba(253,90,30,0.2),rgba(253,90,30,0.05))">
    <div class="card-header">MLB &bull; Top 6th</div>
    <div class="matchup">
      <div class="team"><div class="team-name">Giants</div><div class="score" style="color:#f97316">5</div></div>
      <div class="vs">&ndash;</div>
      <div class="team"><div class="team-name">Dodgers</div><div class="score">3</div></div>
    </div>
    <div class="status"><span class="live-dot"></span>LIVE</div>
  </div>
  <div class="card" style="background:linear-gradient(135deg,rgba(0,120,100,0.2),rgba(0,120,100,0.05))">
    <div class="card-header">NHL &bull; 2nd 14:22</div>
    <div class="matchup">
      <div class="team"><div class="team-name">Sharks</div><div class="score" style="color:#00897b">2</div></div>
      <div class="vs">&ndash;</div>
      <div class="team"><div class="team-name">Kings</div><div class="score">2</div></div>
    </div>
    <div class="status"><span class="live-dot"></span>LIVE</div>
  </div>
  <div class="card" style="background:linear-gradient(135deg,rgba(0,0,0,0.15),rgba(0,0,0,0.05))">
    <div class="card-header">MLS &bull; Tomorrow 4:30 PM</div>
    <div class="matchup">
      <div class="team"><div class="team-name">Earthquakes</div><div class="score" style="color:#68a">&ndash;</div></div>
      <div class="vs">vs</div>
      <div class="team"><div class="team-name">Galaxy</div><div class="score">&ndash;</div></div>
    </div>
    <div class="status" style="opacity:0.4">UPCOMING</div>
  </div>
  <div class="card" style="background:linear-gradient(135deg,rgba(0,100,60,0.2),rgba(0,100,60,0.05))">
    <div class="card-header">MLB &bull; Final</div>
    <div class="matchup">
      <div class="team"><div class="team-name">A's</div><div class="score" style="color:#22c55e">7</div></div>
      <div class="vs">&ndash;</div>
      <div class="team"><div class="team-name">Mariners</div><div class="score">4</div></div>
    </div>
    <div class="status" style="opacity:0.5">FINAL</div>
  </div>
</div>
<div class="ticker">
  <div class="ticker-track" id="ticker"></div>
</div>
<script>
function updateClock(){
  const now=new Date();
  const h=now.getHours(),m=now.getMinutes(),s=now.getSeconds();
  document.getElementById('clock').textContent=
    String(h).padStart(2,'0')+':'+String(m).padStart(2,'0')+':'+String(s).padStart(2,'0');
}
setInterval(updateClock,1000);updateClock();

const headlines=[
  '<b>49ers</b> Purdy 3 TD passes, defense forces 2 turnovers',
  '<b>Warriors</b> Curry 32 pts, 8 ast in heated rivalry game',
  '<b>Giants</b> acquire reliever from Cubs in trade deadline deal',
  '<b>49ers</b> McCaffrey questionable for next week with knee',
  '<b>Warriors</b> clinch playoff spot with win tonight',
  '<b>Giants</b> Chapman homers in 3 straight — Oracle Park erupts',
];
const doubled=headlines.concat(headlines);
document.getElementById('ticker').innerHTML=doubled.map(h=>'<span class="ticker-item">'+h+'</span>').join('');
<\/script></body></html>`;

type CodeFile = { name: string; code: string; language: string }
const CODE_FILES: CodeFile[] = [
  { name: "Dashboard.tsx", code: REACT_CODE, language: "typescript" },
  { name: "Ticker.tsx", code: SHADER_CODE, language: "typescript" },
];

function DemoSection() {
  const TERMINAL_LINES = useMemo(() => getTerminalLines(), []);
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, margin: "-20px" });
  const [visibleLines, setVisibleLines] = useState(0);
  const [typedChars, setTypedChars] = useState(0);
  const [cursorVisible, setCursorVisible] = useState(true);
  const [codeFileIdx, setCodeFileIdx] = useState(0);
  const [mobilePreview, setMobilePreview] = useState(false);
  const terminalRef = useRef<HTMLDivElement>(null);

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

    const currentLine = TERMINAL_LINES[visibleLines];
    if (!currentLine) return;

    const isTyped = currentLine.type === "user";
    if (currentLine.type === "out" || currentLine.type === "agent" || currentLine.type === "cmd" || currentLine.type === "exec" || (isTyped && typedChars >= currentLine.text.length)) {
      const delay = isTyped ? 400 : (currentLine.type === "cmd" || currentLine.type === "exec") ? 300 : currentLine.type === "agent" ? 600 : currentLine.text === "" ? 200 : 300;
      const timer = setTimeout(() => {
        setVisibleLines((v) => v + 1);
        setTypedChars(0);
      }, delay);
      return () => clearTimeout(timer);
    }

    const speed = 15 + Math.random() * 20;
    const timer = setTimeout(() => setTypedChars((c) => c + 1), speed);
    return () => clearTimeout(timer);
  }, [inView, visibleLines, typedChars]);

  const codeLines = useMemo(
    () => CODE_FILES[codeFileIdx].code.split("\n"),
    [codeFileIdx],
  );

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
          <span className="flex-1 text-center text-xs text-zinc-500 font-sans">sf-sports — dazzle.fm</span>
        </div>

        {/* ── Editor area: code + preview side by side ── */}
        <div className="flex border-b border-[#191919]">
          {/* Code editor */}
          <div className="flex-1 min-w-0 md:border-r border-[#191919]">
            {/* Tab bar */}
            <div className="flex items-center bg-[#252526] border-b border-[#191919]">
              {CODE_FILES.map((f, i) => (
                <button
                  key={f.name}
                  className={`px-4 py-1.5 text-xs font-mono transition-colors border-r border-[#191919] ${!mobilePreview && codeFileIdx === i ? "text-zinc-200 bg-[#1e1e1e] border-t-2 border-t-emerald-400" : "text-zinc-500 bg-[#2d2d2d] hover:text-zinc-400"}`}
                  onClick={() => { setMobilePreview(false); setCodeFileIdx(i); }}
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
                    srcDoc={PREVIEW_HTML}
                    title="Live preview"
                    className="absolute inset-0 w-full h-full border-0 rounded"
                    sandbox="allow-scripts"
                  />
                </div>
              </div>
            ) : (
              <div className="overflow-auto max-h-[300px] vscode-scroll">
                <table className="w-full border-collapse">
                  <tbody>
                    {codeLines.map((_, i) => (
                      <tr key={i} className="leading-[1.65]">
                        <td className="text-right pr-4 pl-4 text-zinc-600 text-[12px] font-mono select-none w-[1%] whitespace-nowrap align-top">{i + 1}</td>
                        <td className="pr-4">
                          <pre
                            className="font-mono text-[13px] hljs whitespace-pre inline"
                            dangerouslySetInnerHTML={{ __html: hljs.highlight(codeLines[i], { language: CODE_FILES[codeFileIdx].language }).value }}
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
                  srcDoc={PREVIEW_HTML}
                  title="Live preview"
                  className="absolute inset-0 w-full h-full border-0 rounded"
                  sandbox="allow-scripts"
                />
              </div>
            </div>
          </div>
        </div>

        {/* ── Terminal panel ── */}
        <div className="border-b border-[#191919]">
          {/* Terminal tab bar */}
          <div className="flex items-center bg-[#252526] border-b border-[#191919] px-2">
            <span className="px-3 py-1.5 text-[11px] font-mono text-zinc-400 uppercase tracking-wider">agent</span>
          </div>
          <div ref={terminalRef} className="px-5 py-3 font-mono text-[13px] leading-relaxed bg-[#1e1e1e] h-[260px] overflow-auto vscode-scroll">
            {TERMINAL_LINES.slice(0, visibleLines + 1).map((line, i) => {
              const isCurrentLine = i === visibleLines;
              if (line.text === "" && !isCurrentLine) return <div key={i} className="h-4" />;

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
                  <div key={i} className={isCurrentLine ? "animate-in fade-in duration-200" : ""}>
                    <span className="text-emerald-400">$ </span>
                    <span className="text-zinc-200">{line.text}</span>
                  </div>
                );
              }

              if (line.type === "exec") {
                return (
                  <div key={i} className={isCurrentLine ? "animate-in fade-in duration-200" : ""}>
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
                      <span className={`inline-block w-[8px] h-[14px] -mb-[2px] ml-px ${cursorVisible ? "bg-emerald-400" : "bg-transparent"}`} />
                    )}
                  </div>
                );
              }

              if (isCurrentLine && (line.type === "out" || line.type === "agent")) {
                return (
                  <div key={i} className={`animate-in fade-in duration-200 ${line.type === "agent" ? "text-sky-400/80 italic" : "text-zinc-500"}`}>
                    {line.text}
                  </div>
                );
              }

              return null;
            })}
            {visibleLines >= TERMINAL_LINES.length && (
              <div>
                <span className="text-emerald-400">$ </span>
                <span className={`inline-block w-[8px] h-[14px] -mb-[2px] ${cursorVisible ? "bg-emerald-400" : "bg-transparent"}`} />
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
            <span>TypeScript React</span>
            <span>UTF-8</span>
          </div>
        </div>
      </div>
    </div>
  );
}

const FRAMEWORKS = [
  "Claude Code",
  "OpenAI Agents SDK",
  "CrewAI",
  "LangGraph",
  "AutoGen",
  "OpenClaw",
];

const ease = [0.25, 0.1, 0.25, 1] as const;


export function LandingPage() {
  const [signInOpen, setSignInOpen] = useState(false);
  const openSignIn = () => setSignInOpen(true);
  const featuredStreams = useFeaturedStreams();

  return (
    <div className="relative min-h-screen bg-zinc-950 overflow-hidden selection:bg-emerald-500/30">
      {/* ── Ambient background ── */}
      <div className="pointer-events-none fixed inset-0 overflow-hidden">
        <div className="landing-orb landing-orb-1" />
        <div className="landing-orb landing-orb-2" />
        <div className="landing-orb landing-orb-3" />
        {/* Dot grid */}
        <div
          className="absolute inset-0 opacity-[0.025]"
          style={{
            backgroundImage:
              "radial-gradient(circle at 1px 1px, rgba(255,255,255,0.5) 1px, transparent 0)",
            backgroundSize: "64px 64px",
          }}
        />
      </div>

      {/* ── Nav ── */}
      <nav className="sticky top-0 z-50 flex items-center justify-between px-6 py-4 md:px-10 backdrop-blur-xl bg-zinc-950/60 border-b border-white/[0.04]">
        <span className="text-base font-semibold tracking-tight text-white font-display">
          Dazzle
        </span>
        <div className="flex items-center gap-5">
          <Link
            to="/live"
            className="text-zinc-400 hover:text-white text-sm transition-colors"
          >
            Live
          </Link>
          <Link
            to="/docs"
            className="text-zinc-400 hover:text-white text-sm transition-colors"
          >
            Docs
          </Link>
          <a
            href="/llms.txt"
            target="_blank"
            rel="noopener noreferrer"
            className="text-zinc-500 hover:text-zinc-300 text-sm font-mono transition-colors"
          >
            llms.txt
          </a>
          <Button
            size="sm"
            variant="outline"
            className="border-white/10 text-zinc-300 hover:text-white hover:bg-white/5"
            onClick={openSignIn}
          >
            Sign In
          </Button>
        </div>
      </nav>

      {/* ── Hero ── */}
      <section className="relative z-10 flex flex-col items-center px-6 pt-28 pb-12 md:pt-40 md:pb-16 text-center">
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.7, ease }}
        >
          <Badge
            variant="outline"
            className="border-emerald-500/30 text-emerald-400 mb-8 text-xs px-3 py-1 h-auto"
          >
            Free during beta — stages are limited
          </Badge>
        </motion.div>

        <motion.h1
          className="font-display text-[clamp(2.2rem,5.5vw,4.5rem)] leading-[1.08] tracking-[-0.03em] text-white"
          initial={{ opacity: 0, y: 30 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, delay: 0.1, ease }}
        >
          Your AI agent, <LiveText>live</LiveText>
        </motion.h1>

        <motion.p
          className="mt-6 text-lg md:text-xl text-zinc-400 max-w-2xl leading-relaxed font-light"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, delay: 0.25, ease }}
        >
          A cloud stage for your agent — live on Twitch, YouTube, or a shareable link.
        </motion.p>

        <motion.div
          className="mt-10 flex flex-col sm:flex-row gap-4 items-center"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, delay: 0.4, ease }}
        >
          <Button
            size="lg"
            className="bg-emerald-500 text-zinc-950 hover:bg-emerald-400 font-semibold text-base px-8 h-12"
            onClick={openSignIn}
          >
            Try it free
            <ArrowRight className="ml-1.5 h-4 w-4" />
          </Button>
          <button
            className="text-sm text-zinc-500 hover:text-zinc-300 transition-colors flex items-center gap-1.5 cursor-pointer"
            onClick={() =>
              document
                .getElementById("how-it-works")
                ?.scrollIntoView({ behavior: "smooth" })
            }
          >
            How it works
            <ChevronDown className="h-3.5 w-3.5" />
          </button>
        </motion.div>
      </section>

      {/* ── Demo — featured live streams ── */}
      {featuredStreams.length > 0 && (
        <section className="relative z-10 px-6 pb-28 md:pb-36">
          <motion.div
            className="relative mx-auto max-w-5xl"
            initial={{ opacity: 0, y: 40 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 1, delay: 0.55, ease }}
          >
            <FeaturedCarousel streams={featuredStreams} />
            {/* Glow reflection beneath */}
            <div className="absolute -bottom-6 left-1/2 -translate-x-1/2 w-2/3 h-12 bg-emerald-500/[0.04] blur-2xl rounded-full pointer-events-none" />
          </motion.div>
        </section>
      )}

      {/* ── How It Works ── */}
      <section id="how-it-works" className="relative z-10 px-6 py-24 md:py-32">
        <div className="mx-auto max-w-5xl">
          <motion.div
            className="text-center mb-16"
            initial={{ opacity: 0 }}
            whileInView={{ opacity: 1 }}
            viewport={{ once: true, margin: "-100px" }}
            transition={{ duration: 0.4 }}
          >
            <h2 className="font-display text-3xl md:text-4xl text-white tracking-[-0.01em]">
              Live in 60 seconds
            </h2>
            <p className="mt-3 text-zinc-500 text-sm">
              Install, create, go live.
            </p>
          </motion.div>

          <div className="grid gap-6 md:grid-cols-3 mb-16">
            {[
              {
                num: "01",
                icon: Download,
                title: "Install",
                desc: "One command to install the Dazzle CLI. Authenticate with your account and you're ready to go.",
              },
              {
                num: "02",
                icon: Globe,
                title: "Create",
                desc: "Your agent gets its own browser in the cloud — with full graphics, audio, and a 30 FPS stream.",
              },
              {
                num: "03",
                icon: Radio,
                title: "Go live",
                desc: "Sync a folder, start streaming. Twitch, YouTube, or a shareable dazzle.fm link.",
              },
            ].map((step, i) => (
              <motion.div
                key={step.num}
                className="group relative rounded-2xl border border-white/[0.06] bg-white/[0.015] p-8 transition-all duration-300 hover:border-emerald-500/20 hover:bg-emerald-500/[0.02]"
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, margin: "-60px" }}
                transition={{ duration: 0.6, delay: i * 0.08, ease }}
              >
                <div className="flex items-center justify-between mb-5">
                  <span className="font-display text-5xl text-emerald-500/[0.12] leading-none">
                    {step.num}
                  </span>
                  <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-emerald-500/10 text-emerald-400 transition-colors group-hover:bg-emerald-500/15">
                    <step.icon className="h-5 w-5" />
                  </div>
                </div>
                <h3 className="text-lg font-semibold text-white mb-2">
                  {step.title}
                </h3>
                <p className="text-sm leading-relaxed text-zinc-400 font-light">
                  {step.desc}
                </p>
              </motion.div>
            ))}
          </div>

          <DemoSection />

          {/* Framework pills */}
          <motion.div
            className="mt-14 text-center"
            initial={{ opacity: 0 }}
            whileInView={{ opacity: 1 }}
            viewport={{ once: true, margin: "-40px" }}
            transition={{ duration: 0.4 }}
          >
            <p className="text-sm text-zinc-500 mb-4">
              Works with any agent. If it can write code and run a shell, it can go live.
            </p>
            <div className="flex flex-wrap justify-center gap-3">
              {FRAMEWORKS.map((name, i) => (
                <motion.span
                  key={name}
                  className="rounded-full border border-white/[0.08] bg-white/[0.02] px-5 py-2 text-sm text-zinc-400 transition-colors hover:border-emerald-500/20 hover:text-zinc-300"
                  initial={{ opacity: 0, scale: 0.95 }}
                  whileInView={{ opacity: 1, scale: 1 }}
                  viewport={{ once: true }}
                  transition={{ duration: 0.3, delay: i * 0.04 }}
                >
                  {name}
                </motion.span>
              ))}
            </div>
          </motion.div>
        </div>
      </section>

      {/* ── Final CTA ── */}
      <section className="relative z-10 px-6 py-28 md:py-36 text-center">
        <motion.div
          initial={{ opacity: 0 }}
          whileInView={{ opacity: 1 }}
          viewport={{ once: true, margin: "-80px" }}
          transition={{ duration: 0.4 }}
        >
          <h2 className="font-display text-[clamp(1.8rem,4vw,3rem)] leading-[1.1] tracking-[-0.02em] text-white max-w-2xl mx-auto">
            Ready to go <LiveText>live?</LiveText>
          </h2>
          <p className="mt-4 text-zinc-500 text-sm">
            Free during beta. No credit card required.
          </p>
          <Button
            size="lg"
            className="mt-8 bg-emerald-500 text-zinc-950 hover:bg-emerald-400 font-semibold text-base px-8 h-12"
            onClick={openSignIn}
          >
            Create your first stage
            <ArrowRight className="ml-1.5 h-4 w-4" />
          </Button>
        </motion.div>
      </section>

      {/* ── Footer ── */}
      <footer className="relative z-10 border-t border-white/[0.04] py-8">
        <div className="flex items-center justify-center gap-4 text-xs text-zinc-600">
          <span>dazzle.fm &middot; &copy; 2026 Dazzle</span>
          <span className="text-zinc-800">&middot;</span>
          <Link to="/live" className="hover:text-zinc-400 transition-colors">
            Live
          </Link>
          <Link to="/docs" className="hover:text-zinc-400 transition-colors">
            Docs
          </Link>
          <Link to="/terms" className="hover:text-zinc-400 transition-colors">
            Terms
          </Link>
          <Link to="/privacy" className="hover:text-zinc-400 transition-colors">
            Privacy
          </Link>
          <a
            href="/llms.txt"
            target="_blank"
            rel="noopener noreferrer"
            className="font-mono hover:text-zinc-400 transition-colors"
          >
            llms.txt
          </a>
        </div>
      </footer>

      {/* ── Sign In Dialog ── */}
      <Dialog open={signInOpen} onOpenChange={setSignInOpen}>
        <DialogContent
          className="bg-transparent ring-0 shadow-none p-0 gap-0 sm:max-w-fit max-w-fit"
          showCloseButton={false}
        >
          <DialogTitle className="sr-only">Sign in to Dazzle</DialogTitle>
          <SignIn />
        </DialogContent>
      </Dialog>
    </div>
  );
}
