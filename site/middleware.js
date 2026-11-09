// AI-crawler tracking (Vercel Routing Middleware). All logic lives in
// seo-core/middleware; this file only switches it on, because Vercel reads
// middleware from the project root. Needs seo-core >= 1.4.1 (1.4.0 crashed).
// Visitors are untouched. Inert until TNV_BOT_TOKEN is set on this Vercel project.
import { createBotMiddleware } from "seo-core/middleware";

export const config = {
  matcher: ["/((?!_astro/|_vercel/|favicon).*)"],
  runtime: "nodejs",
};

// Paths proxied to the portal app (vercel.json rewrites). The portal sets its
// own headers and redirects, so the site middleware leaves these alone.
const PORTAL_PATHS = ["/api", "/portal", "/admin", "/auth", "/login", "/_next"];

export default createBotMiddleware({
  endpoint: "https://thenightventures.com/api/audit-snapshot?action=analytics.ingest",
  // 308 /page -> /page/ and /x/index.html -> /x/ (seo-core >= 1.6.0).
  trailingSlash: { exclude: PORTAL_PATHS },
  // nosniff, Referrer-Policy, X-Frame-Options, Permissions-Policy on site
  // pages (seo-core >= 1.7.0; ignored by older versions).
  securityHeaders: { exclude: PORTAL_PATHS },
});
