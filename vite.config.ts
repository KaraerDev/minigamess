import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import path from "node:path";
import { defineConfig, type Plugin } from "vite";
import { publicPlatformScript } from "./server/_core/publicConfig";

// Serves the same tiny public config script as Express (only non-secret
// values). Keeps `vite build` output compatible with `serveStatic()`.
function vitePluginPublicPlatformConfig(): Plugin {
  return {
    name: "public-platform-config",
    configureServer(server) {
      server.middlewares.use("/api/platform/config.js", (_req, res) => {
        res.setHeader("Content-Type", "application/javascript");
        res.setHeader("Cache-Control", "no-store");
        res.end(publicPlatformScript());
      });
    },
    generateBundle() {
      this.emitFile({ type: "asset", fileName: "api/platform/config.js", source: publicPlatformScript() });
    },
  };
}

const plugins = [vitePluginPublicPlatformConfig(), react(), tailwindcss()];

export default defineConfig({
  plugins,
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "client", "src"),
      "@shared": path.resolve(import.meta.dirname, "shared"),
      "@assets": path.resolve(import.meta.dirname, "attached_assets"),
    },
  },
  envDir: path.resolve(import.meta.dirname),
  root: path.resolve(import.meta.dirname, "client"),
  publicDir: path.resolve(import.meta.dirname, "client", "public"),
  build: {
    outDir: path.resolve(import.meta.dirname, "dist/public"),
    emptyOutDir: true,
  },
  server: {
    host: true,
    fs: {
      strict: true,
      deny: ["**/.*"],
    },
  },
});
