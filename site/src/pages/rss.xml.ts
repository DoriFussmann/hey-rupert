import rss from "@astrojs/rss";
import { SITE_NAME, SITE_URL } from "../config/site";
import { getPublishedArticles } from "../lib/articles";
import { sitePath } from "../lib/url";

export async function GET() {
  const articles = await getPublishedArticles();
  return rss({
    title: SITE_NAME,
    description: `Writing from ${SITE_NAME} on founder-led fundraising and investor outreach.`,
    site: SITE_URL,
    items: articles.map((article) => ({
      title: article.data.title,
      description: article.data.description,
      pubDate: article.data.date,
      link: sitePath(`/articles/${article.data.slug}/`),
    })),
  });
}
