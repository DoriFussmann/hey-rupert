import type { APIRoute } from "astro";
import { SITE_URL } from "../config/site";

export const GET: APIRoute = () => {
  const sitemap = `${SITE_URL.replace(/\/+$/, "")}/sitemap.xml`;
  const body = ["User-agent: *", "Allow: /", "", `Sitemap: ${sitemap}`, ""].join(
    "\n",
  );
  return new Response(body, {
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
};
