// AI-crawler tracking (Vercel Routing Middleware). All logic lives in
// seo-core/middleware; this file only switches it on, because Vercel reads
// middleware from the project root. Needs seo-core >= 1.4.1 (1.4.0 crashed).
// Visitors are untouched. Inert until TNV_BOT_TOKEN is set on this Vercel project.
import { createBotMiddleware } from "seo-core/middleware";

export const config = {
  matcher: ["/((?!_astro/|_vercel/|favicon).*)"],
  runtime: "nodejs",
};

export default createBotMiddleware({
  endpoint: "https://thenightventures.com/api/audit-snapshot?action=analytics.ingest",
});
