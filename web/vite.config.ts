import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";

export default defineConfig({
  plugins: [react(), tailwindcss()],
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
      "/stage": "http://localhost:8080",
    },
  },
});
