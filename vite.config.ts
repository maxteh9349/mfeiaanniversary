import { defineConfig, type Plugin } from "vite";
import { resolve } from "node:path";

// Friendly paths (/checkin, /screen, …) are rewritten to the MPA's HTML entries.
// In production this is done by assets/_redirects (Cloudflare) or vercel.json; the
// Vite dev server doesn't read those, so mirror the same rewrites here — otherwise
// the check-in QR (which encodes `${origin}/checkin`) 404s during local testing.
const FRIENDLY_ROUTES: Record<string, string> = {
  "/": "/apps/checkin/index.html",
  "/checkin": "/apps/checkin/index.html",
  "/screen": "/apps/screen/index.html",
  "/admin": "/apps/admin/index.html",
  "/preview": "/apps/preview/index.html",
};
function friendlyRoutesDev(): Plugin {
  return {
    name: "mfeia-friendly-routes-dev",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use((req, _res, next) => {
        const [path, query] = (req.url ?? "").split("?");
        const clean = path.replace(/\/+$/, "") || "/";
        const target = FRIENDLY_ROUTES[clean];
        if (target) req.url = query ? `${target}?${query}` : target;
        next();
      });
    },
  };
}

// Multi-page app: each guest-facing surface is its own HTML entry.
//  - /screen  big-screen 3D digital lobby
//  - /checkin mobile self check-in
//  - /admin   operator console
export default defineConfig({
  appType: "mpa",
  publicDir: "assets",
  plugins: [friendlyRoutesDev()],
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
