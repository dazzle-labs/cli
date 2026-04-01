import type { ReactNode } from "react";

export type TermLine = {
  type: "cmd" | "exec" | "out" | "agent" | "user";
  text: string;
};

export type CodeFile = { name: string; code: string; language: string };

export interface PersonaConfig {
  id: string;
  // Hero
  headline: ReactNode;
  subtitle: string;
  ctaText: string;
  ctaFinalText: string;
  // How It Works — step 2 description (steps 1 & 3 are shared)
  stepCreateDesc: string;
  // Demo
  terminalLines: TermLine[];
  codeFiles: CodeFile[];
  previewHtml: string;
  demoTitleBar: string;
  statusBarLanguage: string;
  // Framework pills
  frameworksLabel: string;
  frameworks: string[];
}

// ─── Agents (default) ────────────────────────────────────────────────────────

const AGENTS_TERMINAL: TermLine[] = [
  { type: "user", text: "build a live space launch tracker and stream it \u2014 show upcoming launches and update the stream as you learn more about each one" },
  { type: "out", text: "" },
  { type: "agent", text: "On it. Reading dazzle.fm/llms.txt for the API..." },
  { type: "out", text: "" },
  { type: "exec", text: "curl -sSL https://dazzle.fm/install.sh | sh" },
  { type: "out", text: "Dazzle CLI v0.9.2 installed." },
  { type: "exec", text: "dazzle login" },
  { type: "out", text: "\u2713 Logged in" },
  { type: "cmd", text: "dazzle stage create launch-tracker" },
  { type: "out", text: 'Stage "launch-tracker" created.' },
  { type: "out", text: "" },
  { type: "agent", text: "Writing the frontend \u2014 React + GLSL shader background, listening for dazzle:event updates" },
  { type: "out", text: "" },
  { type: "exec", text: "npm create vite@latest . -- --template react-ts && npm i" },
  { type: "out", text: "\u2713 Scaffolded React + TypeScript project" },
  { type: "cmd", text: "npm run build" },
  { type: "out", text: "\u2713 Built in 0.8s" },
  { type: "cmd", text: "dazzle stage up --stage launch-tracker" },
  { type: "out", text: "\u2713 Stage activated \u2014 GPU rendering at 30 FPS." },
  { type: "cmd", text: "dazzle stage sync ./dist --stage launch-tracker" },
  { type: "out", text: "5 files synced." },
  { type: "out", text: "" },
  { type: "agent", text: "Stage is live. Starting research loop \u2014 I'll search for news, analyze what's interesting, push findings to the stream, sleep, and repeat." },
  { type: "out", text: "" },
  { type: "agent", text: "\u23f0 Loop 1 \u2014 searching for upcoming launches..." },
  { type: "exec", text: "curl -s api.spacexdata.com/v5/launches/upcoming | jq '.[0:5]'" },
  { type: "out", text: "\u2713 Found 5 upcoming launches" },
  { type: "agent", text: "Starlink Group 12-7 is next, T-14h from Vandenberg. Let me search for context..." },
  { type: "out", text: "" },
  { type: "exec", text: `web_search "Starlink Group 12-7 launch Vandenberg site:reddit.com OR site:spacenews.com"` },
  { type: "out", text: "\u2713 8 results" },
  { type: "agent", text: "Found a SpaceNews article \u2014 this is the first v2 Mini batch with direct-to-cell capability. That's worth highlighting." },
  { type: "cmd", text: `dazzle stage event emit launch-tracker '{"type":"launch","mission":"Starlink Group 12-7","vehicle":"Falcon 9","site":"Vandenberg SFB","t_minus":"14h 22m","status":"GO","payload":"23 Starlink v2 Mini \u2014 first direct-to-cell batch"}'` },
  { type: "out", text: "\u2713 Event emitted \u2014 stream updated live" },
  { type: "out", text: "" },
  { type: "agent", text: "Checking if weather could be an issue at Vandenberg today..." },
  { type: "exec", text: `web_search "Vandenberg SFB launch weather forecast today"` },
  { type: "out", text: "\u2713 5 results" },
  { type: "agent", text: "45th Weather Squadron gives 90% GO. Marine layer clears by T-2h. Updating..." },
  { type: "cmd", text: `dazzle stage event emit launch-tracker '{"type":"update","mission":"Starlink Group 12-7","weather":"90% GO \u2014 marine layer clears by T-2h","note":"Drone ship JRTI positioned 640km downrange"}'` },
  { type: "out", text: "\u2713 Event emitted" },
  { type: "out", text: "" },
  { type: "agent", text: "Also spotted Crew-12 ISS mission in 3 days. Searching for crew details..." },
  { type: "exec", text: `web_search "NASA Crew-12 ISS mission crew manifest 2026"` },
  { type: "out", text: "\u2713 6 results" },
  { type: "agent", text: "NASA.gov confirms 4-person crew. Epps will break the record for longest ISS stay. Adding to stream..." },
  { type: "cmd", text: `dazzle stage event emit launch-tracker '{"type":"launch","mission":"Crew-12","vehicle":"Falcon 9","site":"Kennedy Space Center","t_minus":"3d 6h","status":"GO","crew":["Petty","Epps","Dyson","Dominick"],"note":"Epps sets new ISS duration record"}'` },
  { type: "out", text: "\u2713 Event emitted" },
  { type: "out", text: "" },
  { type: "agent", text: "Loop 1 done. Sleeping 10 minutes before next check..." },
  { type: "exec", text: "sleep 600" },
  { type: "out", text: "" },
  { type: "agent", text: "\u23f0 Loop 2 \u2014 waking up. Searching for any new developments..." },
  { type: "exec", text: `web_search "Starlink launch today site:twitter.com OR site:x.com"` },
  { type: "out", text: "\u2713 12 results" },
  { type: "agent", text: "Elon just posted static fire video. T-minus now 4h. Pushing update..." },
  { type: "cmd", text: `dazzle stage event emit launch-tracker '{"type":"update","mission":"Starlink Group 12-7","t_minus":"4h 02m","note":"Static fire complete \u2014 propellant loading at T-45m"}'` },
  { type: "out", text: "\u2713 Event emitted \u2014 stream updated live" },
  { type: "out", text: "" },
  { type: "agent", text: "Loop 2 done. Sleeping 10 minutes..." },
];

const AGENTS_APP = `import { useState, useEffect, useRef } from 'react'
import { useDazzleEvents } from './hooks'

interface Launch {
  mission: string; vehicle: string; site: string
  t_minus: string; status: string
  weather?: string; payload?: string; crew?: string[]
}

// Fragment shader — animated nebula background
const FRAG = \`
  precision mediump float;
  uniform float u_time;
  uniform vec2 u_resolution;

  float noise(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
  }
  float fbm(vec2 p) {
    float v = 0.0, a = 0.5;
    for (int i = 0; i < 5; i++) {
      v += a * noise(p);
      p = p * 2.0 + vec2(1.7, 9.2);
      a *= 0.5;
    }
    return v;
  }
  void main() {
    vec2 uv = gl_FragCoord.xy / u_resolution;
    float t = u_time * 0.15;
    float n = fbm(uv * 3.0 + t);
    vec3 col = mix(
      vec3(0.02, 0.03, 0.08),
      vec3(0.1, 0.2, 0.5),
      n * 0.6
    );
    gl_FragColor = vec4(col, 1.0);
  }
\`

function ShaderBg() {
  const canvas = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const gl = canvas.current!.getContext('webgl')!
    // ... compile FRAG, render loop with u_time
  }, [])
  return <canvas ref={canvas} className="absolute inset-0" />
}

export default function App() {
  const [launches, setLaunches] = useState<Launch[]>([])

  // Listen for agent events pushed via:
  //   dazzle stage event emit <stage> '{...}'
  useDazzleEvents((data) => {
    if (data.type === 'launch')
      setLaunches(prev => [...prev, data])
    if (data.type === 'update')
      setLaunches(prev => prev.map(l =>
        l.mission === data.mission ? { ...l, ...data } : l
      ))
  })

  return (
    <div className="relative h-screen bg-[#0a0a0f]">
      <ShaderBg />
      <div className="relative z-10 p-8 space-y-4">
        <h1 className="text-xs tracking-widest text-zinc-500">
          UPCOMING LAUNCHES
        </h1>
        {launches.map(l => (
          <LaunchCard key={l.mission} launch={l} />
        ))}
      </div>
    </div>
  )
}`;

const AGENTS_SHADER = `// hooks.ts — Dazzle event bridge
import { useEffect, useCallback } from 'react'

type EventHandler = (data: any) => void

export function useDazzleEvents(handler: EventHandler) {
  const cb = useCallback(handler, [])

  useEffect(() => {
    const listener = (e: Event) => {
      cb((e as CustomEvent).detail)
    }
    window.addEventListener('dazzle:event', listener)
    return () => window.removeEventListener('dazzle:event', listener)
  }, [cb])
}`;

