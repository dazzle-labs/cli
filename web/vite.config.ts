import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";
import fs from "fs";

// goTemplatePlugin emits index.html.tmpl into dist/ at build time.
// It reads the source template (control-plane/index.html.tmpl), replaces
// {{.ViteHead}} with the actual Vite-generated script/link tags, and writes
// the result so the Go control-plane can parse it with no runtime extraction.
function goTemplatePlugin(): Plugin {
  return {
    name: "go-template",
    apply: "build",
    closeBundle() {
      const distIndex = fs.readFileSync("dist/index.html", "utf-8");

      // Collect Vite-injected tags from the built HTML (scripts + non-font links)
      const viteTags: string[] = [];
      for (const m of distIndex.matchAll(/<script\b[^>]*>.*?<\/script>/gs)) {
        viteTags.push(m[0]);
      }
      for (const m of distIndex.matchAll(/<link\b[^>]*\/?>/g)) {
        const tag = m[0];
        if (tag.includes("preconnect") || tag.includes("fonts.googleapis.com"))
          continue;
        viteTags.push(tag);
      }

      const tmplSrc = fs.readFileSync(
        path.resolve(__dirname, "../control-plane/index.html.tmpl"),
        "utf-8",
      );
      const out = tmplSrc.replace("{{.ViteHead}}", viteTags.join("\n    "));
      fs.writeFileSync("dist/index.html.tmpl", out);
    },
  };
}

export default defineConfig({
  plugins: [react(), tailwindcss(), goTemplatePlugin()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      "@shared": path.resolve(__dirname, "../shared"),
    },
  },
  server: {
    proxy: {
      "/dazzle.v1": "http://localhost:8080",
      "/dazzle.internal.v1": "http://localhost:8080",
      "/cdp": "http://localhost:8080",
      "/session": "http://localhost:8080",
      "/health": "http://localhost:8080",
      "/oauth": "http://localhost:8080",
      "/auth/cli/session": "http://localhost:8080",
      "/stage": "http://localhost:8080",
    },
  },
});
