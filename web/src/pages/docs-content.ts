import { cli } from "@/lib/cli-commands";

export const INSTALL_SNIPPET_UNIX =
  "curl -sSL https://dazzle.fm/install.sh | sh";

export const INSTALL_SNIPPET_WINDOWS =
  "irm https://dazzle.fm/install.ps1 | iex";

export const INSTALL_SNIPPET_GO =
  "go install github.com/dazzle-labs/cli/cmd/dazzle@latest";

export type InstallTab = "unix" | "windows" | "go";

export const INSTALL_TABS: { id: InstallTab; label: string; cmd: string }[] = [
  { id: "unix", label: "macOS / Linux", cmd: INSTALL_SNIPPET_UNIX },
  { id: "windows", label: "Windows", cmd: INSTALL_SNIPPET_WINDOWS },
  { id: "go", label: "Go", cmd: INSTALL_SNIPPET_GO },
];

export const BOOTSTRAP_HTML = `<!DOCTYPE html>
<html>
<head>
  <style>
    * { margin: 0; box-sizing: border-box; }
    body { width: 100vw; height: 100vh; overflow: hidden;
           display: grid; place-items: center; background: #000; }
    h1 { color: #fff; font: bold 4rem system-ui; }
  </style>
</head>
<body><h1>Hello, Dazzle</h1></body>
</html>`;

export interface QuickStartStep {
  n: number;
  label: string;
  cmd?: string;
  code?: string;
  language?: string;
  note?: string;
}

export const QUICK_START_STEPS: QuickStartStep[] = [
  { n: 1, label: "Authenticate", cmd: cli.login.full },
  { n: 2, label: "Create a stage", cmd: cli.stageCreate.full },
  { n: 3, label: "Create content", cmd: "mkdir my-stage", code: BOOTSTRAP_HTML, language: "html", note: "Save as my-stage/index.html" },
  { n: 4, label: "Push content", cmd: cli.stageSync.full },
  { n: 5, label: "Screenshot to verify", cmd: cli.stageScreenshot.full },
  { n: 6, label: "Check status", cmd: cli.stageStatus.full },
];

export const FRAMEWORK_SNIPPET = `# React, Next.js, Svelte, Vue, Astro — anything with a build step
npm run build
${cli.stageSync.base} ./dist

# Or plain HTML — no build step needed
${cli.stageSync.base} ./my-stage`;

export const FRAMEWORK_EXAMPLES: { name: string; cmd: string }[] = [
  { name: "React / Vite", cmd: "npm create vite@latest my-stage -- --template react\ncd my-stage && npm install && npm run build\ndazzle stage sync ./dist" },
  { name: "Next.js", cmd: "npx create-next-app@latest my-stage\ncd my-stage && npm run build && npx next export\ndazzle stage sync ./out" },
  { name: "Svelte", cmd: "npx sv create my-stage\ncd my-stage && npm install && npm run build\ndazzle stage sync ./build" },
  { name: "Plain HTML", cmd: "mkdir my-stage\n# create my-stage/index.html\ndazzle stage sync ./my-stage" },
];

export const EVENTS_HTML_SNIPPET = `<!-- my-stage/index.html -->
<!DOCTYPE html>
<html>
<head>
  <style>
    * { margin: 0; box-sizing: border-box; }
    html, body { width: 100%; height: 100%; overflow: hidden; background: #000; }
    body { display: grid; place-items: center; }
    .score { color: #fff; font: bold 8rem system-ui; transition: transform 0.2s; }
    .score.bump { transform: scale(1.2); }
  </style>
</head>
<body>
  <div class="score" id="score">0</div>
  <script>
    // Restore state from localStorage on load
    const saved = localStorage.getItem('score');
    if (saved) document.getElementById('score').textContent = saved;

    // Listen for live events from \`dazzle stage event emit\`
    window.addEventListener('score', (e) => {
      const el = document.getElementById('score');
      el.textContent = e.detail.points;
      localStorage.setItem('score', e.detail.points);
      el.classList.add('bump');
      setTimeout(() => el.classList.remove('bump'), 200);
    });
  </script>
</body>
</html>`;

export const EVENTS_CLI_SNIPPET = `# Push a live event — no re-sync needed
${cli.stageEventEmit.full}

# The score updates instantly on your stage
# localStorage persists it across stage restarts`;

export const PERSISTENCE_SNIPPET = `# Deactivate and reactivate — localStorage survives
${cli.stageDown.full}
${cli.stageUp.full}
${cli.stageScreenshot.full}
# Score is still there`;

export const MULTI_STAGE_SNIPPET = `# List all stages
${cli.stageList.full}

# Target a specific stage
${cli.stageUp.base} -s my-stage
${cli.stageSync.base} ./my-stage -s my-stage`;
