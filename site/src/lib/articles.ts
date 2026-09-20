import { getCollection } from "astro:content";

function asDate(value: Date | string): Date {
  if (value instanceof Date) return value;
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return new Date(`${value}T00:00:00.000Z`);
  return new Date(value);
}

export async function getPublishedArticles() {
  const articles = await getCollection("articles");
  return articles
    .filter((article) => !article.data.draft)
    .map((article) => ({
      ...article,
      data: {
        ...article.data,
        date: asDate(article.data.date),
        updatedDate: article.data.updatedDate ? asDate(article.data.updatedDate) : undefined,
      },
    }))
    .sort((a, b) => b.data.date.valueOf() - a.data.date.valueOf());
}
