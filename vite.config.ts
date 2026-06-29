import { defineConfig } from "vite";
import { resolve } from "node:path";

// Multi-page app: each guest-facing surface is its own HTML entry.
//  - /screen  big-screen 3D digital lobby
//  - /checkin mobile self check-in
//  - /admin   operator console
export default defineConfig({
  appType: "mpa",
  publicDir: "assets",
  build: {
    outDir: "dist",
    emptyOutDir: true,
    rollupOptions: {
      input: {
        screen: resolve(__dirname, "apps/screen/index.html"),
        checkin: resolve(__dirname, "apps/checkin/index.html"),
        admin: resolve(__dirname, "apps/admin/index.html"),
        preview: resolve(__dirname, "apps/preview/index.html"),
      },
    },
  },
  server: {
    host: true, // expose on LAN for phone testing
    proxy: {
      "/api": "http://localhost:8080",
      "/ws": { target: "ws://localhost:8080", ws: true },
    },
  },
});
