import type { APIContext } from "astro";
import { getCollection } from "astro:content";
import { generateRss } from "seo-core";
import { SITE_DESCRIPTION, SITE_NAME, SITE_URL } from "../config/site";

const ARTICLES_BASE = "articles";

export async function GET(context: APIContext) {
  const articles = (await getCollection("articles", ({ data }) => data.draft !== true)).sort(
    (a, b) => (b.data.updatedDate || b.data.date).localeCompare(a.data.updatedDate || a.data.date),
  );
  return generateRss({
    siteName: SITE_NAME,
    siteTagline: SITE_DESCRIPTION,
    siteUrl: SITE_URL,
    articlesBase: ARTICLES_BASE,
    site: context.site ?? SITE_URL,
    articles,
  });
}
