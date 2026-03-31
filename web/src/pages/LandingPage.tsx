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
import { installCommand } from "@/lib/cli-commands";
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

function getTerminalLines(): { type: "cmd" | "out"; text: string }[] {
  return [
  { type: "cmd", text: installCommand() },
  { type: "out", text: "Dazzle CLI installed." },
  { type: "out", text: "" },
  { type: "cmd", text: "dazzle login" },
  { type: "out", text: "\u2713 Logged in as you@example.com" },
  { type: "out", text: "" },
  { type: "cmd", text: "dazzle stage create aurora" },
  { type: "out", text: 'Stage "aurora" created.' },
  { type: "out", text: "" },
  { type: "cmd", text: "npm run build" },
  { type: "out", text: "\u2713 Built in 0.8s \u2014 dist/index.html (42 KB)" },
  { type: "out", text: "" },
  { type: "cmd", text: "dazzle stage sync ./dist" },
  { type: "out", text: "3 files synced." },
  { type: "out", text: "" },
  { type: "cmd", text: "dazzle stage up" },
  { type: "out", text: "Stage is live at https://dazzle.fm/s/aurora" },
  ];
}

const REACT_CODE = `import { useRef, useMemo } from 'react'
import { Canvas, useFrame } from '@react-three/fiber'
import { Points, PointMaterial } from '@react-three/drei'
import { fragment } from './warp.glsl'

function Particles({ count = 4000 }) {
  const ref = useRef<Points>(null)
  const positions = useMemo(() => {
    const p = new Float32Array(count * 3)
    for (let i = 0; i < count; i++) {
      const theta = Math.random() * Math.PI * 2
      const r = 1.5 + Math.random() * 3
      p[i * 3] = Math.cos(theta) * r
      p[i * 3 + 1] = (Math.random() - 0.5) * 4
      p[i * 3 + 2] = Math.sin(theta) * r
    }
    return p
  }, [count])

  useFrame((_, dt) => {
    ref.current!.rotation.y += dt * 0.08
    ref.current!.rotation.x = Math.sin(Date.now() * 0.0003) * 0.2
  })

  return (
    <Points ref={ref} positions={positions} stride={3}>
      <PointMaterial size={0.02} color="#34d399"
        transparent opacity={0.8} sizeAttenuation />
    </Points>
  )
}

export default function Stage() {
  return (
    <Canvas camera={{ position: [0, 0, 5], fov: 60 }}>
      <color attach="background" args={['#050505']} />
      <Particles />
      <mesh scale={[20, 20, 1]} position={[0, 0, -3]}>
        <planeGeometry />
        <shaderMaterial fragmentShader={fragment}
          uniforms={{ uTime: { value: 0 } }} />
      </mesh>
    </Canvas>
  )
}`;

const SHADER_CODE = `precision highp float;
uniform float uTime;
varying vec2 vUv;

// fbm noise for organic flow
float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5);
}

float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x),
             mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y);
}

float fbm(vec2 p) {
  float v = 0.0, a = 0.5;
  for (int i = 0; i < 5; i++) {
    v += a * noise(p);
    p = p * 2.1 + vec2(1.7, 9.2);
    a *= 0.5;
  }
  return v;
}

void main() {
  vec2 uv = vUv * 3.0;
  float t = uTime * 0.15;

  float n1 = fbm(uv + vec2(t, -t * 0.7));
  float n2 = fbm(uv + vec2(-t * 0.5, t) + n1 * 1.5);

  vec3 col = mix(
    vec3(0.04, 0.12, 0.08),  // deep emerald
    vec3(0.1, 0.9, 0.5),      // bright green
    smoothstep(0.3, 0.7, n2)
  );
  col = mix(col, vec3(0.0, 0.3, 0.6), smoothstep(0.5, 0.9, n1));
  col *= 0.6 + 0.4 * n2;

  gl_FragColor = vec4(col, 1.0);
}`;

