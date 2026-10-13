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
  const body = generateRobotsTxt({ siteUrl: SITE_URL, aiCrawlers: AI_CRAWLERS }).replace(
    /Sitemap:\s+\S+/,
    `Sitemap: ${SITE_URL.replace(/\/+$/, "")}/sitemap.xml`,
  );
  return new Response(body, {
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
};
