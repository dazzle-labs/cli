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
  { type: "user", text: "read dazzle.fm/llms.txt \u2014 build a lofi radio visualizer and stream it" },
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
  { type: "cmd", text: "dazzle stage create lofi-radio" },
  { type: "out", text: 'Stage "lofi-radio" created.' },
  { type: "out", text: "" },
  { type: "agent", text: "Wrote scene.glsl \u2014 night sky, skyline, audio-reactive bars" },
  { type: "out", text: "" },
  { type: "cmd", text: "npm run build" },
  { type: "out", text: "\u2713 Built in 0.4s" },
  { type: "out", text: "" },
  { type: "cmd", text: "dazzle stage up --stage lofi-radio" },
  { type: "out", text: "\u2713 Stage activated \u2014 GPU rendering at 30 FPS." },
  { type: "out", text: "" },
  { type: "cmd", text: "dazzle stage sync ./dist --stage lofi-radio" },
  { type: "out", text: "3 files synced." },
  { type: "out", text: "" },
  { type: "agent", text: "Your lofi stream is live at dazzle.fm/s/lofi-radio" },
  { type: "out", text: "" },
  { type: "user", text: "now stream it to twitch" },
  { type: "out", text: "" },
  { type: "cmd", text: "dazzle destination add twitch" },
  { type: "out", text: '\u2713 Destination "twitch" added.' },
  { type: "out", text: "" },
  { type: "cmd", text: "dazzle destination attach twitch --stage lofi-radio" },
  { type: "out", text: "\u2713 Streaming to twitch.tv" },
];

const AGENTS_GLSL = `precision highp float;
uniform float u_time;
uniform vec2  u_resolution;

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5);
}

float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(hash(i), hash(i + vec2(1, 0)), f.x),
    mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x),
    f.y
  );
}

float fbm(vec2 p) {
  float v = 0.0, a = 0.5;
  for (int i = 0; i < 5; i++) {
    v += a * noise(p);
    p *= 2.0; a *= 0.5;
  }
  return v;
}

void main() {
  vec2 uv = gl_FragCoord.xy / u_resolution;
  float t = u_time * 0.15;

  // domain warping \u2014 two passes of fbm
  float n1 = fbm(uv * 3.0 + t);
  float n2 = fbm(uv * 3.0 + n1 + t * 0.7);

  vec3 a = vec3(0.05, 0.8,  0.6);  // teal
  vec3 b = vec3(0.1,  0.35, 0.95); // blue
  vec3 c = vec3(0.7,  0.2,  0.9);  // violet

  vec3 col = mix(a, b, n1);
  col = mix(col, c, n2 * 0.5);
  col *= 0.8 + 0.2 * fbm(uv * 4.0 - t);

  gl_FragColor = vec4(col, 1.0);
}`;

const AGENTS_MAIN = `import shader from './scene.glsl?raw'

const canvas = document.querySelector('canvas')!
const gl = canvas.getContext('webgl')!

// audio input \u2192 FFT for reactive bars
const audio = new AudioContext()
const mic = await navigator.mediaDevices
  .getUserMedia({ audio: true })
const src = audio.createMediaStreamSource(mic)
const analyser = audio.createAnalyser()
analyser.fftSize = 32
src.connect(analyser)
const fft = new Uint8Array(16)

// fullscreen canvas
function resize() {
  canvas.width  = innerWidth
  canvas.height = innerHeight
  gl.viewport(0, 0, canvas.width, canvas.height)
}
addEventListener('resize', resize)
resize()

// compile shader
function mk(type: number, src: string) {
  const s = gl.createShader(type)!
  gl.shaderSource(s, src)
  gl.compileShader(s)
  return s
}
const pgm = gl.createProgram()!
gl.attachShader(pgm, mk(gl.VERTEX_SHADER,
  'attribute vec2 a;void main(){gl_Position=vec4(a,0,1);}'))
gl.attachShader(pgm, mk(gl.FRAGMENT_SHADER, shader))
gl.linkProgram(pgm)
gl.useProgram(pgm)

// fullscreen quad
const buf = gl.createBuffer()
gl.bindBuffer(gl.ARRAY_BUFFER, buf)
gl.bufferData(gl.ARRAY_BUFFER,
  new Float32Array([-1,-1, 1,-1, -1,1, 1,1]),
  gl.STATIC_DRAW)
const a = gl.getAttribLocation(pgm, 'a')
gl.enableVertexAttribArray(a)
gl.vertexAttribPointer(a, 2, gl.FLOAT, false, 0, 0)

const uTime = gl.getUniformLocation(pgm, 'u_time')
const uRes  = gl.getUniformLocation(pgm, 'u_resolution')

function frame(t: number) {
  analyser.getByteFrequencyData(fft)
  gl.uniform1f(uTime, t / 1000)
  gl.uniform2f(uRes, canvas.width, canvas.height)
  gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)
  requestAnimationFrame(frame)
}
requestAnimationFrame(frame)`;