const AGENTS_PREVIEW = `<!DOCTYPE html><html><head><meta charset="utf-8">
<style>*{margin:0;box-sizing:border-box}
body{overflow:hidden;height:100vh;background:#050510}
canvas#stars{position:absolute;top:0;left:0;width:100%;height:100%}
.overlay{position:relative;z-index:1;padding:10px;font-family:'SF Mono',Menlo,monospace}
h1{font-size:5px;color:rgba(161,161,170,0.7);font-weight:400;text-transform:uppercase;letter-spacing:0.12em;margin-bottom:8px}
.launch{border-left:1px solid rgba(34,197,94,0.25);padding:4px 6px;margin-bottom:5px;opacity:0;animation:slideIn 0.5s ease forwards;
background:rgba(10,10,20,0.55);backdrop-filter:blur(6px);border-radius:0 3px 3px 0}
.launch.featured{border-left-color:#34d399;box-shadow:0 0 12px rgba(52,211,153,0.06)}
.status-row{display:flex;justify-content:space-between;align-items:center}
.status{font-size:3.5px;font-weight:700;letter-spacing:0.12em;padding:0.5px 2px;border-radius:1px}
.GO{color:#34d399;background:rgba(52,211,153,0.1)}
.t-minus{color:#93c5fd;font-size:3.5px;font-weight:500}
h2{font-size:5.5px;color:#f4f4f5;margin:1.5px 0 1px;font-weight:600;letter-spacing:-0.01em}
.meta{font-size:3.5px;color:#71717a}
.detail,.note{font-size:3px;color:#52525b;margin-top:0.8px}
.crew{font-size:3px;color:#c4b5fd;margin-top:0.8px}
@keyframes slideIn{from{opacity:0;transform:translateY(3px)}to{opacity:1;transform:translateY(0)}}
</style></head><body>
<canvas id="stars"></canvas>
<div class="overlay">
<h1>Upcoming Launches</h1>
<div id="launches"></div>
</div>
<script>
// Canvas starfield + slow-drifting nebula glow (no WebGL — works everywhere)
var c=document.getElementById('stars'),x=c.getContext('2d');
var dpr=Math.min(devicePixelRatio||1,2);
c.width=c.clientWidth*dpr;c.height=c.clientHeight*dpr;x.scale(dpr,dpr);
var W=c.clientWidth,H=c.clientHeight;
// Stars
var stars=[];for(var i=0;i<80;i++)stars.push({x:Math.random()*W,y:Math.random()*H,r:Math.random()*0.8+0.2,a:Math.random()*0.7+0.3,s:Math.random()*3+1});
// Nebula blobs
var blobs=[
{x:W*0.2,y:H*0.3,r:W*0.5,h:220,s:0.7,a:0.08,dx:0.08,dy:0.05},
{x:W*0.7,y:H*0.6,r:W*0.4,h:270,s:0.6,a:0.06,dx:-0.06,dy:0.07},
{x:W*0.5,y:H*0.8,r:W*0.35,h:180,s:0.5,a:0.05,dx:0.04,dy:-0.03}
];
var t=0;
function draw(){t++;
x.fillStyle='#050510';x.fillRect(0,0,W,H);
// Nebula
for(var i=0;i<blobs.length;i++){var b=blobs[i];
b.x+=b.dx;b.y+=b.dy;
if(b.x<-W*0.3||b.x>W*1.3)b.dx*=-1;
if(b.y<-H*0.3||b.y>H*1.3)b.dy*=-1;
var g=x.createRadialGradient(b.x,b.y,0,b.x,b.y,b.r);
g.addColorStop(0,'hsla('+b.h+','+b.s*100+'%,45%,'+b.a+')');
g.addColorStop(0.5,'hsla('+b.h+','+b.s*100+'%,30%,'+(b.a*0.4)+')');
g.addColorStop(1,'transparent');
x.fillStyle=g;x.fillRect(0,0,W,H);}
// Stars with twinkle
for(var i=0;i<stars.length;i++){var s=stars[i];
var tw=0.5+0.5*Math.sin(t*0.03*s.s+i);
x.globalAlpha=s.a*tw;
x.fillStyle='#e0e8ff';
x.beginPath();x.arc(s.x,s.y,s.r,0,6.28);x.fill();}
x.globalAlpha=1;
requestAnimationFrame(draw);}
draw();
// Launch cards
var launches=[
{mission:'Starlink Group 12-7',vehicle:'Falcon 9',site:'Vandenberg SFB',t_minus:'14h 22m',status:'GO',payload:'23 v2 Mini \u2014 first direct-to-cell',note:'Drone ship JRTI 640km downrange'},
{mission:'Crew-12',vehicle:'Falcon 9',site:'Kennedy Space Center',t_minus:'3d 6h',status:'GO',crew:['Petty','Epps','Dyson','Dominick'],note:'Epps sets ISS duration record'}
];
var el=document.getElementById('launches');
var shown=0;
function render(){
el.innerHTML='';
for(var i=0;i<shown;i++){var l=launches[i];
var d=document.createElement('div');d.className='launch'+(i===0?' featured':'');
d.style.animationDelay=i*0.12+'s';
var h='<div class="status-row"><span class="status '+l.status+'">'+l.status+'</span><span class="t-minus">T\\u2212'+l.t_minus+'</span></div>';
h+='<h2>'+l.mission+'</h2>';
h+='<div class="meta">'+l.vehicle+' \\u00b7 '+l.site+'</div>';
if(l.payload)h+='<div class="detail">'+l.payload+'</div>';
if(l.crew)h+='<div class="crew">'+l.crew.join(' \\u00b7 ')+'</div>';
if(l.note)h+='<div class="note">'+l.note+'</div>';
d.innerHTML=h;el.appendChild(d);}}
function next(){if(shown<launches.length){shown++;render();setTimeout(next,2200);}
else{setTimeout(function(){shown=0;render();setTimeout(next,1800);},5000);}}
setTimeout(next,600);
<\/script></body></html>`;

// ─── Creative Coder ──────────────────────────────────────────────────────────

const CREATIVE_TERMINAL: TermLine[] = [
  { type: "user", text: "read dazzle.fm/llms.txt \u2014 I want a particle flow field, ink-on-water feel, shifting warm-to-cool palette. stream it forever on twitch" },
  { type: "out", text: "" },
  { type: "agent", text: "Beautiful brief. I'll build a Canvas 2D flow field with long fade trails and hue drift:" },
  { type: "out", text: "" },
  { type: "exec", text: "curl -sSL https://dazzle.fm/install.sh | sh" },
  { type: "out", text: "Dazzle CLI installed." },
  { type: "out", text: "" },
  { type: "exec", text: "dazzle login" },
  { type: "out", text: "\u2713 Logged in as you@example.com" },
  { type: "out", text: "" },
  { type: "user", text: "done, go ahead" },
  { type: "out", text: "" },
  { type: "cmd", text: "dazzle stage create flow-field" },
  { type: "out", text: 'Stage "flow-field" created.' },
  { type: "out", text: "" },
  { type: "agent", text: "Wrote sketch.js \u2014 3000 particles, layered simplex noise for organic curl, semi-transparent trails that bloom over time" },
  { type: "out", text: "" },
  { type: "cmd", text: "dazzle stage up --stage flow-field" },
  { type: "out", text: "\u2713 Stage activated \u2014 GPU rendering at 30 FPS." },
  { type: "out", text: "" },
  { type: "cmd", text: "dazzle stage sync . --stage flow-field" },
  { type: "out", text: "2 files synced." },
  { type: "out", text: "" },
  { type: "agent", text: "Live at dazzle.fm/s/flow-field \u2014 the hue drifts from amber through violet on a ~90 second cycle" },
  { type: "out", text: "" },
  { type: "user", text: "stream it to twitch too" },
  { type: "out", text: "" },
  { type: "cmd", text: "dazzle destination add twitch" },
  { type: "out", text: '\u2713 Destination "twitch" added.' },
  { type: "out", text: "" },
  { type: "cmd", text: "dazzle destination attach twitch --stage flow-field" },
  { type: "out", text: "\u2713 Streaming to twitch.tv" },
];

