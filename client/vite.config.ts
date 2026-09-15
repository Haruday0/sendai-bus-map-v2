import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const maplibreWorkerPath = fileURLToPath(
  new URL(
    "./node_modules/maplibre-gl/dist/maplibre-gl-worker.mjs",
    import.meta.url,
  ),
);
const maplibreSharedPath = fileURLToPath(
  new URL(
    "./node_modules/maplibre-gl/dist/maplibre-gl-shared.mjs",
    import.meta.url,
  ),
);

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    {
      name: "emit-maplibre-worker",
      generateBundle() {
        for (const [fileName, filePath] of [
          ["assets/maplibre-gl-worker.mjs", maplibreWorkerPath],
          ["assets/maplibre-gl-shared.mjs", maplibreSharedPath],
        ]) {
          this.emitFile({
            type: "asset",
            fileName,
            source: readFileSync(filePath),
          });
        }
      },
    },
  ],
  optimizeDeps: {
    exclude: ["maplibre-gl"],
  },
  build: {
    chunkSizeWarningLimit: 2000,
  },
  server: {
    allowedHosts: true,
  },
});