const AGENTS_PREVIEW = `<!DOCTYPE html><html><head><meta charset="utf-8">
<style>*{margin:0}body{overflow:hidden}canvas{display:block;width:100vw;height:100vh}</style>
</head><body><canvas></canvas><script>
var c=document.querySelector('canvas'),g=c.getContext('webgl');
c.width=c.clientWidth;c.height=c.clientHeight;g.viewport(0,0,c.width,c.height);
function mk(t,s){var sh=g.createShader(t);g.shaderSource(sh,s);g.compileShader(sh);return sh}
var v=mk(g.VERTEX_SHADER,'attribute vec2 a;void main(){gl_Position=vec4(a,0,1);}');
var f=mk(g.FRAGMENT_SHADER,[
'precision highp float;',
'uniform float u_time;uniform vec2 u_res;',
'float H(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5);}',
'float stars(vec2 uv,float t){vec2 id=floor(uv*60.0);float r=H(id);',
'return step(0.97,r)*(0.6+0.4*sin(t*(0.4+r*0.8)));}',
'float skyline(vec2 uv){float x=uv.x*24.0;',
'float h=0.12+0.1*H(vec2(floor(x),0.0));',
'h+=0.08*smoothstep(5.0,0.0,abs(x-12.0));return step(uv.y,h);}',
'float bars(vec2 uv,float t){float i=floor(uv.x*16.0);',
'if(i<0.0||i>15.0)return 0.0;',
'float amp=0.25*(1.0-i/20.0);amp*=0.6+0.4*sin(t*(0.5+i*0.15));',
'float e=fract(uv.x*16.0);',
'float bar=smoothstep(0.0,0.06,e)*smoothstep(0.0,0.06,1.0-e);',
'return bar*step(uv.y,amp*0.25+0.02);}',
'void main(){vec2 uv=gl_FragCoord.xy/u_res;float t=u_time;',
'vec3 sky=mix(vec3(0.08,0.04,0.18),vec3(0.01,0.01,0.06),uv.y);',
'sky+=vec3(0.35,0.12,0.25)*0.4*exp(-10.0*pow(uv.y-0.12,2.0));',
'sky+=vec3(0.8,0.85,1.0)*stars(uv,t);',
'vec2 wId=floor(uv*vec2(96.0,48.0));',
'float lit=step(0.7,H(wId))*step(0.5,H(wId+sin(t*0.1)));',
'vec3 cc=mix(vec3(0.01),vec3(1.0,0.85,0.4)*0.5,lit);',
'sky=mix(sky,cc,skyline(uv));',
'vec3 bc=mix(vec3(0.6,0.2,0.9),vec3(0.2,0.7,1.0),uv.x);',
'sky=mix(sky,bc,bars(uv,t)*0.8);',
'gl_FragColor=vec4(sky,1.0);}'
].join('\\n'));
var p=g.createProgram();g.attachShader(p,v);g.attachShader(p,f);g.linkProgram(p);g.useProgram(p);
var b=g.createBuffer();g.bindBuffer(g.ARRAY_BUFFER,b);
g.bufferData(g.ARRAY_BUFFER,new Float32Array([-1,-1,1,-1,-1,1,1,1]),g.STATIC_DRAW);
var a=g.getAttribLocation(p,'a');g.enableVertexAttribArray(a);g.vertexAttribPointer(a,2,g.FLOAT,false,0,0);
var uT=g.getUniformLocation(p,'u_time'),uR=g.getUniformLocation(p,'u_res');
function draw(t){g.uniform1f(uT,t/1000);g.uniform2f(uR,c.width,c.height);
g.drawArrays(g.TRIANGLE_STRIP,0,4);requestAnimationFrame(draw);}
requestAnimationFrame(draw);
<\/script></body></html>`;

// ─── Creative Coder ──────────────────────────────────────────────────────────

const CREATIVE_TERMINAL: TermLine[] = [
  { type: "user", text: "read dazzle.fm/llms.txt \u2014 build a flowing particle system and stream it 24/7" },
  { type: "out", text: "" },
  { type: "agent", text: "I'll set up a Dazzle stage for your generative artwork:" },
  { type: "out", text: "" },
  { type: "exec", text: "curl -sSL https://dazzle.fm/install.sh | sh" },
  { type: "out", text: "Dazzle CLI installed." },
  { type: "out", text: "" },
  { type: "exec", text: "dazzle login" },
  { type: "out", text: "\u2713 Logged in as you@example.com" },
  { type: "out", text: "" },
  { type: "user", text: "done, go ahead" },
  { type: "out", text: "" },
  { type: "cmd", text: "dazzle stage create particles" },
  { type: "out", text: 'Stage "particles" created.' },
  { type: "out", text: "" },
  { type: "agent", text: "Wrote index.html + sketch.js \u2014 2000 particles with flow field and color trails" },
  { type: "out", text: "" },
  { type: "cmd", text: "dazzle stage up --stage particles" },
  { type: "out", text: "\u2713 Stage activated \u2014 GPU rendering at 30 FPS." },
  { type: "out", text: "" },
  { type: "cmd", text: "dazzle stage sync . --stage particles" },
  { type: "out", text: "2 files synced." },
  { type: "out", text: "" },
  { type: "agent", text: "Your generative stream is live at dazzle.fm/s/particles" },
  { type: "out", text: "" },
  { type: "user", text: "stream it to twitch too" },
  { type: "out", text: "" },
  { type: "cmd", text: "dazzle destination add twitch" },
  { type: "out", text: '\u2713 Destination "twitch" added.' },
  { type: "out", text: "" },
  { type: "cmd", text: "dazzle destination attach twitch --stage particles" },
  { type: "out", text: "\u2713 Streaming to twitch.tv" },
];

