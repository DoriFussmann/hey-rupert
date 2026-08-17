import { SITE_URL } from "../../site/src/config/site.ts";
import { getArticle, listArticles, type ArticleRecord } from "./listContent.ts";
import {
  patchArticleLinks,
  todayIsoDate,
  type LinkItem,
} from "./patchArticle.ts";

export const MAX_EXTERNAL_LINKS = 3;
export const INTERNAL_SIGNPOST = "See Related below for more on this topic.";
export const EXTERNAL_SIGNPOST =
  "See Sources below for the references behind this article.";

export type HealthArticle = {
  slug: string;
  title: string;
  body: string;
  data: Record<string, unknown>;
  draft: boolean;
  pillarKeyword: string;
  supportingKeyword: string;
  articleType: string;
  targetKeyword: string;
  internalLinks: LinkItem[];
  externalLinks: LinkItem[];
  publishedUrl: string | null;
  faqs: unknown[];
};

function asString(value: unknown): string {
  if (value == null) return "";
  return String(value).trim();
}

function asLinks(value: unknown): LinkItem[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      const row = item as { label?: unknown; url?: unknown };
      return { label: asString(row.label), url: asString(row.url) };
    })
    .filter((link) => link.url);
}

export function publishedUrlFor(slug: string, draft: boolean): string | null {
  if (draft) return null;
  const origin = SITE_URL.replace(/\/+$/, "");
  return `${origin}/articles/${slug}/`;
}

export function articlePath(slug: string): string {
  return `/articles/${slug}/`;
}

export function normalizeLinkUrl(url: string): string {
  const raw = asString(url);
  try {
    if (/^https?:\/\//i.test(raw)) {
      const parsed = new URL(raw);
      return parsed.pathname.replace(/\/+$/, "") || "/";
    }
  } catch {
    // keep relative
  }
  return raw.replace(/\/+$/, "") || "/";
}

export function urlsMatch(a: string, b: string): boolean {
  return normalizeLinkUrl(a) === normalizeLinkUrl(b);
}

export function hasLinkTo(links: LinkItem[], slug: string): boolean {
  const target = articlePath(slug);
  const absolute = `${SITE_URL.replace(/\/+$/, "")}${target}`;
  return links.some(
    (link) => urlsMatch(link.url, target) || urlsMatch(link.url, absolute),
  );
}

export function toHealthArticle(article: ArticleRecord): HealthArticle {
  const draft = Boolean(article.data.draft);
  return {
    slug: article.slug,
    title: asString(article.data.title) || article.slug,
    body: article.body,
    data: article.data,
    draft,
    pillarKeyword: asString(article.data.pillarKeyword),
    supportingKeyword: asString(article.data.supportingKeyword),
    articleType: asString(article.data.articleType),
    targetKeyword: asString(article.data.targetKeyword),
    internalLinks: asLinks(article.data.internalLinks),
    externalLinks: asLinks(article.data.externalLinks),
    publishedUrl: publishedUrlFor(article.slug, draft),
    faqs: Array.isArray(article.data.faqs) ? article.data.faqs : [],
  };
}

export async function listHealthArticles(): Promise<HealthArticle[]> {
  const articles = await listArticles();
  return articles.map(toHealthArticle);
}

export async function listPublishedArticles(): Promise<HealthArticle[]> {
  const articles = await listHealthArticles();
  return articles.filter((article) => !article.draft);
}

export function isPillar(article: HealthArticle): boolean {
  return article.articleType === "comprehensive" && !article.supportingKeyword;
}

export function requiredInternalTargets(
  article: HealthArticle,
  published: HealthArticle[],
): HealthArticle[] {
  const targets: HealthArticle[] = [];
  const seen = new Set<string>();
  const add = (target: HealthArticle | undefined) => {
    if (!target || target.slug === article.slug || seen.has(target.slug)) return;
    seen.add(target.slug);
    targets.push(target);
  };

  if (isPillar(article)) {
    const clusters = new Map<string, HealthArticle[]>();
    for (const other of published) {
      if (other.slug === article.slug) continue;
      if (other.pillarKeyword !== article.pillarKeyword) continue;
      if (!other.supportingKeyword) continue;
      const list = clusters.get(other.supportingKeyword) ?? [];
      list.push(other);
      clusters.set(other.supportingKeyword, list);
    }
    for (const members of clusters.values()) {
      add(members.find((member) => member.articleType === "comprehensive"));
    }
    return targets;
  }

  if (article.supportingKeyword) {
    add(
      published.find(
        (other) =>
          other.pillarKeyword === article.pillarKeyword && isPillar(other),
      ),
    );
    for (const other of published) {
      if (other.supportingKeyword === article.supportingKeyword) add(other);
    }
  }

  return targets;
}

