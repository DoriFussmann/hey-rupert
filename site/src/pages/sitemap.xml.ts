import type { APIRoute } from "astro";
import { getCollection } from "astro:content";
import { SITE_URL } from "../config/site";
import { absoluteUrl } from "../lib/url";

const STATIC_PATHS = [
  "/",
  "/how-it-works/",
  "/database/",
  "/articles/",
  "/about/",
  "/book-call/",
];

function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function urlEntry(loc: string, lastmod?: string): string {
  const lastmodTag = lastmod ? `\n    <lastmod>${escapeXml(lastmod)}</lastmod>` : "";
  return `  <url>\n    <loc>${escapeXml(loc)}</loc>${lastmodTag}\n  </url>`;
}

export const GET: APIRoute = async () => {
  const articles = await getCollection(
    "articles",
    ({ data }) => data.draft !== true,
  );

  const urls = STATIC_PATHS.map((path) => urlEntry(absoluteUrl(path)));

  for (const article of articles) {
    const lastmodDate = article.data.updatedDate || article.data.date;
    const lastmod = lastmodDate.toISOString();
    urls.push(urlEntry(absoluteUrl(`/articles/${article.data.slug}/`), lastmod));
  }

  const body = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.join("\n")}
</urlset>
`;

  return new Response(body, {
    headers: {
      "Content-Type": "application/xml; charset=utf-8",
      "Cache-Control": "public, max-age=3600",
    },
  });
};

export const prerender = true;