const CREATIVE_SKETCH = `const canvas = document.querySelector('canvas')
const ctx = canvas.getContext('2d')

canvas.width = innerWidth
canvas.height = innerHeight

const particles = Array.from({ length: 1500 }, () => ({
  x: Math.random() * canvas.width,
  y: Math.random() * canvas.height,
  vx: 0, vy: 0,
  hue: Math.random() * 360,
  size: 1 + Math.random() * 2,
}))

const scale = 0.003
let time = 0

function noise(x, y) {
  return Math.sin(x * 1.2 + time) * Math.cos(y * 0.8 + time * 0.7)
       + Math.sin((x + y) * 0.5 + time * 1.3) * 0.5
}

function frame() {
  ctx.fillStyle = 'rgba(0, 0, 0, 0.04)'
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  time += 0.008

  for (const p of particles) {
    const angle = noise(p.x * scale, p.y * scale) * Math.PI * 2
    p.vx = p.vx * 0.95 + Math.cos(angle) * 0.8
    p.vy = p.vy * 0.95 + Math.sin(angle) * 0.8
    p.x += p.vx
    p.y += p.vy
    p.hue = (p.hue + 0.3) % 360

    // wrap around edges
    if (p.x < 0) p.x += canvas.width
    if (p.x > canvas.width) p.x -= canvas.width
    if (p.y < 0) p.y += canvas.height
    if (p.y > canvas.height) p.y -= canvas.height

    ctx.beginPath()
    ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2)
    ctx.fillStyle = \`hsla(\${p.hue}, 80%, 60%, 0.8)\`
    ctx.fill()
  }
  requestAnimationFrame(frame)
}
frame()`;