export function missingInternalTargets(
  article: HealthArticle,
  published: HealthArticle[],
): HealthArticle[] {
  return requiredInternalTargets(article, published).filter(
    (target) => !hasLinkTo(article.internalLinks, target.slug),
  );
}

export function linksStatus(
  article: HealthArticle,
  published: HealthArticle[],
): "green" | "orange" | "red" {
  const required = requiredInternalTargets(article, published);
  const missing = required.filter(
    (target) => !hasLinkTo(article.internalLinks, target.slug),
  );
  const externalCount = article.externalLinks.length;
  if (missing.length > 0 || externalCount <= 1) return "red";
  if (externalCount >= 3 && missing.length === 0) return "green";
  return "orange";
}

export function mergeExternalLinks(
  existing: LinkItem[],
  incoming: LinkItem[],
): LinkItem[] {
  const next = [...existing];
  const seen = new Set(next.map((link) => normalizeLinkUrl(link.url)));
  for (const link of incoming) {
    const label = asString(link.label);
    const url = asString(link.url);
    if (!label || !url) continue;
    const key = normalizeLinkUrl(url);
    if (seen.has(key)) continue;
    seen.add(key);
    next.push({ label, url });
  }
  while (next.length > MAX_EXTERNAL_LINKS) next.shift();
  return next;
}

export async function connectInternalLinks(
  slug: string,
  targetSlugs: string[],
): Promise<{ added: LinkItem[]; internalLinks: LinkItem[] }> {
  const [articleRecord, published] = await Promise.all([
    getArticle(slug),
    listPublishedArticles(),
  ]);
  if (!articleRecord) {
    throw Object.assign(new Error(`Article "${slug}" not found`), { status: 404 });
  }
  const article = toHealthArticle(articleRecord);
  if (article.draft) {
    throw Object.assign(new Error("Only published articles can be linked"), {
      status: 400,
    });
  }

  const allowed = new Set(published.map((item) => item.slug));
  const bySlug = new Map(published.map((item) => [item.slug, item]));
  const added: LinkItem[] = [];
  const next = [...article.internalLinks];

  for (const targetSlug of targetSlugs) {
    if (!allowed.has(targetSlug) || targetSlug === slug) continue;
    if (hasLinkTo(next, targetSlug)) continue;
    const target = bySlug.get(targetSlug);
    if (!target) continue;
    const link = { label: target.title, url: articlePath(target.slug) };
    next.push(link);
    added.push(link);
  }

  if (added.length) {
    await patchArticleLinks(slug, {
      internalLinks: next,
      updatedDate: todayIsoDate(),
      signposts: [INTERNAL_SIGNPOST],
    });
  }

  return { added, internalLinks: next };
}

export async function connectMissingInternalLinks(slug: string) {
  const [articleRecord, published] = await Promise.all([
    getArticle(slug),
    listPublishedArticles(),
  ]);
  if (!articleRecord) {
    throw Object.assign(new Error(`Article "${slug}" not found`), { status: 404 });
  }
  const missing = missingInternalTargets(
    toHealthArticle(articleRecord),
    published,
  );
  return connectInternalLinks(
    slug,
    missing.map((item) => item.slug),
  );
}

export async function addExternalLinks(
  slug: string,
  incoming: LinkItem[],
): Promise<{ externalLinks: LinkItem[]; added: LinkItem[] }> {
  const articleRecord = await getArticle(slug);
  if (!articleRecord) {
    throw Object.assign(new Error(`Article "${slug}" not found`), { status: 404 });
  }
  const article = toHealthArticle(articleRecord);
  const before = article.externalLinks.map((link) => normalizeLinkUrl(link.url));
  const next = mergeExternalLinks(article.externalLinks, incoming);
  const added = next.filter((link) => !before.includes(normalizeLinkUrl(link.url)));

  if (added.length || next.length !== article.externalLinks.length) {
    await patchArticleLinks(slug, {
      externalLinks: next,
      updatedDate: todayIsoDate(),
      signposts: added.length ? [EXTERNAL_SIGNPOST] : [],
    });
  }

  return { externalLinks: next, added };
}
