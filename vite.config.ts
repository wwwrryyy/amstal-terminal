import { defineConfig } from "vite";
import { svelte } from "@sveltejs/vite-plugin-svelte";

const platform = process.env.TAURI_ENV_PLATFORM || process.env.TAURI_PLATFORM;
const isDebug = !!(process.env.TAURI_ENV_DEBUG || process.env.TAURI_DEBUG);

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [svelte()],
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    watch: {
      ignored: ["**/src-tauri/**"],
    },
  },
  envPrefix: ["VITE_", "TAURI_ENV_", "TAURI_"],
  build: {
    target: platform === "windows" ? "chrome105" : "safari15",
    minify: !isDebug ? "esbuild" : false,
    sourcemap: isDebug,
  },
});
