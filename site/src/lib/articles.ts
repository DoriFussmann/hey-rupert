import { getCollection } from "astro:content";

/** Kept for a future listing that paginates once the catalog exceeds ~30–40 articles. */
export const ARTICLE_PAGE_SIZE = 9;

export async function getPublishedArticles() {
  const articles = await getCollection("articles");
  return articles
    .filter((article) => !article.data.draft)
    .sort((a, b) => b.data.date.valueOf() - a.data.date.valueOf());
}

export function paginate<T>(items: T[], page: number, pageSize = ARTICLE_PAGE_SIZE) {
  const total = items.length;
  const lastPage = Math.max(1, Math.ceil(total / pageSize) || 1);
  const current = Math.min(Math.max(1, page), lastPage);
  const start = (current - 1) * pageSize;
  return {
    items: items.slice(start, start + pageSize),
    current,
    lastPage,
    total,
    size: pageSize,
  };
}
