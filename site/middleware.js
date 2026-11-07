// AI-crawler tracking (Vercel Routing Middleware) via seo-core.
// Reports ChatGPT/Claude/Perplexity/Google/Bing crawler hits to TNV Analytics.
// Visitors are untouched. Inert until TNV_BOT_TOKEN is set on this Vercel project.
import { createBotMiddleware } from "seo-core/middleware";

export const config = {
  matcher: ["/((?!_astro/|_vercel/|favicon).*)"],
  runtime: "nodejs",
};

export default createBotMiddleware({
  endpoint: "https://thenightventures.com/api/audit-snapshot?action=analytics.ingest",
});