const CREATIVE_SKETCH = `const canvas = document.querySelector('canvas')
const ctx = canvas.getContext('2d')
const W = canvas.width = innerWidth
const H = canvas.height = innerHeight

// flow field config
const SCALE = 0.0025
const DRIFT = 0.006
const DAMPING = 0.96
const FORCE = 0.6
let epoch = 0

// layered noise — two octaves for organic curl
function flow(x, y) {
  const n1 = Math.sin(x * 1.4 + epoch) * Math.cos(y * 0.9 - epoch * 0.6)
  const n2 = Math.sin((x - y) * 0.7 + epoch * 1.1) * 0.4
  const n3 = Math.cos(x * 0.3 + y * 1.6 + epoch * 0.4) * 0.3
  return n1 + n2 + n3
}

// seed particles with staggered hue
const swarm = Array.from({ length: 3000 }, (_, i) => ({
  x: Math.random() * W,
  y: Math.random() * H,
  vx: 0, vy: 0,
  hue: (i / 3000) * 360,
  r: 0.8 + Math.random() * 1.5,
}))

function render() {
  // fade trail — low alpha for long ink-like persistence
  ctx.fillStyle = 'rgba(8, 6, 12, 0.025)'
  ctx.fillRect(0, 0, W, H)
  epoch += DRIFT

  // global hue offset drifts over ~90s
  const hueShift = epoch * 8

  for (const p of swarm) {
    const angle = flow(p.x * SCALE, p.y * SCALE) * Math.PI * 2
    p.vx = p.vx * DAMPING + Math.cos(angle) * FORCE
    p.vy = p.vy * DAMPING + Math.sin(angle) * FORCE
    p.x += p.vx
    p.y += p.vy

    // wrap edges
    if (p.x < 0) p.x += W; if (p.x > W) p.x -= W
    if (p.y < 0) p.y += H; if (p.y > H) p.y -= H

    const h = (p.hue + hueShift) % 360
    ctx.beginPath()
    ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2)
    ctx.fillStyle = \`hsla(\${h}, 72%, 62%, 0.7)\`
    ctx.fill()
  }
  requestAnimationFrame(render)
}
render()`;

