import type { APIRoute } from "astro";
import { generateRobotsTxt } from "seo-core";
import { SITE_URL } from "../config/site";

const AI_CRAWLERS: Record<string, "allow" | "deny"> = {
  GPTBot: "allow",
  ClaudeBot: "allow",
  "Claude-Web": "allow",
  PerplexityBot: "allow",
  "Google-Extended": "allow",
  CCBot: "deny",
};

export const GET: APIRoute = () => {
  return new Response(generateRobotsTxt({ siteUrl: SITE_URL, aiCrawlers: AI_CRAWLERS }), {
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
};