const CREATIVE_HTML = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    * { margin: 0 }
    body { overflow: hidden; background: #000 }
    canvas { display: block; width: 100vw; height: 100vh }
  </style>
</head>
<body>
  <canvas></canvas>
  <script src="sketch.js"></script>
</body>
</html>`;

const CREATIVE_PREVIEW = `<!DOCTYPE html><html><head><meta charset="utf-8">
<style>*{margin:0}body{overflow:hidden;background:#000}canvas{display:block;width:100vw;height:100vh}</style>
</head><body><canvas></canvas><script>
var c=document.querySelector('canvas'),x=c.getContext('2d');
c.width=c.clientWidth;c.height=c.clientHeight;
var ps=[];for(var i=0;i<800;i++)ps.push({x:Math.random()*c.width,y:Math.random()*c.height,vx:0,vy:0,h:Math.random()*360,s:1+Math.random()*2});
var sc=0.003,t=0;
function ns(a,b){return Math.sin(a*1.2+t)*Math.cos(b*0.8+t*0.7)+Math.sin((a+b)*0.5+t*1.3)*0.5}
function draw(){x.fillStyle='rgba(0,0,0,0.04)';x.fillRect(0,0,c.width,c.height);t+=0.008;
for(var i=0;i<ps.length;i++){var p=ps[i],a=ns(p.x*sc,p.y*sc)*Math.PI*2;
p.vx=p.vx*0.95+Math.cos(a)*0.8;p.vy=p.vy*0.95+Math.sin(a)*0.8;
p.x+=p.vx;p.y+=p.vy;p.h=(p.h+0.3)%360;
if(p.x<0)p.x+=c.width;if(p.x>c.width)p.x-=c.width;
if(p.y<0)p.y+=c.height;if(p.y>c.height)p.y-=c.height;
x.beginPath();x.arc(p.x,p.y,p.s,0,Math.PI*2);
x.fillStyle='hsla('+p.h+',80%,60%,0.8)';x.fill()}
requestAnimationFrame(draw)}draw();
<\/script></body></html>`;

// ─── Live Data ───────────────────────────────────────────────────────────────

const DATA_TERMINAL: TermLine[] = [
  { type: "user", text: "read dazzle.fm/llms.txt \u2014 build a live earthquake visualization and stream it 24/7" },
  { type: "out", text: "" },
  { type: "agent", text: "I'll build a real-time seismic feed on a Dazzle stage:" },
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
  { type: "agent", text: "Wrote globe renderer with USGS GeoJSON feed \u2014 quakes ripple on the surface in real time" },
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
  { type: "agent", text: "Live at dazzle.fm/s/earth-pulse \u2014 showing 127 quakes from the last 24 hours" },
  { type: "out", text: "" },
  { type: "user", text: "stream it to youtube" },
  { type: "out", text: "" },
  { type: "cmd", text: "dazzle destination add youtube" },
  { type: "out", text: '\u2713 Destination "youtube" added.' },
  { type: "out", text: "" },
  { type: "cmd", text: "dazzle destination attach youtube --stage earth-pulse" },
  { type: "out", text: "\u2713 Streaming to youtube.com" },
];

const DATA_FEED = `// Connect to a real-time data source and render it

const USGS_URL = 'https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/all_day.geojson'

interface Quake {
  lat: number
  lon: number
  mag: number
  place: string
  time: number
  age: number    // 0..1, how recent
  ripple: number // animation progress
}

const quakes: Quake[] = []

async function fetchQuakes() {
  const res = await fetch(USGS_URL)
  const data = await res.json()
  const now = Date.now()

  quakes.length = 0
  for (const f of data.features) {
    const [lon, lat] = f.geometry.coordinates
    quakes.push({
      lat, lon,
      mag: f.properties.mag,
      place: f.properties.place,
      time: f.properties.time,
      age: Math.max(0, 1 - (now - f.properties.time) / 86400000),
      ripple: 0,
    })
  }
  console.log(\`Loaded \${quakes.length} quakes\`)
}

// Poll every 5 minutes
fetchQuakes()
setInterval(fetchQuakes, 300_000)

// Project lat/lon to canvas coordinates
function project(lat: number, lon: number, w: number, h: number) {
  const x = ((lon + 180) / 360) * w
  const y = ((90 - lat) / 180) * h
  return { x, y }
}

// Render loop
const canvas = document.querySelector('canvas')!
const ctx = canvas.getContext('2d')!
canvas.width = innerWidth
canvas.height = innerHeight

function draw() {
  ctx.fillStyle = 'rgba(0, 4, 12, 0.15)'
  ctx.fillRect(0, 0, canvas.width, canvas.height)

  for (const q of quakes) {
    const { x, y } = project(q.lat, q.lon, canvas.width, canvas.height)
    const r = 2 + q.mag * 3
    const alpha = 0.3 + q.age * 0.7

    // Ripple ring
    q.ripple = (q.ripple + 0.02) % 1
    const rippleR = r + q.ripple * 20
    ctx.beginPath()
    ctx.arc(x, y, rippleR, 0, Math.PI * 2)
    ctx.strokeStyle = \`rgba(239, 68, 68, \${(1 - q.ripple) * alpha * 0.5})\`
    ctx.lineWidth = 1
    ctx.stroke()

    // Core dot
    ctx.beginPath()
    ctx.arc(x, y, r, 0, Math.PI * 2)
    ctx.fillStyle = \`rgba(239, 68, 68, \${alpha})\`
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
      background: #000c18;
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
      color: rgba(255,255,255,0.6);
      font-size: 11px;
      font-family: monospace;
    }
    .hud .count {
      color: #ef4444;
      font-size: 18px;
      font-weight: 700;
    }
    .hud .label {
      color: rgba(255,255,255,0.4);
      text-transform: uppercase;
      letter-spacing: 0.1em;
      font-size: 9px;
    }
  </style>
</head>
<body>
  <canvas></canvas>
  <div class="hud">
    <div class="label">Earthquakes \u00B7 last 24h</div>
    <div class="count" id="count">0</div>
    <div>USGS real-time feed</div>
  </div>
  <script src="feed.ts"></script>
</body>
</html>`;

const DATA_PREVIEW = `<!DOCTYPE html><html><head><meta charset="utf-8">
<style>
*{margin:0;box-sizing:border-box}
body{background:#000c18;overflow:hidden;font-family:system-ui,sans-serif}
canvas{display:block;width:100vw;height:100vh}
.hud{position:absolute;top:8px;left:8px;color:rgba(255,255,255,0.6);font-size:7px;font-family:monospace}
.hud .ct{color:#ef4444;font-size:12px;font-weight:700}
.hud .lb{color:rgba(255,255,255,0.4);text-transform:uppercase;letter-spacing:0.1em;font-size:6px}
</style></head><body>
<canvas></canvas>
<div class="hud"><div class="lb">Earthquakes \u00B7 last 24h</div><div class="ct" id="ct">0</div><div>USGS real-time feed</div></div>
<script>
var c=document.querySelector('canvas'),x=c.getContext('2d');
c.width=c.clientWidth;c.height=c.clientHeight;
var qs=[];
// Generate mock quake data across the globe
var hotspots=[[35.6,139.7],[37.7,-122.4],[-33.4,-70.6],[36.2,28.0],[28.6,77.2],[-6.2,106.8],[51.5,-0.1],[38.7,-9.1],[4.6,-74.1],[13.7,100.5],[-37.8,144.9],[40.4,-3.7],[55.7,37.6],[30.0,31.2],[1.3,103.8],[-22.9,-43.2],[48.8,2.3],[39.9,116.4],[41.0,29.0],[-1.3,36.8]];
for(var i=0;i<80;i++){var h=hotspots[Math.floor(Math.random()*hotspots.length)];
var lat=h[0]+(Math.random()-0.5)*30;var lon=h[1]+(Math.random()-0.5)*30;
qs.push({lat:lat,lon:lon,mag:1+Math.random()*5,age:Math.random(),rip:Math.random()})}
document.getElementById('ct').textContent=qs.length;
// Subtle coastline grid
function drawGrid(){x.strokeStyle='rgba(255,255,255,0.03)';x.lineWidth=0.5;
for(var i=0;i<=18;i++){var yy=i/18*c.height;x.beginPath();x.moveTo(0,yy);x.lineTo(c.width,yy);x.stroke()}
for(var i=0;i<=36;i++){var xx=i/36*c.width;x.beginPath();x.moveTo(xx,0);x.lineTo(xx,c.height);x.stroke()}}
function proj(lat,lon){return{x:(lon+180)/360*c.width,y:(90-lat)/180*c.height}}
function draw(){x.fillStyle='rgba(0,12,24,0.12)';x.fillRect(0,0,c.width,c.height);
drawGrid();
for(var i=0;i<qs.length;i++){var q=qs[i],p=proj(q.lat,q.lon);
var r=1+q.mag*1.5;var a=0.3+q.age*0.7;
q.rip=(q.rip+0.015)%1;
var rr=r+q.rip*12;
x.beginPath();x.arc(p.x,p.y,rr,0,Math.PI*2);
x.strokeStyle='rgba(239,68,68,'+(1-q.rip)*a*0.4+')';x.lineWidth=0.5;x.stroke();
x.beginPath();x.arc(p.x,p.y,r,0,Math.PI*2);
x.fillStyle='rgba(239,68,68,'+a+')';x.fill();
// Glow
x.beginPath();x.arc(p.x,p.y,r*2.5,0,Math.PI*2);
x.fillStyle='rgba(239,68,68,'+a*0.08+')';x.fill()}
// Occasionally add a new quake
if(Math.random()>0.98){var h=hotspots[Math.floor(Math.random()*hotspots.length)];
qs.push({lat:h[0]+(Math.random()-0.5)*20,lon:h[1]+(Math.random()-0.5)*20,mag:1+Math.random()*4,age:1,rip:0});
if(qs.length>120)qs.shift();document.getElementById('ct').textContent=qs.length}
requestAnimationFrame(draw)}draw();
<\/script></body></html>`;

// ─── AI VTuber ───────────────────────────────────────────────────────────────

const VTUBER_TERMINAL: TermLine[] = [
  { type: "user", text: "read dazzle.fm/llms.txt \u2014 set up a 24/7 stream for my AI character Luna" },
  { type: "out", text: "" },
  { type: "agent", text: "I'll create a Dazzle stage with a character overlay and chat widget:" },
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
  { type: "agent", text: "Wrote overlay with character model, chat widget, and TTS integration" },
  { type: "out", text: "" },
  { type: "cmd", text: "npm run build" },
  { type: "out", text: "\u2713 Built in 0.8s" },
  { type: "out", text: "" },
  { type: "cmd", text: "dazzle stage up --stage luna-stream" },
  { type: "out", text: "\u2713 Stage activated \u2014 GPU rendering at 30 FPS." },
  { type: "out", text: "" },
  { type: "cmd", text: "dazzle stage sync ./dist --stage luna-stream" },
  { type: "out", text: "6 files synced." },
  { type: "out", text: "" },
  { type: "agent", text: "Luna is live at dazzle.fm/s/luna-stream" },
  { type: "out", text: "" },
  { type: "user", text: "connect it to twitch" },
  { type: "out", text: "" },
  { type: "cmd", text: "dazzle destination add twitch" },
  { type: "out", text: '\u2713 Destination "twitch" added.' },
  { type: "out", text: "" },
  { type: "cmd", text: "dazzle destination attach twitch --stage luna-stream" },
  { type: "out", text: "\u2713 Streaming to twitch.tv" },
];

const VTUBER_OVERLAY = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    * { margin: 0; box-sizing: border-box }
    body {
      background: linear-gradient(135deg, #0f0524, #1a0a2e);
      height: 100vh; overflow: hidden;
      font-family: 'Segoe UI', system-ui, sans-serif;
    }
    .scene { position: relative; width: 100%; height: 100% }

    /* Character silhouette — replaced with your Live2D model */
    .character {
      position: absolute; bottom: 0; left: 50%;
      transform: translateX(-50%);
      width: 300px; height: 400px;
    }

    /* Chat overlay */
    .chat {
      position: absolute; right: 16px; bottom: 16px;
      width: 280px; max-height: 60%;
      display: flex; flex-direction: column; gap: 6px;
    }
    .chat-msg {
      background: rgba(0,0,0,0.6);
      border: 1px solid rgba(139,92,246,0.3);
      border-radius: 8px; padding: 8px 12px;
      animation: slideIn 0.3s ease-out;
    }
    .chat-user { color: #a78bfa; font-size: 12px; font-weight: 600 }
    .chat-text { color: #e4e4e7; font-size: 13px; margin-top: 2px }

    /* Speaking indicator */
    .speaking {
      position: absolute; bottom: 380px; left: 50%;
      transform: translateX(-50%);
      background: rgba(139,92,246,0.2);
      border: 1px solid rgba(139,92,246,0.4);
      border-radius: 12px; padding: 8px 16px;
      color: #c4b5fd; font-size: 13px;
    }

    @keyframes slideIn {
      from { opacity: 0; transform: translateY(8px) }
      to { opacity: 1; transform: translateY(0) }
    }
  </style>
</head>
<body>
  <div class="scene">
    <div class="character" id="model"></div>
    <div class="speaking" id="speech"></div>
    <div class="chat" id="chat"></div>
  </div>
  <script src="chat.ts"></script>
</body>
</html>`;

const VTUBER_CHAT = `// Chat handler — receives messages, drives character responses

const VIEWERS = ['astral_fox', 'pixel_witch', 'neon_drift', 'synthwave99']
const MESSAGES = [
  'hi luna!', 'love the stream!', 'can you sing something?',
  'what are you playing?', 'your outfit is so cute!',
  'how long have you been streaming?', 'luna best vtuber!',
]
const RESPONSES = [
  'Thank you so much! You are so kind~',
  'I have been streaming for a while now! Time flies!',
  'Aww, you are making me blush!',
  'Let me think about that one~',
  'Welcome to the stream, everyone!',
]

interface ChatMessage {
  user: string
  text: string
  isLuna?: boolean
}

const chatEl = document.getElementById('chat')!
const speechEl = document.getElementById('speech')!
const messages: ChatMessage[] = []

function addMessage(msg: ChatMessage) {
  messages.push(msg)
  if (messages.length > 8) messages.shift()

  const div = document.createElement('div')
  div.className = 'chat-msg'
  div.innerHTML = \`
    <div class="chat-user" style="color: \${msg.isLuna ? '#c084fc' : '#a78bfa'}">
      \${msg.isLuna ? '\u2606 Luna' : msg.user}
    </div>
    <div class="chat-text">\${msg.text}</div>
  \`
  chatEl.appendChild(div)

  // Keep only last 8 messages visible
  while (chatEl.children.length > 8) {
    chatEl.removeChild(chatEl.firstChild!)
  }
}

function speak(text: string) {
  speechEl.textContent = text
  speechEl.style.opacity = '1'
  setTimeout(() => { speechEl.style.opacity = '0' }, 4000)
}

// Simulate viewer chat
setInterval(() => {
  const user = VIEWERS[Math.floor(Math.random() * VIEWERS.length)]
  const text = MESSAGES[Math.floor(Math.random() * MESSAGES.length)]
  addMessage({ user, text })

  // Luna responds sometimes
  if (Math.random() > 0.5) {
    const response = RESPONSES[Math.floor(Math.random() * RESPONSES.length)]
    setTimeout(() => {
      addMessage({ user: 'Luna', text: response, isLuna: true })
      speak(response)
    }, 1500 + Math.random() * 2000)
  }
}, 4000 + Math.random() * 3000)`;

const VTUBER_PREVIEW = `<!DOCTYPE html><html><head><meta charset="utf-8">
<style>
*{margin:0;box-sizing:border-box}
body{background:linear-gradient(135deg,#0f0524,#1a0a2e);height:100vh;overflow:hidden;font-family:system-ui,sans-serif}
.char{position:absolute;bottom:0;left:50%;transform:translateX(-50%);width:120px;height:200px;display:flex;flex-direction:column;align-items:center}
.head{width:60px;height:60px;border-radius:50%;background:linear-gradient(135deg,#c084fc,#818cf8);position:relative;margin-bottom:4px}
.eye{position:absolute;width:8px;height:10px;background:#1e1b4b;border-radius:50%;top:22px}
.eye.l{left:16px}.eye.r{right:16px}
.mouth{position:absolute;bottom:14px;left:50%;transform:translateX(-50%);width:12px;height:6px;border-radius:0 0 6px 6px;background:#1e1b4b}
.body{width:50px;height:80px;background:linear-gradient(180deg,#7c3aed,#6d28d9);border-radius:20px 20px 0 0;position:relative}
.hair{position:absolute;top:-8px;left:-10px;right:-10px;height:40px;background:linear-gradient(180deg,#a78bfa,#7c3aed);border-radius:50% 50% 0 0}
.glow{position:absolute;bottom:40px;left:50%;transform:translateX(-50%);width:200px;height:100px;background:radial-gradient(ellipse,rgba(139,92,246,0.15),transparent);pointer-events:none}
.chat{position:absolute;right:8px;bottom:8px;width:45%;display:flex;flex-direction:column;gap:3px}
.msg{background:rgba(0,0,0,0.6);border:1px solid rgba(139,92,246,0.3);border-radius:6px;padding:4px 6px;animation:si 0.3s ease-out}
.mu{color:#a78bfa;font-size:7px;font-weight:600}.mt{color:#e4e4e7;font-size:8px;margin-top:1px}
.luna .mu{color:#c084fc}
.speech{position:absolute;top:30%;left:50%;transform:translateX(-50%);background:rgba(139,92,246,0.2);border:1px solid rgba(139,92,246,0.4);border-radius:8px;padding:4px 10px;color:#c4b5fd;font-size:8px;opacity:0;transition:opacity 0.3s;white-space:nowrap}
.stars{position:absolute;top:0;left:0;right:0;bottom:0;pointer-events:none}
.star{position:absolute;width:2px;height:2px;background:#fff;border-radius:50%;animation:twinkle 2s infinite}
@keyframes si{from{opacity:0;transform:translateY(4px)}to{opacity:1;transform:translateY(0)}}
@keyframes twinkle{0%,100%{opacity:0.3}50%{opacity:1}}
@keyframes bob{0%,100%{transform:translateX(-50%) translateY(0)}50%{transform:translateX(-50%) translateY(-4px)}}
.char{animation:bob 3s ease-in-out infinite}
</style>
</head><body>
<div class="stars" id="stars"></div>
<div class="glow"></div>
<div class="char"><div class="hair"></div><div class="head"><div class="eye l"></div><div class="eye r"></div><div class="mouth" id="mo"></div></div><div class="body"></div></div>
<div class="speech" id="sp"></div>
<div class="chat" id="ch"></div>
<script>
var st=document.getElementById('stars');for(var i=0;i<30;i++){var s=document.createElement('div');s.className='star';s.style.left=Math.random()*100+'%';s.style.top=Math.random()*60+'%';s.style.animationDelay=Math.random()*2+'s';st.appendChild(s)}
var users=['astral_fox','pixel_witch','neon_drift','synth99'];
var msgs=['hi luna!','love the stream!','so cute!','best vtuber!','sing something!','welcome!'];
var resps=['Thank you~!','You are so kind!','Aww, welcome!','Let me think~'];
var ch=document.getElementById('ch'),sp=document.getElementById('sp'),mo=document.getElementById('mo');
function addMsg(u,t,luna){var d=document.createElement('div');d.className='msg'+(luna?' luna':'');
d.innerHTML='<div class="mu">'+(luna?'\u2606 Luna':u)+'</div><div class="mt">'+t+'</div>';
ch.appendChild(d);while(ch.children.length>5)ch.removeChild(ch.firstChild)}
function speak(t){sp.textContent=t;sp.style.opacity='1';mo.style.height='10px';mo.style.borderRadius='50%';
setTimeout(function(){sp.style.opacity='0';mo.style.height='6px';mo.style.borderRadius='0 0 6px 6px'},3000)}
function tick(){var u=users[Math.floor(Math.random()*users.length)];
var m=msgs[Math.floor(Math.random()*msgs.length)];addMsg(u,m,false);
if(Math.random()>0.4){var r=resps[Math.floor(Math.random()*resps.length)];
setTimeout(function(){addMsg('Luna',r,true);speak(r)},1500)}}
tick();setInterval(tick,4000+Math.random()*3000);
<\/script></body></html>`;

// ─── Digital Signage ─────────────────────────────────────────────────────────

const SIGNAGE_TERMINAL: TermLine[] = [
  { type: "user", text: "read dazzle.fm/llms.txt \u2014 I need to put our sales dashboard on the lobby TV" },
  { type: "out", text: "" },
  { type: "agent", text: "I'll set up an always-on Dazzle stage for your lobby display:" },
  { type: "out", text: "" },
  { type: "exec", text: "curl -sSL https://dazzle.fm/install.sh | sh" },
  { type: "out", text: "Dazzle CLI installed." },
  { type: "out", text: "" },
  { type: "exec", text: "dazzle login" },
  { type: "out", text: "\u2713 Logged in as you@example.com" },
  { type: "out", text: "" },
  { type: "user", text: "done, go ahead" },
  { type: "out", text: "" },
  { type: "cmd", text: "dazzle stage create lobby-display" },
  { type: "out", text: 'Stage "lobby-display" created.' },
  { type: "out", text: "" },
  { type: "agent", text: "Wrote dashboard with KPI cards, team metrics, and live clock" },
  { type: "out", text: "" },
  { type: "cmd", text: "npm run build" },
  { type: "out", text: "\u2713 Built in 0.5s" },
  { type: "out", text: "" },
  { type: "cmd", text: "dazzle stage up --stage lobby-display" },
  { type: "out", text: "\u2713 Stage activated \u2014 rendering at 30 FPS." },
  { type: "out", text: "" },
  { type: "cmd", text: "dazzle stage sync ./dist --stage lobby-display" },
  { type: "out", text: "4 files synced." },
  { type: "out", text: "" },
  { type: "agent", text: "Display is live at dazzle.fm/s/lobby-display" },
  { type: "out", text: "" },
  { type: "user", text: "how do I put this on the TV?" },
  { type: "out", text: "" },
  { type: "agent", text: "Open dazzle.fm/s/lobby-display in any browser on the TV \u2014 or stream via YouTube:" },
  { type: "out", text: "" },
  { type: "cmd", text: "dazzle destination add youtube" },
  { type: "out", text: '\u2713 Destination "youtube" added.' },
  { type: "out", text: "" },
  { type: "cmd", text: "dazzle destination attach youtube --stage lobby-display" },
  { type: "out", text: "\u2713 Streaming to youtube.com" },
];

const SIGNAGE_DISPLAY = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    * { margin: 0; box-sizing: border-box }
    body {
      background: #09090b;
      font-family: system-ui, sans-serif;
      height: 100vh;
      padding: 32px;
      display: grid;
      grid-template-columns: repeat(4, 1fr);
      grid-template-rows: auto 1fr auto;
      gap: 20px;
    }
    .header {
      grid-column: 1 / -1;
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
    .title { color: #fff; font-size: 20px; font-weight: 700 }
    .clock { color: #a1a1aa; font-family: monospace; font-size: 18px }
    .kpi {
      background: #18181b;
      border: 1px solid #27272a;
      border-radius: 12px;
      padding: 20px;
    }
    .kpi-label {
      color: #71717a;
      font-size: 11px;
      text-transform: uppercase;
      letter-spacing: 0.05em;
    }
    .kpi-value {
      color: #fff;
      font-size: 32px;
      font-weight: 700;
      font-family: monospace;
      margin-top: 4px;
    }
    .kpi-delta {
      font-size: 12px;
      margin-top: 4px;
      font-family: monospace;
    }
    .up { color: #34d399 }
    .down { color: #f87171 }
    .bar-section {
      grid-column: 1 / -1;
    }
  </style>
</head>
<body>
  <div class="header">
    <span class="title">Acme Corp</span>
    <span class="clock" id="clock"></span>
  </div>
  <div id="kpis"></div>
  <script src="metrics.ts"></script>
</body>
</html>`;

const SIGNAGE_METRICS = `// KPI metrics — connect to your data source

const KPIS = [
  { label: 'Revenue',       value: 284900, prefix: '$', format: 'compact', delta: 12.4 },
  { label: 'Active Users',  value: 14820,  prefix: '',  format: 'number',  delta: 8.2  },
  { label: 'Conversion',    value: 3.42,   prefix: '',  format: 'percent', delta: -0.3 },
  { label: 'Avg Response',  value: 142,    prefix: '',  format: 'ms',      delta: -5.1 },
]

function formatValue(kpi: typeof KPIS[0]): string {
  switch (kpi.format) {
    case 'compact':
      return kpi.prefix + (kpi.value / 1000).toFixed(1) + 'K'
    case 'number':
      return kpi.prefix + kpi.value.toLocaleString()
    case 'percent':
      return kpi.value.toFixed(2) + '%'
    case 'ms':
      return kpi.value + 'ms'
    default:
      return String(kpi.value)
  }
}

// Render KPIs
const container = document.getElementById('kpis')!
container.style.display = 'contents'

KPIS.forEach(kpi => {
  const card = document.createElement('div')
  card.className = 'kpi'
  const up = kpi.delta >= 0
  card.innerHTML = \`
    <div class="kpi-label">\${kpi.label}</div>
    <div class="kpi-value">\${formatValue(kpi)}</div>
    <div class="kpi-delta \${up ? 'up' : 'down'}">
      \${up ? '\u2191' : '\u2193'} \${Math.abs(kpi.delta)}%
    </div>
  \`
  container.appendChild(card)
})

// Live clock
const clock = document.getElementById('clock')!
function updateClock() {
  clock.textContent = new Date().toLocaleTimeString('en-US', {
    hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit'
  })
}
updateClock()
setInterval(updateClock, 1000)

// Simulate live data updates
setInterval(() => {
  KPIS.forEach((kpi, i) => {
    const change = kpi.value * (Math.random() - 0.48) * 0.005
    kpi.value += change
    const card = container.children[i] as HTMLElement
    const valueEl = card.querySelector('.kpi-value')!
    valueEl.textContent = formatValue(kpi)
  })
}, 3000)`;

const SIGNAGE_PREVIEW = `<!DOCTYPE html><html><head><meta charset="utf-8">
<style>
*{margin:0;box-sizing:border-box}
body{background:#09090b;font-family:system-ui,sans-serif;height:100vh;padding:10px;display:flex;flex-direction:column;gap:8px;overflow:hidden}
.hdr{display:flex;justify-content:space-between;align-items:center}
.ttl{color:#fff;font-size:11px;font-weight:700}.clk{color:#a1a1aa;font-family:monospace;font-size:10px}
.grid{display:grid;grid-template-columns:repeat(4,1fr);gap:6px;flex:1}
.kpi{background:#18181b;border:1px solid #27272a;border-radius:8px;padding:8px;display:flex;flex-direction:column}
.kl{color:#71717a;font-size:7px;text-transform:uppercase;letter-spacing:0.05em}
.kv{color:#fff;font-size:16px;font-weight:700;font-family:monospace;margin-top:2px}
.kd{font-size:7px;font-family:monospace;margin-top:auto;padding-top:4px}
.up{color:#34d399}.dn{color:#f87171}
.bars{display:grid;grid-template-columns:repeat(7,1fr);gap:4px;align-items:end;height:40px}
.bar{background:linear-gradient(180deg,#34d399,#059669);border-radius:3px 3px 0 0;min-height:4px;transition:height 0.5s}
.bl{color:#71717a;font-size:6px;text-align:center;margin-top:2px}
.bsec{background:#18181b;border:1px solid #27272a;border-radius:8px;padding:8px}
.bttl{color:#71717a;font-size:7px;text-transform:uppercase;letter-spacing:0.05em;margin-bottom:6px}
</style></head><body>
<div class="hdr"><span class="ttl">Acme Corp</span><span class="clk" id="c"></span></div>
<div class="grid" id="g"></div>
<div class="bsec"><div class="bttl">Weekly Sales</div><div class="bars" id="b"></div></div>
<script>
var kpis=[{l:'Revenue',v:284900,p:'$',f:'c',d:12.4},{l:'Active Users',v:14820,p:'',f:'n',d:8.2},{l:'Conversion',v:3.42,p:'',f:'p',d:-0.3},{l:'Avg Response',v:142,p:'',f:'m',d:-5.1}];
function fmt(k){if(k.f==='c')return k.p+(k.v/1000).toFixed(1)+'K';if(k.f==='n')return k.p+Math.floor(k.v).toLocaleString();if(k.f==='p')return k.v.toFixed(2)+'%';return k.v.toFixed(0)+'ms'}
var g=document.getElementById('g');
function renderKpis(){g.innerHTML='';kpis.forEach(function(k){var d=document.createElement('div');d.className='kpi';var up=k.d>=0;
d.innerHTML='<div class="kl">'+k.l+'</div><div class="kv">'+fmt(k)+'</div><div class="kd '+(up?'up':'dn')+'">'+(up?'\u2191':'\u2193')+' '+Math.abs(k.d).toFixed(1)+'%</div>';g.appendChild(d)})}
renderKpis();
var days=['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];
var bv=[65,78,82,71,90,55,42];
var b=document.getElementById('b');
function renderBars(){b.innerHTML='';var mx=Math.max.apply(null,bv);bv.forEach(function(v,i){var w=document.createElement('div');w.style.display='flex';w.style.flexDirection='column';w.style.alignItems='center';
var bar=document.createElement('div');bar.className='bar';bar.style.height=(v/mx*100)+'%';
var lbl=document.createElement('div');lbl.className='bl';lbl.textContent=days[i];
w.appendChild(bar);w.appendChild(lbl);b.appendChild(w)})}
renderBars();
var c=document.getElementById('c');
function uc(){c.textContent=new Date().toLocaleTimeString('en-US',{hour12:false,hour:'2-digit',minute:'2-digit',second:'2-digit'})}uc();setInterval(uc,1000);
setInterval(function(){kpis.forEach(function(k){k.v+=k.v*(Math.random()-0.48)*0.005});renderKpis();bv=bv.map(function(v){return Math.max(20,v+(Math.random()-0.5)*8)});renderBars()},3000);
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
      { name: "scene.glsl", code: AGENTS_GLSL, language: "glsl" },
      { name: "stream.ts", code: AGENTS_MAIN, language: "typescript" },
    ],
    previewHtml: AGENTS_PREVIEW,
    demoTitleBar: "lofi-radio \u2014 dazzle.fm",
    statusBarLanguage: "GLSL",
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
    subtitle: "Stream dashboards, menus, and status boards to TVs, lobby displays, and digital signs.",
    ctaText: "Set up your display",
    ctaFinalText: "Launch your first display",
    stepCreateDesc: "Your content runs in a cloud browser \u2014 cast it to any screen with just a URL.",
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