const CREATIVE_HTML = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    * { margin: 0 }
    body { overflow: hidden; background: #08060c }
    canvas { display: block; width: 100vw; height: 100vh }
  </style>
</head>
<body>
  <canvas></canvas>
  <script src="sketch.js"></script>
</body>
</html>`;

const CREATIVE_PREVIEW = `<!DOCTYPE html><html><head><meta charset="utf-8">
<style>*{margin:0}body{overflow:hidden;background:#08060c}canvas{display:block;width:100vw;height:100vh}</style>
</head><body><canvas></canvas><script>
var c=document.querySelector('canvas'),x=c.getContext('2d');
c.width=c.clientWidth;c.height=c.clientHeight;
var W=c.width,H=c.height,SC=0.0025,DR=0.006,DA=0.96,F=0.6,ep=0;
function fl(a,b){return Math.sin(a*1.4+ep)*Math.cos(b*0.9-ep*0.6)+Math.sin((a-b)*0.7+ep*1.1)*0.4+Math.cos(a*0.3+b*1.6+ep*0.4)*0.3}
var ps=[];for(var i=0;i<1200;i++)ps.push({x:Math.random()*W,y:Math.random()*H,vx:0,vy:0,h:(i/1200)*360,r:0.6+Math.random()*1.2});
function draw(){x.fillStyle='rgba(8,6,12,0.022)';x.fillRect(0,0,W,H);ep+=DR;
var hs=ep*8;
for(var i=0;i<ps.length;i++){var p=ps[i],a=fl(p.x*SC,p.y*SC)*Math.PI*2;
p.vx=p.vx*DA+Math.cos(a)*F;p.vy=p.vy*DA+Math.sin(a)*F;
p.x+=p.vx;p.y+=p.vy;
if(p.x<0)p.x+=W;if(p.x>W)p.x-=W;
if(p.y<0)p.y+=H;if(p.y>H)p.y-=H;
var h=(p.h+hs)%360;
x.beginPath();x.arc(p.x,p.y,p.r,0,Math.PI*2);
x.fillStyle='hsla('+h+',72%,62%,0.7)';x.fill()}
requestAnimationFrame(draw)}draw();
<\/script></body></html>`;

// ─── Live Data ───────────────────────────────────────────────────────────────

const DATA_TERMINAL: TermLine[] = [
  { type: "user", text: "read dazzle.fm/llms.txt \u2014 build a live earthquake viz from the USGS feed and stream it 24/7 on YouTube" },
  { type: "out", text: "" },
  { type: "agent", text: "I'll use the USGS all_day.geojson endpoint. It returns ~150 quakes with magnitude, coordinates, and depth. Let me set up a Dazzle stage:" },
  { type: "out", text: "" },
  { type: "exec", text: "curl -sSL https://dazzle.fm/install.sh | sh" },
  { type: "out", text: "Dazzle CLI installed." },
  { type: "out", text: "" },
  { type: "exec", text: "dazzle login" },
  { type: "out", text: "\u2713 Logged in as you@example.com" },
  { type: "out", text: "" },
  { type: "user", text: "done, go ahead" },
  { type: "out", text: "" },
  { type: "cmd", text: "dazzle stage create earth-pulse" },
  { type: "out", text: 'Stage "earth-pulse" created.' },
  { type: "out", text: "" },
  { type: "agent", text: "Writing feed.ts \u2014 Mercator projection, pulsing magnitude rings, 5-min polling against earthquake.usgs.gov" },
  { type: "out", text: "" },
  { type: "cmd", text: "npm run build" },
  { type: "out", text: "\u2713 Built in 0.7s" },
  { type: "out", text: "" },
  { type: "cmd", text: "dazzle stage up --stage earth-pulse" },
  { type: "out", text: "\u2713 Stage activated \u2014 GPU rendering at 30 FPS." },
  { type: "out", text: "" },
  { type: "cmd", text: "dazzle stage sync ./dist --stage earth-pulse" },
  { type: "out", text: "4 files synced." },
  { type: "out", text: "" },
  { type: "agent", text: "Live at dazzle.fm/s/earth-pulse \u2014 142 quakes from the last 24h, auto-refreshing every 5 min" },
  { type: "out", text: "" },
  { type: "user", text: "stream it to youtube" },
  { type: "out", text: "" },
  { type: "cmd", text: "dazzle destination add youtube" },
  { type: "out", text: '\u2713 Destination "youtube" added.' },
  { type: "out", text: "" },
  { type: "cmd", text: "dazzle destination attach youtube --stage earth-pulse" },
  { type: "out", text: "\u2713 Streaming to youtube.com" },
];

const DATA_FEED = `const USGS = 'https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/all_day.geojson'

interface Quake {
  lat: number; lon: number; mag: number
  time: number; age: number; ripple: number
}

let quakes: Quake[] = []

async function fetchQuakes() {
  const res = await fetch(USGS)
  const { features } = await res.json()
  const now = Date.now()

  quakes = features.map((f: any) => {
    const [lon, lat] = f.geometry.coordinates
    return {
      lat, lon,
      mag: f.properties.mag ?? 0,
      time: f.properties.time,
      age: Math.max(0, 1 - (now - f.properties.time) / 86_400_000),
      ripple: Math.random(),
    }
  })
  document.getElementById('count')!.textContent = String(quakes.length)
}

fetchQuakes()
setInterval(fetchQuakes, 300_000)

function project(lat: number, lon: number, w: number, h: number) {
  return {
    x: ((lon + 180) / 360) * w,
    y: ((90 - lat) / 180) * h,
  }
}

const canvas = document.querySelector('canvas')!
const ctx = canvas.getContext('2d')!
canvas.width = innerWidth
canvas.height = innerHeight

function draw() {
  ctx.fillStyle = 'rgba(0, 4, 12, 0.12)'
  ctx.fillRect(0, 0, canvas.width, canvas.height)

  for (const q of quakes) {
    const { x, y } = project(q.lat, q.lon, canvas.width, canvas.height)
    const r = 1.5 + q.mag * 2.5
    const a = 0.3 + q.age * 0.7

    q.ripple = (q.ripple + 0.015) % 1
    const ring = r + q.ripple * 24
    ctx.beginPath()
    ctx.arc(x, y, ring, 0, Math.PI * 2)
    ctx.strokeStyle = \`rgba(239,68,68,\${(1 - q.ripple) * a * 0.4})\`
    ctx.lineWidth = 1
    ctx.stroke()

    const glow = ctx.createRadialGradient(x, y, 0, x, y, r * 3)
    glow.addColorStop(0, \`rgba(239,68,68,\${a * 0.6})\`)
    glow.addColorStop(1, 'rgba(239,68,68,0)')
    ctx.beginPath()
    ctx.arc(x, y, r * 3, 0, Math.PI * 2)
    ctx.fillStyle = glow
    ctx.fill()

    ctx.beginPath()
    ctx.arc(x, y, r, 0, Math.PI * 2)
    ctx.fillStyle = \`rgba(255,120,100,\${a})\`
    ctx.fill()
  }

  requestAnimationFrame(draw)
}
draw()`;

const DATA_INDEX = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    * { margin: 0; box-sizing: border-box }
    body {
      background: #000810;
      overflow: hidden;
      font-family: system-ui, sans-serif;
    }
    canvas {
      display: block;
      width: 100vw;
      height: 100vh;
    }
    .hud {
      position: absolute;
      top: 16px;
      left: 16px;
      color: rgba(255,255,255,0.5);
      font-size: 11px;
      font-family: 'SF Mono', 'Fira Code', monospace;
    }
    .hud .count {
      color: #ef4444;
      font-size: 22px;
      font-weight: 700;
      text-shadow: 0 0 12px rgba(239,68,68,0.5);
    }
    .hud .label {
      color: rgba(255,255,255,0.35);
      text-transform: uppercase;
      letter-spacing: 0.12em;
      font-size: 9px;
    }
    .hud .src {
      color: rgba(255,255,255,0.25);
      font-size: 9px;
      margin-top: 2px;
    }
  </style>
</head>
<body>
  <canvas></canvas>
  <div class="hud">
    <div class="label">Earthquakes \u00B7 last 24h</div>
    <div class="count" id="count">0</div>
    <div class="src">earthquake.usgs.gov</div>
  </div>
  <script src="feed.ts"></script>
</body>
</html>`;

const DATA_PREVIEW = `<!DOCTYPE html><html><head><meta charset="utf-8">
<style>
*{margin:0;box-sizing:border-box}
body{background:#000810;overflow:hidden;font-family:system-ui,sans-serif}
canvas{display:block;width:100vw;height:100vh}
.hud{position:absolute;top:8px;left:8px;color:rgba(255,255,255,0.5);font-size:7px;font-family:'SF Mono',monospace;pointer-events:none}
.hud .ct{color:#ef4444;font-size:13px;font-weight:700;text-shadow:0 0 8px rgba(239,68,68,0.5)}
.hud .lb{color:rgba(255,255,255,0.3);text-transform:uppercase;letter-spacing:0.12em;font-size:5px}
.hud .sr{color:rgba(255,255,255,0.2);font-size:5px;margin-top:1px}
</style></head><body>
<canvas></canvas>
<div class="hud"><div class="lb">Earthquakes \u00B7 24h</div><div class="ct" id="ct">0</div><div class="sr">earthquake.usgs.gov</div></div>
<script>
var c=document.querySelector('canvas'),x=c.getContext('2d');
var dpr=window.devicePixelRatio||1;c.width=c.clientWidth*dpr;c.height=c.clientHeight*dpr;
var W=c.width,H=c.height;
var qs=[],flashes=[];
var coast=[[61,-150],[57,-135],[48,-123],[37,-122],[32,-117],[23,-110],[15,-92],[9,-79],[1,-77],[-5,-81],[-16,-75],[-33,-72],[-42,-73],[-54,-69],[-54,-64],[-38,-57],[-23,-43],[-8,-35],[5,-52],[10,-62],[11,-75],[19,-87],[21,-97],[26,-97],[30,-88],[29,-81],[25,-80],[27,-82],[30,-84],[30,-88],[37,-76],[40,-74],[42,-70],[43,-66],[45,-62],[47,-53],[52,-56],[60,-46],[65,-40],[70,-22],[63,-20],[64,-14],[58,-6],[51,2],[43,-9],[36,-6],[37,10],[38,13],[41,17],[41,29],[37,36],[31,33],[26,34],[13,43],[2,45],[-3,40],[-12,44],[-26,33],[-34,18],[-34,26],[-29,32],[-24,36],[-16,40],[-12,49],[2,42],[5,44],[14,49],[7,80],[23,70],[25,90],[22,97],[16,98],[7,103],[1,104],[-8,115],[-20,119],[-32,116],[-34,137],[-38,145],[-42,147],[-45,169],[-37,175],[-35,174],[-42,172],[-47,168],[64,40],[59,31],[55,29],[45,37],[42,42],[37,49],[39,53],[45,50],[50,42],[57,41],[60,30],[66,33],[68,49],[62,50],[57,60],[53,73],[46,52],[40,50],[30,48],[25,55],[23,58],[22,60],[10,80],[30,120],[35,129],[37,137],[40,140],[43,145],[45,142],[38,130],[32,121],[22,114],[22,108],[30,105],[40,107],[52,104],[55,95],[62,73],[67,70],[70,60],[68,45],[72,40],[75,70],[77,105],[72,130],[68,180],[71,-170],[65,-168]];
var tect=[[65,-18],[63,-20],[45,-27],[38,-10],[36,0],[36,10],[38,14],[34,26],[33,44],[25,58],[10,57],[5,32],[-10,22],[-35,18],[-55,0],[-60,30],[-65,70],[-50,140],[-40,170],[-35,180],[50,180],[55,160],[50,150],[40,144],[35,140],[30,130],[20,120],[15,100],[5,95],[0,98],[-10,110],[-25,115],[-35,135],[-42,147],[-50,165],[-60,170],[-65,-140],[-55,-70],[-46,-75],[-33,-72],[-20,-70],[-15,-76],[0,-80],[5,-82],[10,-86],[15,-95],[20,-105],[25,-110],[30,-115],[35,-120],[40,-125],[48,-128],[55,-135],[56,-152],[53,-165],[51,-177],[20,-155],[19,-156],[10,-110],[0,-105],[-5,-82],[-15,-75],[-20,-70],[40,-130],[45,-127],[50,-130],[35,140],[33,131],[30,120],[25,120],[20,100],[15,97],[10,95],[-5,105],[-10,113]];
var zones=[[35.6,139.7],[37.7,-122.4],[-33.4,-70.6],[36.2,28.0],[28.6,77.2],[-6.2,106.8],[38.7,-9.1],[4.6,-74.1],[13.7,100.5],[-37.8,144.9],[55.7,37.6],[39.9,116.4],[41.0,29.0],[-1.3,36.8],[61,-150],[51,-178],[19,-155],[-20,-175],[0,120],[-5,102],[36,71],[14,121],[10,-84],[38,-28],[46,7],[35,25],[42,44],[15,42],[-22,166],[18,-66]];
function proj(lat,lon){return{x:(lon+180)/360*W,y:(90-lat)/180*H}}
function drawCoast(){x.strokeStyle='rgba(100,180,255,0.07)';x.lineWidth=1;x.beginPath();
for(var i=0;i<coast.length;i++){var p=proj(coast[i][0],coast[i][1]);i===0?x.moveTo(p.x,p.y):x.lineTo(p.x,p.y)}x.stroke()}
function drawTect(){x.strokeStyle='rgba(239,68,68,0.04)';x.lineWidth=0.5;x.setLineDash([2,4]);x.beginPath();
for(var i=0;i<tect.length;i++){var p=proj(tect[i][0],tect[i][1]);i===0?x.moveTo(p.x,p.y):x.lineTo(p.x,p.y)}x.stroke();x.setLineDash([])}
function drawGrid(){x.strokeStyle='rgba(255,255,255,0.015)';x.lineWidth=0.5;
for(var i=0;i<=6;i++){var yy=i/6*H;x.beginPath();x.moveTo(0,yy);x.lineTo(W,yy);x.stroke()}
for(var i=0;i<=12;i++){var xx=i/12*W;x.beginPath();x.moveTo(xx,0);x.lineTo(xx,H);x.stroke()}}
for(var i=0;i<90;i++){var z=zones[Math.floor(Math.random()*zones.length)];
var lat=z[0]+(Math.random()-0.5)*25,lon=z[1]+(Math.random()-0.5)*25;
qs.push({lat:lat,lon:lon,mag:0.5+Math.random()*5.5,age:Math.random(),rip:Math.random(),spd:0.008+Math.random()*0.012})}
document.getElementById('ct').textContent=qs.length;
x.fillStyle='#000810';x.fillRect(0,0,W,H);drawGrid();drawCoast();drawTect();
var bg=x.getImageData(0,0,W,H);
function draw(){x.putImageData(bg,0,0);
x.globalCompositeOperation='lighter';
for(var i=0;i<flashes.length;i++){var f=flashes[i],p=proj(f.lat,f.lon);
f.t+=0.03;var fa=1-f.t;if(fa<=0){flashes.splice(i,1);i--;continue}
var fr=f.mag*8+f.t*40;
var fg=x.createRadialGradient(p.x,p.y,0,p.x,p.y,fr);
fg.addColorStop(0,'rgba(255,200,150,'+fa*0.7+')');fg.addColorStop(0.3,'rgba(239,68,68,'+fa*0.4+')');fg.addColorStop(1,'rgba(239,68,68,0)');
x.beginPath();x.arc(p.x,p.y,fr,0,Math.PI*2);x.fillStyle=fg;x.fill()}
for(var i=0;i<qs.length;i++){var q=qs[i],p=proj(q.lat,q.lon);
var r=1+q.mag*1.2;var a=0.25+q.age*0.75;
q.rip=(q.rip+q.spd)%1;
var rr=r+q.rip*14;
x.beginPath();x.arc(p.x,p.y,rr,0,Math.PI*2);
x.strokeStyle='rgba(239,68,68,'+(1-q.rip)*a*0.35+')';x.lineWidth=0.8;x.stroke();
var g=x.createRadialGradient(p.x,p.y,0,p.x,p.y,r*3.5);
g.addColorStop(0,'rgba(239,68,68,'+a*0.5+')');g.addColorStop(1,'rgba(239,68,68,0)');
x.beginPath();x.arc(p.x,p.y,r*3.5,0,Math.PI*2);x.fillStyle=g;x.fill();
x.beginPath();x.arc(p.x,p.y,r,0,Math.PI*2);
x.fillStyle='rgba(255,140,120,'+a+')';x.fill();
x.beginPath();x.arc(p.x,p.y,r*0.4,0,Math.PI*2);
x.fillStyle='rgba(255,255,240,'+a*0.7+')';x.fill()}
x.globalCompositeOperation='source-over';
if(Math.random()>0.97){var z=zones[Math.floor(Math.random()*zones.length)];
var nl=z[0]+(Math.random()-0.5)*18,no=z[1]+(Math.random()-0.5)*18,nm=1+Math.random()*4.5;
qs.push({lat:nl,lon:no,mag:nm,age:1,rip:0,spd:0.008+Math.random()*0.012});
flashes.push({lat:nl,lon:no,mag:nm,t:0});
if(qs.length>130)qs.shift();document.getElementById('ct').textContent=qs.length}
for(var i=0;i<qs.length;i++){qs[i].age=Math.max(0.05,qs[i].age-0.0001)}
requestAnimationFrame(draw)}draw();
<\/script></body></html>`;

// ─── AI VTuber ───────────────────────────────────────────────────────────────

const VTUBER_TERMINAL: TermLine[] = [
  { type: "user", text: "read dazzle.fm/llms.txt \u2014 I have a VRM model for my AI character Luna, set her up as a 24/7 VTuber on Twitch" },
  { type: "out", text: "" },
  { type: "agent", text: "I'll set up a Dazzle stage with Luna's VRM model, chat interaction, and TTS:" },
  { type: "out", text: "" },
  { type: "exec", text: "curl -sSL https://dazzle.fm/install.sh | sh" },
  { type: "out", text: "Dazzle CLI installed." },
  { type: "out", text: "" },
  { type: "exec", text: "dazzle login" },
  { type: "out", text: "\u2713 Logged in as you@example.com" },
  { type: "out", text: "" },
  { type: "user", text: "done, go ahead" },
  { type: "out", text: "" },
  { type: "cmd", text: "dazzle stage create luna-stream" },
  { type: "out", text: 'Stage "luna-stream" created.' },
  { type: "out", text: "" },
  { type: "agent", text: "Wrote overlay.html with @pixiv/three-vrm loader, chat widget, and ElevenLabs TTS hook. Luna's VRM drives lip sync from the audio stream." },
  { type: "out", text: "" },
  { type: "cmd", text: "npm run build" },
  { type: "out", text: "\u2713 Built in 0.8s" },
  { type: "out", text: "" },
  { type: "cmd", text: "dazzle stage up --stage luna-stream" },
  { type: "out", text: "\u2713 Stage activated \u2014 GPU rendering at 30 FPS." },
  { type: "out", text: "" },
  { type: "cmd", text: "dazzle stage sync ./dist --stage luna-stream" },
  { type: "out", text: "8 files synced (overlay.html, chat.ts, luna.vrm, ...)" },
  { type: "out", text: "" },
  { type: "agent", text: "Luna is live \u2014 she'll respond to chat in character with voice. dazzle.fm/s/luna-stream" },
  { type: "out", text: "" },
  { type: "user", text: "connect it to twitch" },
  { type: "out", text: "" },
  { type: "cmd", text: "dazzle destination add twitch" },
  { type: "out", text: '\u2713 Destination "twitch" added.' },
  { type: "out", text: "" },
  { type: "cmd", text: "dazzle destination attach twitch --stage luna-stream" },
  { type: "out", text: "\u2713 Streaming to twitch.tv/luna_ai" },
];

const VTUBER_OVERLAY = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    * { margin: 0; box-sizing: border-box }
    body {
      background: linear-gradient(160deg, #0d0221, #150535, #1a0a3e);
      height: 100vh; overflow: hidden;
      font-family: 'Segoe UI', system-ui, sans-serif;
    }
    .scene { position: relative; width: 100%; height: 100% }

    /* VRM model container — @pixiv/three-vrm renders here */
    #model-canvas {
      position: absolute; bottom: 0; left: 50%;
      transform: translateX(-50%);
      width: 480px; height: 600px;
    }

    /* Chat overlay */
    .chat {
      position: absolute; right: 16px; bottom: 16px;
      width: 300px; max-height: 55%;
      display: flex; flex-direction: column; gap: 6px;
      overflow: hidden;
    }
    .chat-msg {
      background: rgba(15, 5, 30, 0.75);
      border: 1px solid rgba(168, 130, 255, 0.2);
      border-radius: 10px; padding: 8px 12px;
      backdrop-filter: blur(8px);
      animation: slideIn 0.3s ease-out;
    }
    .chat-msg.luna {
      border-color: rgba(192, 132, 252, 0.5);
      background: rgba(88, 28, 180, 0.25);
    }
    .chat-user { color: #a78bfa; font-size: 11px; font-weight: 600 }
    .chat-msg.luna .chat-user { color: #e0b0ff }
    .chat-text { color: #e4e4e7; font-size: 13px; margin-top: 2px }

    /* Speech bubble */
    .speech-bubble {
      position: absolute; bottom: 520px; left: 50%;
      transform: translateX(-50%);
      background: rgba(88, 28, 180, 0.3);
      border: 1px solid rgba(192, 132, 252, 0.5);
      border-radius: 16px; padding: 10px 20px;
      color: #e8d5ff; font-size: 14px;
      opacity: 0; transition: opacity 0.4s;
      backdrop-filter: blur(8px);
      max-width: 320px; text-align: center;
    }

    @keyframes slideIn {
      from { opacity: 0; transform: translateY(10px) }
      to { opacity: 1; transform: translateY(0) }
    }
  </style>
</head>
<body>
  <div class="scene">
    <canvas id="model-canvas"></canvas>
    <div class="speech-bubble" id="speech"></div>
    <div class="chat" id="chat"></div>
  </div>
  <script src="chat.ts"></script>
</body>
</html>`;

const VTUBER_CHAT = `// chat.ts — event-driven character responses with TTS
import { speak as ttsSpeak } from './tts'     // ElevenLabs wrapper
import { setExpression } from './vrm-driver'  // VRM blend shape control

type Mood = 'happy' | 'surprised' | 'thinking' | 'neutral'

interface ChatEvent {
  user: string
  text: string
  isLuna?: boolean
  mood?: Mood
}

const chatEl = document.getElementById('chat')!
const speechEl = document.getElementById('speech')!

// --- Prompt-driven response (calls your LLM backend) ---
async function generateResponse(msg: string): Promise<{ text: string; mood: Mood }> {
  const res = await fetch('/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message: msg, character: 'luna' }),
  })
  return res.json()
}

// --- Render a chat message ---
function addMessage(ev: ChatEvent) {
  const div = document.createElement('div')
  div.className = 'chat-msg' + (ev.isLuna ? ' luna' : '')
  div.innerHTML = \`
    <div class="chat-user">\${ev.isLuna ? '\u2606 Luna' : ev.user}</div>
    <div class="chat-text">\${ev.text}</div>
  \`
  chatEl.appendChild(div)
  while (chatEl.children.length > 10) chatEl.removeChild(chatEl.firstChild!)
}

// --- Speech bubble + TTS + VRM expression ---
async function lunaSpeak(text: string, mood: Mood = 'happy') {
  speechEl.textContent = text
  speechEl.style.opacity = '1'
  setExpression(mood)                         // drive VRM blend shapes
  await ttsSpeak(text)                        // ElevenLabs streams audio
  setTimeout(() => { speechEl.style.opacity = '0' }, 2000)
  setExpression('neutral')
}

// --- Listen for incoming chat via Dazzle events ---
window.addEventListener('dazzle:event', async (e: CustomEvent) => {
  const { user, text } = e.detail
  addMessage({ user, text })

  // Generate in-character response
  const { text: reply, mood } = await generateResponse(text)
  addMessage({ user: 'Luna', text: reply, isLuna: true, mood })
  await lunaSpeak(reply, mood)
})`;

const VTUBER_PREVIEW = `<!DOCTYPE html><html><head><meta charset="utf-8">
<style>
*{margin:0;box-sizing:border-box}
html,body{width:100%;height:100%;overflow:hidden}
body{background:linear-gradient(160deg,#0d0221 0%,#150535 40%,#1e0a4a 70%,#12032e 100%);font-family:system-ui,sans-serif}
canvas{position:absolute;top:0;left:0;width:100%;height:100%;pointer-events:none}
.char{position:absolute;bottom:0;left:50%;transform:translateX(-50%);width:130px}
.ci{position:relative;display:flex;flex-direction:column;align-items:center;animation:breathe 3s ease-in-out infinite}
.head{width:64px;height:64px;border-radius:50%;background:linear-gradient(145deg,#f5e6ff,#e0c4ff);position:relative;z-index:2;box-shadow:0 0 20px rgba(192,132,252,0.3)}
.hb{position:absolute;top:-4px;left:-16px;right:-16px;height:50px;background:linear-gradient(180deg,#b88aff,#8b5cf6);border-radius:50% 50% 40% 40%;z-index:1}
.hf{position:absolute;top:-2px;left:-6px;right:-6px;height:28px;background:linear-gradient(180deg,#c4a0ff,#9b6dff);border-radius:50% 50% 30% 30%;z-index:3}
.hs{position:absolute;z-index:4}
.hs.l{top:16px;left:-14px;width:14px;height:50px;background:linear-gradient(180deg,#b88aff,#8b5cf680);border-radius:0 0 40% 50%;transform:rotate(5deg)}
.hs.r{top:16px;right:-14px;width:14px;height:50px;background:linear-gradient(180deg,#b88aff,#8b5cf680);border-radius:0 0 50% 40%;transform:rotate(-5deg)}
.eye{position:absolute;width:10px;height:13px;background:#2d1654;border-radius:50%;top:26px;z-index:4}
.eye.l{left:16px}.eye.r{right:16px}
.eye::after{content:'';position:absolute;width:4px;height:4px;background:#fff;border-radius:50%;top:2px;left:2px}
.blush{position:absolute;width:12px;height:7px;background:rgba(255,150,180,0.35);border-radius:50%;top:34px;z-index:4}
.blush.l{left:10px}.blush.r{right:10px}
.mouth{position:absolute;bottom:12px;left:50%;transform:translateX(-50%);width:8px;height:5px;border-radius:0 0 8px 8px;background:#b07acd;z-index:4;transition:all 0.2s}
.neck{width:16px;height:8px;background:linear-gradient(180deg,#f5e6ff,#e8d0ff);margin:0 auto;z-index:1}
.torso{width:56px;height:70px;background:linear-gradient(180deg,#7c3aed,#6d28d9);border-radius:22px 22px 0 0;position:relative;z-index:1}
.collar{position:absolute;top:0;left:50%;transform:translateX(-50%);width:36px;height:10px;background:linear-gradient(180deg,#fff8,#fff0);border-radius:0 0 50% 50%}
.ribbon{position:absolute;top:8px;left:50%;transform:translateX(-50%);width:8px;height:8px;background:#f472b6;border-radius:50%;box-shadow:0 0 6px rgba(244,114,182,0.5)}
.arm{position:absolute;top:10px;width:16px;height:40px;background:linear-gradient(180deg,#7c3aed,#6d28d9);border-radius:10px;z-index:0}
.arm.l{left:-10px;transform:rotate(8deg)}.arm.r{right:-10px;transform:rotate(-8deg)}
.glow{position:absolute;bottom:20px;left:50%;transform:translateX(-50%);width:180px;height:80px;background:radial-gradient(ellipse,rgba(139,92,246,0.2),transparent);pointer-events:none}
.chat{position:absolute;right:6px;bottom:6px;width:46%;display:flex;flex-direction:column;gap:3px;overflow:hidden}
.msg{background:rgba(15,5,30,0.7);border:1px solid rgba(168,130,255,0.2);border-radius:7px;padding:4px 7px;animation:si 0.4s ease-out;backdrop-filter:blur(4px)}
.msg.luna{border-color:rgba(192,132,252,0.4);background:rgba(88,28,180,0.25)}
.mu{font-size:7px;font-weight:600;color:#a78bfa}.msg.luna .mu{color:#e0b0ff}
.mt{color:#e4e4e7;font-size:8px;margin-top:1px;line-height:1.3}
.speech{position:absolute;top:22%;left:50%;transform:translateX(-50%);background:rgba(88,28,180,0.3);border:1px solid rgba(192,132,252,0.4);border-radius:10px;padding:4px 12px;color:#e8d5ff;font-size:8px;opacity:0;transition:opacity 0.4s;white-space:nowrap;backdrop-filter:blur(6px)}
@keyframes si{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:translateY(0)}}
@keyframes breathe{0%,100%{transform:translateY(0)}50%{transform:translateY(-3px)}}
</style>
</head><body>
<canvas id="bg"></canvas>
<div class="glow"></div>
<div class="char"><div class="ci">
<div style="position:relative">
<div class="hb"></div>
<div class="head">
<div class="hf"></div>
<div class="hs l"></div><div class="hs r"></div>
<div class="eye l"></div><div class="eye r"></div>
<div class="blush l"></div><div class="blush r"></div>
<div class="mouth" id="mo"></div>
</div>
</div>
<div class="neck"></div>
<div class="torso"><div class="collar"></div><div class="ribbon"></div><div class="arm l"></div><div class="arm r"></div></div>
</div></div>
<div class="speech" id="sp"></div>
<div class="chat" id="ch"></div>
<script>
var c=document.getElementById('bg'),ctx=c.getContext('2d');
function resize(){c.width=window.innerWidth;c.height=window.innerHeight}resize();
var pts=[];for(var i=0;i<50;i++)pts.push({x:Math.random(),y:Math.random()*0.7,s:0.5+Math.random()*1.5,spd:0.3+Math.random()*0.7,ph:Math.random()*Math.PI*2});
function drawBg(t){ctx.clearRect(0,0,c.width,c.height);
for(var i=0;i<pts.length;i++){var p=pts[i];var a=0.25+0.6*Math.abs(Math.sin(t*0.001*p.spd+p.ph));
ctx.fillStyle='rgba(200,180,255,'+a+')';ctx.beginPath();ctx.arc(p.x*c.width,p.y*c.height,p.s,0,Math.PI*2);ctx.fill();
if(p.s>1.2){ctx.strokeStyle='rgba(200,180,255,'+(a*0.3)+')';ctx.lineWidth=0.5;
ctx.beginPath();ctx.moveTo(p.x*c.width-3,p.y*c.height);ctx.lineTo(p.x*c.width+3,p.y*c.height);ctx.stroke();
ctx.beginPath();ctx.moveTo(p.x*c.width,p.y*c.height-3);ctx.lineTo(p.x*c.width,p.y*c.height+3);ctx.stroke()}}
requestAnimationFrame(drawBg)}drawBg(0);

var users=['astral_fox','pixel_witch','neon_drift','synth99','mochi_bear'];
var msgs=['hi luna!','love the stream!','so cute!!','best vtuber!','sing for us~','welcome back!','luna luna luna!'];
var resps=['Thank you~!','You are so kind!','Aww hi hi!','Ehehe~','Welcome in!'];
var ch=document.getElementById('ch'),sp=document.getElementById('sp'),mo=document.getElementById('mo');
function addMsg(u,t,luna){var d=document.createElement('div');d.className='msg'+(luna?' luna':'');
d.innerHTML='<div class="mu">'+(luna?'\u2606 Luna':u)+'</div><div class="mt">'+t+'</div>';
ch.appendChild(d);while(ch.children.length>6)ch.removeChild(ch.firstChild)}
function speak(t){sp.textContent=t;sp.style.opacity='1';
mo.style.height='8px';mo.style.width='10px';mo.style.borderRadius='50%';
setTimeout(function(){sp.style.opacity='0';mo.style.height='5px';mo.style.width='8px';mo.style.borderRadius='0 0 8px 8px'},3500)}
function tick(){var u=users[Math.floor(Math.random()*users.length)];
var m=msgs[Math.floor(Math.random()*msgs.length)];addMsg(u,m,false);
if(Math.random()>0.35){var r=resps[Math.floor(Math.random()*resps.length)];
setTimeout(function(){addMsg('Luna',r,true);speak(r)},1200+Math.random()*1500)}}
tick();setInterval(tick,3500+Math.random()*2500);
<\/script></body></html>`;

// ─── Digital Signage ─────────────────────────────────────────────────────────

const SIGNAGE_TERMINAL: TermLine[] = [
  { type: "user", text: "read dazzle.fm/llms.txt \u2014 I need to get our quarterly metrics up on the lobby TV before the board arrives Monday" },
  { type: "out", text: "" },
  { type: "agent", text: "I'll set up a Dazzle stage for your lobby display:" },
  { type: "out", text: "" },
  { type: "exec", text: "curl -sSL https://dazzle.fm/install.sh | sh" },
  { type: "out", text: "Dazzle CLI installed." },
  { type: "out", text: "" },
  { type: "exec", text: "dazzle login" },
  { type: "out", text: "\u2713 Logged in as ops@acmecorp.com" },
  { type: "out", text: "" },
  { type: "user", text: "good, go ahead" },
  { type: "out", text: "" },
  { type: "cmd", text: "dazzle stage create lobby-display" },
  { type: "out", text: 'Stage "lobby-display" created.' },
  { type: "out", text: "" },
  { type: "agent", text: "Building your dashboard \u2014 4 KPI cards, weekly chart, live clock." },
  { type: "out", text: "" },
  { type: "cmd", text: "dazzle stage up --stage lobby-display" },
  { type: "out", text: "\u2713 Stage activated \u2014 rendering at 30 FPS." },
  { type: "out", text: "" },
  { type: "cmd", text: "dazzle stage sync ./dashboard --stage lobby-display" },
  { type: "out", text: "3 files synced." },
  { type: "out", text: "" },
  { type: "agent", text: "Your display is live. Here's how to get it on the TV:" },
  { type: "out", text: "" },
  { type: "agent", text: "Open dazzle.fm/watch/lobby-display \u2014 in the TV's browser, cast from your phone, or plug in a Fire Stick. No app to install, no login, no ads. Runs 24/7." },
];

const SIGNAGE_DISPLAY = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    * { margin: 0; box-sizing: border-box }
    body {
      background: #0a0a0f;
      font-family: 'Inter', system-ui, -apple-system, sans-serif;
      height: 100vh;
      padding: 32px;
      display: grid;
      grid-template-columns: repeat(4, 1fr);
      grid-template-rows: auto 1fr auto;
      gap: 20px;
      color: #fff;
    }
    .header {
      grid-column: 1 / -1;
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding-bottom: 8px;
      border-bottom: 1px solid #1e1e2a;
    }
    .brand { display: flex; align-items: center; gap: 12px }
    .title { font-size: 20px; font-weight: 600; letter-spacing: -0.01em }
    .badge {
      font-size: 10px; background: #10b981; color: #000;
      padding: 2px 8px; border-radius: 9999px; font-weight: 600;
      text-transform: uppercase; letter-spacing: 0.05em;
    }
    .clock { color: #71717a; font-family: 'SF Mono', monospace; font-size: 16px }
    .kpi {
      background: linear-gradient(145deg, #12121a, #16161f);
      border: 1px solid #1e1e2a;
      border-radius: 12px;
      padding: 20px;
      display: flex;
      flex-direction: column;
    }
    .kpi-label {
      color: #6b7280; font-size: 11px; font-weight: 500;
      text-transform: uppercase; letter-spacing: 0.06em;
    }
    .kpi-value {
      font-size: 32px; font-weight: 700;
      font-family: 'SF Mono', monospace;
      margin-top: 8px; letter-spacing: -0.02em;
    }
    .kpi-delta {
      font-size: 12px; margin-top: auto;
      padding-top: 12px; font-weight: 500;
    }
    .up { color: #34d399 }
    .down { color: #f87171 }
    .chart-section {
      grid-column: 1 / -1;
      background: linear-gradient(145deg, #12121a, #16161f);
      border: 1px solid #1e1e2a;
      border-radius: 12px;
      padding: 20px;
    }
    .chart-header {
      display: flex; justify-content: space-between;
      align-items: center; margin-bottom: 16px;
    }
    .chart-title {
      color: #6b7280; font-size: 11px; font-weight: 500;
      text-transform: uppercase; letter-spacing: 0.06em;
    }
    .chart-total { color: #fff; font-size: 14px; font-weight: 600 }
  </style>
</head>
<body>
  <div class="header">
    <div class="brand">
      <span class="title">Acme Corp</span>
      <span class="badge">Live</span>
    </div>
    <span class="clock" id="clock"></span>
  </div>
  <div id="kpis"></div>
  <div class="chart-section" id="chart"></div>
  <script src="metrics.ts"></script>
</body>
</html>`;

const SIGNAGE_METRICS = `// metrics.ts — KPI dashboard with live updates

interface KPI {
  label: string
  value: number
  prefix: string
  suffix: string
  format: 'currency' | 'number' | 'percent' | 'duration'
  delta: number
}

const kpis: KPI[] = [
  { label: 'Revenue',       value: 284900, prefix: '$', suffix: '',   format: 'currency', delta: 12.4 },
  { label: 'Active Users',  value: 14820,  prefix: '',  suffix: '',   format: 'number',   delta: 8.2  },
  { label: 'Conversion',    value: 3.42,   prefix: '',  suffix: '%',  format: 'percent',  delta: -0.3 },
  { label: 'Response Time', value: 142,    prefix: '',  suffix: 'ms', format: 'duration', delta: -5.1 },
]

function formatKPI(kpi: KPI): string {
  switch (kpi.format) {
    case 'currency':
      return kpi.prefix + (kpi.value >= 1000
        ? (kpi.value / 1000).toFixed(1) + 'K'
        : kpi.value.toFixed(0))
    case 'number':
      return Math.floor(kpi.value).toLocaleString()
    case 'percent':
      return kpi.value.toFixed(2) + kpi.suffix
    case 'duration':
      return kpi.value.toFixed(0) + kpi.suffix
  }
}

// Render KPI cards
const container = document.getElementById('kpis')!
container.style.display = 'contents'

kpis.forEach(kpi => {
  const card = document.createElement('div')
  card.className = 'kpi'
  const positive = kpi.format === 'duration' ? kpi.delta < 0 : kpi.delta >= 0
  card.innerHTML = \`
    <div class="kpi-label">\${kpi.label}</div>
    <div class="kpi-value">\${formatKPI(kpi)}</div>
    <div class="kpi-delta \${positive ? 'up' : 'down'}">
      \${positive ? '\u2191' : '\u2193'} \${Math.abs(kpi.delta).toFixed(1)}%
    </div>\`
  container.appendChild(card)
})

// Live clock
const clockEl = document.getElementById('clock')!
function tick() {
  clockEl.textContent = new Date().toLocaleTimeString('en-US', {
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false
  })
}
tick()
setInterval(tick, 1000)

// Simulate live metric updates every 3s
setInterval(() => {
  kpis.forEach((kpi, i) => {
    kpi.value += kpi.value * (Math.random() - 0.48) * 0.005
    const el = container.children[i]?.querySelector('.kpi-value')
    if (el) el.textContent = formatKPI(kpi)
  })
}, 3000)`;

const SIGNAGE_PREVIEW = `<!DOCTYPE html><html><head><meta charset="utf-8">
<style>
*{margin:0;box-sizing:border-box}
body{background:#0a0a0f;font-family:system-ui,-apple-system,sans-serif;height:100vh;padding:10px;display:flex;flex-direction:column;gap:6px;overflow:hidden;color:#fff}
.hdr{display:flex;justify-content:space-between;align-items:center;padding-bottom:5px;border-bottom:1px solid #1e1e2a}
.brand{display:flex;align-items:center;gap:6px}
.ttl{font-size:10px;font-weight:600;letter-spacing:-0.01em}
.badge{font-size:5px;background:#10b981;color:#000;padding:1px 4px;border-radius:9999px;font-weight:700;text-transform:uppercase;letter-spacing:0.05em}
.clk{color:#52525b;font-family:ui-monospace,monospace;font-size:8px}
.grid{display:grid;grid-template-columns:repeat(4,1fr);gap:5px;flex:1}
.kpi{background:linear-gradient(145deg,#12121a,#16161f);border:1px solid #1e1e2a;border-radius:7px;padding:7px;display:flex;flex-direction:column}
.kl{color:#6b7280;font-size:5.5px;font-weight:500;text-transform:uppercase;letter-spacing:0.06em}
.kv{font-size:15px;font-weight:700;font-family:ui-monospace,monospace;margin-top:2px;letter-spacing:-0.02em}
.kd{font-size:6px;font-weight:500;margin-top:auto;padding-top:3px}
.up{color:#34d399}.dn{color:#f87171}
.csec{background:linear-gradient(145deg,#12121a,#16161f);border:1px solid #1e1e2a;border-radius:7px;padding:7px 7px 5px}
.chdr{display:flex;justify-content:space-between;align-items:center;margin-bottom:5px}
.cttl{color:#6b7280;font-size:5.5px;font-weight:500;text-transform:uppercase;letter-spacing:0.06em}
.ctot{font-size:8px;font-weight:600}
.bars{display:grid;grid-template-columns:repeat(7,1fr);gap:3px;align-items:end;height:36px}
.bwrap{display:flex;flex-direction:column;align-items:center;height:100%}
.bar{width:100%;border-radius:2px 2px 0 0;min-height:3px;margin-top:auto;transition:height 0.6s ease}
.bl{color:#52525b;font-size:5px;text-align:center;margin-top:2px;font-weight:500}
</style></head><body>
<div class="hdr"><div class="brand"><span class="ttl">Acme Corp</span><span class="badge">Live</span></div><span class="clk" id="c"></span></div>
<div class="grid" id="g"></div>
<div class="csec"><div class="chdr"><span class="cttl">Weekly Revenue</span><span class="ctot" id="wtot"></span></div><div class="bars" id="b"></div></div>
<script>
var K=[{l:'Revenue',v:284900,p:'$',f:'c',d:12.4},{l:'Active Users',v:14820,p:'',f:'n',d:8.2},{l:'Conversion',v:3.42,p:'',f:'p',d:-0.3},{l:'Response Time',v:142,p:'',f:'m',d:-5.1}];
function fmt(k){if(k.f==='c')return k.p+(k.v/1000).toFixed(1)+'K';if(k.f==='n')return k.p+Math.floor(k.v).toLocaleString();if(k.f==='p')return k.v.toFixed(2)+'%';return k.v.toFixed(0)+'ms'}
var g=document.getElementById('g');
function renderK(){g.innerHTML='';K.forEach(function(k){var d=document.createElement('div');d.className='kpi';
var pos=k.f==='m'?k.d<0:k.d>=0;
d.innerHTML='<div class="kl">'+k.l+'</div><div class="kv">'+fmt(k)+'</div><div class="kd '+(pos?'up':'dn')+'">'+(pos?'\u2191':'\u2193')+' '+Math.abs(k.d).toFixed(1)+'%</div>';g.appendChild(d)})}
renderK();
var days=['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];
var bv=[38,45,52,41,58,34,27];
var b=document.getElementById('b'),wtot=document.getElementById('wtot');
function renderB(){b.innerHTML='';var mx=Math.max.apply(null,bv);var tot=0;bv.forEach(function(v){tot+=v});
wtot.textContent='$'+Math.round(tot)+'K';
bv.forEach(function(v,i){var w=document.createElement('div');w.className='bwrap';
var bar=document.createElement('div');bar.className='bar';bar.style.height=Math.max(8,(v/mx*100))+'%';
var pct=v/mx;bar.style.background='linear-gradient(180deg,rgba(16,185,129,'+(0.6+pct*0.4).toFixed(2)+'),rgba(5,150,105,'+(0.4+pct*0.3).toFixed(2)+'))';
var lbl=document.createElement('div');lbl.className='bl';lbl.textContent=days[i];
w.appendChild(bar);w.appendChild(lbl);b.appendChild(w)})}
renderB();
var c=document.getElementById('c');
function uc(){c.textContent=new Date().toLocaleTimeString('en-US',{hour12:false,hour:'2-digit',minute:'2-digit',second:'2-digit'})}uc();setInterval(uc,1000);
setInterval(function(){K.forEach(function(k){k.v+=k.v*(Math.random()-0.48)*0.005});renderK();bv=bv.map(function(v){return Math.max(15,v+(Math.random()-0.5)*5)});renderB()},3000);
<\/script></body></html>`;

// ─── Persona Registry ────────────────────────────────────────────────────────

export const PERSONAS: Record<string, PersonaConfig> = {
  agents: {
    id: "agents",
    headline: null, // Set via JSX in LandingPage since it uses <LiveText>
    subtitle: "A cloud stage for your agent \u2014 live on Twitch, YouTube, or a shareable link.",
    ctaText: "Try it free",
    ctaFinalText: "Create your first stage",
    stepCreateDesc: "Your agent gets its own browser in the cloud \u2014 with full graphics, audio, and a 30 FPS stream.",
    terminalLines: AGENTS_TERMINAL,
    codeFiles: [
      { name: "App.tsx", code: AGENTS_APP, language: "typescript" },
      { name: "hooks.ts", code: AGENTS_SHADER, language: "typescript" },
    ],
    previewHtml: AGENTS_PREVIEW,
    demoTitleBar: "launch-tracker \u2014 dazzle.fm",
    statusBarLanguage: "TypeScript",
    frameworksLabel: "Works with any agent. If it can write code and run a shell, it can go live.",
    frameworks: ["Claude Code", "OpenAI Agents SDK", "CrewAI", "LangGraph", "AutoGen", "OpenClaw"],
  },

  creative: {
    id: "creative",
    headline: null,
    subtitle: "Stream shaders, p5.js sketches, and generative visuals 24/7 \u2014 no PC left on.",
    ctaText: "Start creating",
    ctaFinalText: "Launch your first stream",
    stepCreateDesc: "Your artwork gets its own GPU-powered browser in the cloud \u2014 running 24/7 at 30 FPS without your machine.",
    terminalLines: CREATIVE_TERMINAL,
    codeFiles: [
      { name: "sketch.js", code: CREATIVE_SKETCH, language: "javascript" },
      { name: "index.html", code: CREATIVE_HTML, language: "xml" },
    ],
    previewHtml: CREATIVE_PREVIEW,
    demoTitleBar: "particles \u2014 dazzle.fm",
    statusBarLanguage: "JavaScript",
    frameworksLabel: "Works with any web tech. If it runs in a browser, it can stream.",
    frameworks: ["p5.js", "three.js", "GLSL Shaders", "Canvas API", "Hydra", "D3.js"],
  },

  data: {
    id: "data",
    headline: null,
    subtitle: "Connect any API, render it beautifully, and stream it 24/7 \u2014 earthquakes, social feeds, space weather, live metrics.",
    ctaText: "Start streaming data",
    ctaFinalText: "Launch your first feed",
    stepCreateDesc: "Your visualization gets its own always-on browser in the cloud \u2014 real-time data, rendered and streamed 24/7.",
    terminalLines: DATA_TERMINAL,
    codeFiles: [
      { name: "feed.ts", code: DATA_FEED, language: "typescript" },
      { name: "index.html", code: DATA_INDEX, language: "xml" },
    ],
    previewHtml: DATA_PREVIEW,
    demoTitleBar: "earth-pulse \u2014 dazzle.fm",
    statusBarLanguage: "TypeScript",
    frameworksLabel: "Connect any data source. If it has an API, it can be a live stream.",
    frameworks: ["WebSocket", "D3.js", "three.js", "Canvas API", "SSE", "REST APIs"],
  },

  vtuber: {
    id: "vtuber",
    headline: null,
    subtitle: "An always-on stream for your AI persona \u2014 with voice, visuals, and chat interaction.",
    ctaText: "Launch your character",
    ctaFinalText: "Create your character's stage",
    stepCreateDesc: "Your character gets a GPU-powered stage \u2014 always on, always streaming, always in character.",
    terminalLines: VTUBER_TERMINAL,
    codeFiles: [
      { name: "overlay.html", code: VTUBER_OVERLAY, language: "xml" },
      { name: "chat.ts", code: VTUBER_CHAT, language: "typescript" },
    ],
    previewHtml: VTUBER_PREVIEW,
    demoTitleBar: "luna-stream \u2014 dazzle.fm",
    statusBarLanguage: "HTML",
    frameworksLabel: "Bring any AI backend. If it can drive a browser, it can go live.",
    frameworks: ["Live2D", "VRM / three.js", "ElevenLabs", "OpenAI", "Anthropic", "Rive"],
  },

  signage: {
    id: "signage",
    headline: null,
    subtitle: "Put dashboards, menus, and status boards on any screen \u2014 just a URL, no ads, no app to install.",
    ctaText: "Set up your display",
    ctaFinalText: "Launch your first display",
    stepCreateDesc: "Your content runs in a cloud browser \u2014 open the URL on any TV, cast from your phone, or use a $30 streaming stick.",
    terminalLines: SIGNAGE_TERMINAL,
    codeFiles: [
      { name: "display.html", code: SIGNAGE_DISPLAY, language: "xml" },
      { name: "metrics.ts", code: SIGNAGE_METRICS, language: "typescript" },
    ],
    previewHtml: SIGNAGE_PREVIEW,
    demoTitleBar: "lobby-display \u2014 dazzle.fm",
    statusBarLanguage: "HTML",
    frameworksLabel: "Built with any web tech. If it runs in a browser, it can be on any screen.",
    frameworks: ["React", "Grafana", "Metabase", "Google Sheets", "Notion", "Retool"],
  },
};

export const DEFAULT_PERSONA = "agents";
export const PERSONA_IDS = Object.keys(PERSONAS);
