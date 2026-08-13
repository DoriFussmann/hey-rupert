import matter from "gray-matter";
import { parse as parseYaml } from "yaml";
import { getArticle, listArticles } from "./listContent.ts";
import {
  addExternalLinks,
  type HealthArticle,
  toHealthArticle,
} from "./articleLinks.ts";
import {
  extractWhereThingsStand,
  patchArticleLinks,
  type LinkItem,
} from "./patchArticle.ts";

export type UpdateSource = { title?: string; label?: string; url: string };

export type UpdateEntry = {
  slug: string;
  newParagraph: string;
  newUpdatedDate: string;
  newSources: UpdateSource[];
};

export type MatchedUpdate = {
  slug: string;
  title: string;
  currentParagraph: string | null;
  newParagraph: string;
  newUpdatedDate: string;
  newSources: UpdateSource[];
  markerError?: string;
};

function asString(value: unknown): string {
  if (value == null) return "";
  return String(value).trim();
}

function asSources(value: unknown): UpdateSource[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      const row = item as { title?: unknown; label?: unknown; url?: unknown };
      return {
        title: asString(row.title) || undefined,
        label: asString(row.label) || undefined,
        url: asString(row.url),
      };
    })
    .filter((item) => item.url);
}

function normalizeEntry(raw: unknown): UpdateEntry | null {
  if (!raw || typeof raw !== "object") return null;
  const row = raw as Record<string, unknown>;
  const slug = asString(row.slug);
  if (!slug) return null;
  return {
    slug,
    newParagraph: asString(row.newParagraph || row.proposedParagraph),
    newUpdatedDate: asString(row.newUpdatedDate || row.updatedDate),
    newSources: asSources(row.newSources || row.sources),
  };
}

export function parseUpdatesFile(content: string, filename = ""): UpdateEntry[] {
  const raw = content.replace(/^\uFEFF/, "").trim();
  if (!raw) return [];

  const looksJson = raw.startsWith("[") || raw.startsWith("{");
  if (looksJson || /\.json$/i.test(filename)) {
    const parsed = JSON.parse(raw) as unknown;
    const rows = Array.isArray(parsed) ? parsed : [parsed];
    return rows.map(normalizeEntry).filter((row): row is UpdateEntry => Boolean(row));
  }

  if (raw.startsWith("---")) {
    const parsed = matter(raw);
    const fromFm = normalizeEntry({
      ...parsed.data,
      newParagraph:
        (parsed.data as { newParagraph?: unknown }).newParagraph || parsed.content,
    });
    return fromFm ? [fromFm] : [];
  }

  const yamlParsed = parseYaml(raw) as unknown;
  const rows = Array.isArray(yamlParsed) ? yamlParsed : [yamlParsed];
  return rows.map(normalizeEntry).filter((row): row is UpdateEntry => Boolean(row));
}

export async function previewUpdates(entries: UpdateEntry[]): Promise<{
  matched: MatchedUpdate[];
  unmatched: string[];
}> {
  const articles = await listArticles();
  const bySlug = new Map(articles.map((article) => [article.slug, article]));
  const matched: MatchedUpdate[] = [];
  const unmatched: string[] = [];
  const seen = new Set<string>();

  for (const entry of entries) {
    if (seen.has(entry.slug)) continue;
    seen.add(entry.slug);
    const article = bySlug.get(entry.slug);
    if (!article) {
      unmatched.push(entry.slug);
      continue;
    }
    const current = extractWhereThingsStand(article.body);
    matched.push({
      slug: entry.slug,
      title: asString(article.data.title) || entry.slug,
      currentParagraph: current,
      newParagraph: entry.newParagraph,
      newUpdatedDate: entry.newUpdatedDate,
      newSources: entry.newSources,
      markerError: current == null ? "WHERE-THINGS-STAND markers not found" : undefined,
    });
  }

  return { matched, unmatched };
}

export async function confirmUpdate(input: {
  slug: string;
  newParagraph: string;
  newUpdatedDate: string;
  sources?: LinkItem[];
}): Promise<{ slug: string; article: HealthArticle }> {
  const article = await getArticle(input.slug);
  if (!article) {
    throw Object.assign(new Error(`Article "${input.slug}" not found`), {
      status: 404,
    });
  }
  if (!extractWhereThingsStand(article.body)) {
    throw Object.assign(
      new Error(`Article "${input.slug}" is missing WHERE-THINGS-STAND markers`),
      { status: 400 },
    );
  }
  if (!input.newParagraph.trim()) {
    throw Object.assign(new Error("newParagraph is required"), { status: 400 });
  }
  if (!input.newUpdatedDate.trim()) {
    throw Object.assign(new Error("newUpdatedDate is required"), { status: 400 });
  }

  await patchArticleLinks(input.slug, {
    whereThingsStand: input.newParagraph,
    updatedDate: input.newUpdatedDate,
  });

  if (input.sources?.length) {
    await addExternalLinks(input.slug, input.sources);
  }

  const next = await getArticle(input.slug);
  if (!next) {
    throw Object.assign(new Error(`Article "${input.slug}" missing after update`), {
      status: 500,
    });
  }
  return { slug: input.slug, article: toHealthArticle(next) };
}
