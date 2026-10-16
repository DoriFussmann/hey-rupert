import type { APIRoute } from "astro";
import { generateRobotsTxt } from "seo-core";
import { SITE_URL } from "../config/site";

export const GET: APIRoute = () => {
  return new Response(generateRobotsTxt({ siteUrl: SITE_URL }), {
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
};