const PREVIEW_HTML = `<!DOCTYPE html><html><head><meta charset="utf-8">
<style>*{margin:0;overflow:hidden;background:#050505}canvas{position:absolute;top:0;left:0;width:100%;height:100%}</style>
</head><body>
<canvas id="bg"></canvas><canvas id="fg"></canvas>
<script>
const bg=document.getElementById('bg'),fg=document.getElementById('fg');
const gl=bg.getContext('webgl'),ctx=fg.getContext('2d');

function resize(){
  const w=innerWidth,h=innerHeight;
  bg.width=w;bg.height=h;fg.width=w;fg.height=h;
  gl.viewport(0,0,w,h);
}
resize();
addEventListener('resize',resize);

const vs=gl.createShader(gl.VERTEX_SHADER);
gl.shaderSource(vs,'attribute vec2 p;varying vec2 vUv;void main(){vUv=p*.5+.5;gl_Position=vec4(p,0,1);}');
gl.compileShader(vs);
const fs=gl.createShader(gl.FRAGMENT_SHADER);
gl.shaderSource(fs,\`precision highp float;uniform float uTime;varying vec2 vUv;
float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5);}
float noise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.0-2.0*f);
return mix(mix(hash(i),hash(i+vec2(1,0)),f.x),mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),f.x),f.y);}
float fbm(vec2 p){float v=0.0,a=0.5;for(int i=0;i<5;i++){v+=a*noise(p);p=p*2.1+vec2(1.7,9.2);a*=0.5;}return v;}
void main(){vec2 uv=vUv*3.0;float t=uTime*0.15;
float n1=fbm(uv+vec2(t,-t*0.7));float n2=fbm(uv+vec2(-t*0.5,t)+n1*1.5);
vec3 col=mix(vec3(0.04,0.12,0.08),vec3(0.1,0.9,0.5),smoothstep(0.3,0.7,n2));
col=mix(col,vec3(0.0,0.3,0.6),smoothstep(0.5,0.9,n1));col*=0.6+0.4*n2;
gl_FragColor=vec4(col,1.0);}\`);
gl.compileShader(fs);
const pg=gl.createProgram();gl.attachShader(pg,vs);gl.attachShader(pg,fs);
gl.linkProgram(pg);gl.useProgram(pg);
const buf=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,buf);
gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([-1,-1,1,-1,-1,1,1,1]),gl.STATIC_DRAW);
const loc=gl.getAttribLocation(pg,'p');gl.enableVertexAttribArray(loc);
gl.vertexAttribPointer(loc,2,gl.FLOAT,false,0,0);
const tLoc=gl.getUniformLocation(pg,'uTime');

const N=300,pts=[];
for(let i=0;i<N;i++){const a=Math.random()*Math.PI*2,r=0.15+Math.random()*0.35;
pts.push({a,r,s:0.3+Math.random()*0.7,sz:1+Math.random()*2});}

let t=0;
(function draw(){t+=0.016;
gl.viewport(0,0,bg.width,bg.height);
gl.uniform1f(tLoc,t);gl.drawArrays(gl.TRIANGLE_STRIP,0,4);
const w=fg.width,h=fg.height;
ctx.clearRect(0,0,w,h);
for(const p of pts){
const px=w/2+Math.cos(p.a+t*p.s)*p.r*w;
const py=h/2+Math.sin(p.a+t*p.s*0.7)*p.r*h*0.6+Math.sin(t*0.3)*20;
ctx.beginPath();ctx.arc(px,py,p.sz,0,7);
ctx.fillStyle='rgba(52,211,153,'+(0.4+0.4*Math.sin(t+p.a))+')';ctx.fill();}
requestAnimationFrame(draw)})();
<\/script></body></html>`;

type CodeFile = { name: string; code: string; language: string }
const CODE_FILES: CodeFile[] = [
  { name: "Aurora.tsx", code: REACT_CODE, language: "typescript" },
  { name: "aurora.glsl", code: SHADER_CODE, language: "glsl" },
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

    if (currentLine.type === "out" || (currentLine.type === "cmd" && typedChars >= currentLine.text.length)) {
      const delay = currentLine.type === "cmd" ? 400 : currentLine.text === "" ? 200 : 300;
      const timer = setTimeout(() => {
        setVisibleLines((v) => v + 1);
        setTypedChars(0);
      }, delay);
      return () => clearTimeout(timer);
    }

    const speed = 30 + Math.random() * 40;
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
          <span className="flex-1 text-center text-xs text-zinc-500 font-sans">aurora — dazzle.fm</span>
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
              <div className="overflow-auto max-h-[300px]">
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
            <span className="px-3 py-1.5 text-[11px] font-mono text-zinc-400 uppercase tracking-wider">terminal</span>
          </div>
          <div ref={terminalRef} className="px-5 py-3 font-mono text-[13px] leading-relaxed bg-[#1e1e1e] h-[260px] overflow-auto">
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

              if (line.type === "cmd") {
                const chars = isCurrentLine ? typedChars : line.text.length;
                const typed = line.text.slice(0, chars);
                const showCursor = isCurrentLine && chars < line.text.length;
                return (
                  <div key={i}>
                    <span className="text-emerald-400">$ </span>
                    <span className="text-zinc-200">{typed}</span>
                    {showCursor && (
                      <span className={`inline-block w-[8px] h-[14px] -mb-[2px] ml-px ${cursorVisible ? "bg-emerald-400" : "bg-transparent"}`} />
                    )}
                  </div>
                );
              }

              if (isCurrentLine && line.type === "out") {
                return (
                  <div key={i} className="text-zinc-500 animate-in fade-in duration-200">
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
