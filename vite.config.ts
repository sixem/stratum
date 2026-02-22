import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

// @ts-expect-error process is a nodejs global
const host = process.env.TAURI_DEV_HOST;
const rootDir = fileURLToPath(new URL(".", import.meta.url));

// https://vite.dev/config/
export default defineConfig(async () => ({
  plugins: [react()],
  resolve: {
    alias: {
      "@": resolve(rootDir, "src"),
    },
  },
  build: {
    rollupOptions: {
      output: {
        // Keep chunk boundaries stable as features grow.
        manualChunks(id) {
          const moduleId = id.replace(/\\/g, "/");
          if (moduleId.includes("/node_modules/")) {
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

          if (
            moduleId.includes("/src/components/overlay/ConversionModal") ||
            moduleId.includes("/src/hooks/ui/app/conversion/") ||
            moduleId.includes("/src/constants/convert") ||
            moduleId.includes("/src/types/conversion")
          ) {
            return "feature-conversion";
          }

          if (moduleId.includes("/src/components/preview/QuickPreview")) {
            return "feature-preview";
          }

          if (
            moduleId.includes("/src/components/overlay/SettingsOverlay") ||
            moduleId.includes("/src/components/settings/")
          ) {
            return "feature-settings";
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
    port: 5173,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 5173,
        }
      : undefined,
    watch: {
      // 3. tell Vite to ignore watching `src-tauri`
      ignored: ["**/src-tauri/**"],
    },
  },
}));
