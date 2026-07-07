import { defineConfig, type Plugin } from "vite";
import { resolve } from "node:path";

// Friendly paths (/checkin, /screen, …) map to the MPA's per-app folders.
// In production assets/_redirects (Cloudflare) / vercel.json 200-rewrite these,
// which works because the built HTML references assets by absolute /assets/ URLs.
// The Vite dev HTML uses RELATIVE paths (./checkin.ts), so a same-URL rewrite of
// /checkin would resolve ./checkin.ts against "/" and 404. Redirect to the real
// folder (trailing slash) instead so relative assets resolve — the QR encodes
// `${origin}/checkin`, and this makes it open correctly during local testing.
const FRIENDLY_ROUTES: Record<string, string> = {
  "/": "/apps/checkin/",
  "/checkin": "/apps/checkin/",
  "/screen": "/apps/screen/",
  "/admin": "/apps/admin/",
  "/preview": "/apps/preview/",
};
function friendlyRoutesDev(): Plugin {
  return {
    name: "mfeia-friendly-routes-dev",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const [path, query] = (req.url ?? "").split("?");
        const clean = path.replace(/\/+$/, "") || "/";
        const target = FRIENDLY_ROUTES[clean];
        if (target) {
          res.writeHead(302, { Location: query ? `${target}?${query}` : target });
          res.end();
          return;
        }
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
