import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const host = process.env.TAURI_DEV_HOST;
const localDevHost = "127.0.0.1";
const devPort = 1420;
const rootDir = fileURLToPath(new URL(".", import.meta.url));

// https://vite.dev/config/
export default defineConfig(async () => ({
  // Serve the app from the repository root so dev can resolve `/src/main.tsx`.
  // Static assets still come from `public/`, and Tauri still reads the compiled app from `dist/`.
  root: rootDir,
  plugins: [react()],
  resolve: {
    alias: {
      "@": resolve(rootDir, "src"),
    },
  },
  build: {
    outDir: resolve(rootDir, "dist"),
    emptyOutDir: true,
    rollupOptions: {
      output: {
        // Let dynamic imports define feature boundaries. Pulling their shared
        // dependencies into a named feature chunk can make it a startup import.
        onlyExplicitManualChunks: true,
        manualChunks(id) {
          const moduleId = id.replace(/\\/g, "/");
          if (moduleId.includes("/node_modules/")) {
            if (moduleId.includes("/@xterm/xterm/")) return "vendor-terminal";
            if (
              moduleId.includes("/react/") ||
              moduleId.includes("/react-dom/") ||
              moduleId.includes("/scheduler/")
            ) {
              return "vendor-react";
            }
            if (moduleId.includes("/@tauri-apps/")) {
              return "vendor-tauri";
            }
            return "vendor";
          }

          return undefined;
        },
      },
    },
  },

  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  //
  // 1. prevent Vite from obscuring rust errors
  clearScreen: false,
  // 2. tauri expects a fixed port, fail if that port is not available
  server: {
    port: devPort,
    strictPort: true,
    // Use an explicit IPv4 loopback address so Windows does not resolve `localhost` to `::1`.
    host: host || localDevHost,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: devPort,
        }
      : undefined,
    watch: {
      // 3. tell Vite to ignore watching `src-tauri`
      ignored: ["**/src-tauri/**"],
    },
  },
}));
