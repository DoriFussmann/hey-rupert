import fs from "node:fs/promises";
import path from "node:path";
import { CMS_ROOT, SITE_ROOT } from "./paths.ts";
import { searchConfigured } from "./env.ts";
import { MAX_EXTERNAL_LINKS, type HealthArticle } from "./articleLinks.ts";
import type { LinkItem } from "./patchArticle.ts";

export type LinkCandidate = LinkItem & {
  source: "whereThingsStandSources" | "body" | "local" | "live";
  confidence: "high" | "low";
  reason: string;
  description?: string;
};

const STOP = new Set([
  "the",
  "and",
  "for",
  "your",
  "you",
  "a",
  "an",
  "to",
  "of",
  "in",
  "on",
  "or",
  "vs",
  "how",
  "get",
  "with",
  "from",
]);

const LOCAL_SOURCE_GLOBS = [
  path.join(CMS_ROOT, "data"),
  path.join(SITE_ROOT, "src/content"),
];

export function keywordTokens(...phrases: string[]): string[] {
  const tokens = new Set<string>();
  for (const phrase of phrases) {
    for (const word of String(phrase || "")
      .toLowerCase()
      .split(/[^a-z0-9]+/)) {
      if (word.length >= 3 && !STOP.has(word)) tokens.add(word);
    }
  }
  return [...tokens];
}

export function isOnTopic(
  candidate: { title?: string; url?: string; description?: string; label?: string },
  targetKeyword: string,
  pillarKeyword: string,
): boolean {
  const hay = [
    candidate.title,
    candidate.label,
    candidate.url,
    candidate.description,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  const targetTokens = keywordTokens(targetKeyword);
  const pillarTokens = keywordTokens(pillarKeyword);
  const required = targetTokens.length ? targetTokens : pillarTokens;
  if (!required.length) return false;
  return required.some((token) => hay.includes(token));
}

function confidenceFor(
  candidate: { title?: string; label?: string; url?: string },
  targetKeyword: string,
  source: LinkCandidate["source"],
): "high" | "low" {
  if (source === "whereThingsStandSources") return "high";
  const title = `${candidate.title || ""} ${candidate.label || ""}`.toLowerCase();
  if (targetKeyword && title.includes(targetKeyword.toLowerCase())) return "high";
  const tokens = keywordTokens(targetKeyword);
  const hits = tokens.filter((token) => title.includes(token)).length;
  return hits >= 2 ? "high" : "low";
}

function fromUnknownSource(
  item: unknown,
  source: LinkCandidate["source"],
  article: HealthArticle,
): LinkCandidate | null {
  if (!item || typeof item !== "object") return null;
  const row = item as {
    label?: unknown;
    title?: unknown;
    note?: unknown;
    url?: unknown;
    href?: unknown;
    description?: unknown;
  };
  const url = String(row.url || row.href || "").trim();
  const label = String(row.label || row.title || row.note || url).trim();
  if (!url || !/^https?:\/\//i.test(url)) return null;
  const description = String(row.description || row.note || "");
  if (!isOnTopic({ title: label, url, description }, article.targetKeyword, article.pillarKeyword)) {
    return null;
  }
  return {
    label,
    url,
    source,
    description,
    confidence: confidenceFor({ title: label, url }, article.targetKeyword, source),
    reason: `Matched ${article.targetKeyword || article.pillarKeyword} via ${source}`,
  };
}

function extractBodyLinks(body: string, article: HealthArticle): LinkCandidate[] {
  const found: LinkCandidate[] = [];
  const md = /\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/gi;
  let match: RegExpExecArray | null;
  while ((match = md.exec(body))) {
    const candidate = fromUnknownSource(
      { label: match[1], url: match[2] },
      "body",
      article,
    );
    if (candidate) found.push(candidate);
  }
  const bare = /\bhttps?:\/\/[^\s)<>"']+/gi;
  while ((match = bare.exec(body))) {
    const url = match[0].replace(/[.,;:]+$/, "");
    if (found.some((item) => item.url === url)) continue;
    const candidate = fromUnknownSource({ label: url, url }, "body", article);
    if (candidate) found.push(candidate);
  }
  return found;
}

function extractWhereThingsStandSources(article: HealthArticle): LinkCandidate[] {
  const raw = article.data.whereThingsStandSources;
  if (!Array.isArray(raw)) return [];
  return raw
    .map((item) => fromUnknownSource(item, "whereThingsStandSources", article))
    .filter((item): item is LinkCandidate => Boolean(item));
}

async function listFilesRecursive(dir: string): Promise<string[]> {
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    const files: string[] = [];
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        files.push(...(await listFilesRecursive(full)));
      } else if (/\.(json|md|ya?ml)$/i.test(entry.name) && /source/i.test(entry.name)) {
        files.push(full);
      }
    }
    return files;
  } catch {
    return [];
  }
}

async function extractLocalSources(article: HealthArticle): Promise<LinkCandidate[]> {
  const files: string[] = [];
  for (const dir of LOCAL_SOURCE_GLOBS) {
    files.push(...(await listFilesRecursive(dir)));
  }
  const found: LinkCandidate[] = [];
  for (const file of files) {
    let raw = "";
    try {
      raw = await fs.readFile(file, "utf8");
    } catch {
      continue;
    }
    if (file.endsWith(".json")) {
      try {
        const parsed = JSON.parse(raw);
        const rows = Array.isArray(parsed)
          ? parsed
          : Array.isArray(parsed?.sources)
            ? parsed.sources
            : [];
        for (const row of rows) {
          const candidate = fromUnknownSource(row, "local", article);
          if (candidate) found.push(candidate);
        }
      } catch {
        // ignore unreadable source files
      }
    } else {
      found.push(...extractBodyLinks(raw, { ...article, body: raw }));
    }
  }
  return found;
}

async function liveSearch(article: HealthArticle): Promise<{
  available: boolean;
  items: LinkCandidate[];
  reason?: string;
}> {
  if (!searchConfigured()) {
    return { available: false, items: [], reason: "Live search is not configured." };
  }
  const login = process.env.DATAFORSEO_LOGIN || "";
  const password = process.env.DATAFORSEO_PASSWORD || "";
  const query = `${article.targetKeyword} ${article.pillarKeyword} guide OR resource OR statistics`
    .replace(/\s+/g, " ")
    .trim();
  const auth = `Basic ${Buffer.from(`${login}:${password}`).toString("base64")}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30000);
  try {
    const res = await fetch("https://api.dataforseo.com/v3/serp/google/organic/live/regular", {
      method: "POST",
      headers: {
        Authorization: auth,
        "Content-Type": "application/json",
      },
      body: JSON.stringify([
        {
          keyword: query,
          location_code: 2840,
          language_code: "en",
          depth: 10,
        },
      ]),
      signal: controller.signal,
    });
    const data = (await res.json().catch(() => null)) as {
      status_code?: number;
      tasks?: Array<{
        status_code?: number;
        result?: Array<{ items?: Array<Record<string, unknown>> }>;
      }>;
    } | null;
    if (!res.ok || !data || data.status_code !== 20000) {
      return { available: false, items: [], reason: "DataForSEO search was unavailable." };
    }
    const task = data.tasks?.[0];
    if (!task || task.status_code !== 20000) {
      return { available: false, items: [], reason: "DataForSEO search was unavailable." };
    }
    const items = task.result?.[0]?.items ?? [];
    const found: LinkCandidate[] = [];
    for (const item of items) {
      if (item.type && item.type !== "organic") continue;
      const candidate = fromUnknownSource(
        {
          title: item.title,
          url: item.url,
          description: item.description,
        },
        "live",
        article,
      );
      if (candidate) found.push(candidate);
    }
    return { available: true, items: found };
  } catch (error) {
    const aborted = error instanceof Error && error.name === "AbortError";
    return {
      available: false,
      items: [],
      reason: aborted
        ? "Search timed out after 30 seconds."
        : "DataForSEO search was unavailable.",
    };
  } finally {
    clearTimeout(timer);
  }
}

function dedupe(candidates: LinkCandidate[], existing: HealthArticle["externalLinks"]): LinkCandidate[] {
  const seen = new Set(existing.map((link) => link.url.replace(/\/+$/, "").toLowerCase()));
  const out: LinkCandidate[] = [];
  for (const candidate of candidates) {
    const key = candidate.url.replace(/\/+$/, "").toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(candidate);
  }
  return out;
}

export async function proposeExternalLinks(article: HealthArticle): Promise<{
  candidates: LinkCandidate[];
  slotsRemaining: number;
  searchUsed: boolean;
  searchConfigured: boolean;
  sourceUsed: LinkCandidate["source"] | null;
  available: boolean;
  reason: string | null;
}> {
  const slotsRemaining = Math.max(0, MAX_EXTERNAL_LINKS - article.externalLinks.length);
  if (slotsRemaining === 0) {
    return {
      candidates: [],
      slotsRemaining,
      searchUsed: false,
      searchConfigured: searchConfigured(),
      sourceUsed: null,
      available: false,
      reason: `Already has ${MAX_EXTERNAL_LINKS} external links.`,
    };
  }

  const staged: Array<{ source: LinkCandidate["source"]; items: LinkCandidate[] }> = [
    { source: "whereThingsStandSources", items: extractWhereThingsStandSources(article) },
    { source: "body", items: extractBodyLinks(article.body, article) },
    { source: "local", items: await extractLocalSources(article) },
  ];

  for (const stage of staged) {
    const onTopic = dedupe(stage.items, article.externalLinks);
    if (onTopic.length) {
      return {
        candidates: onTopic.slice(0, slotsRemaining + 3),
        slotsRemaining,
        searchUsed: false,
        searchConfigured: searchConfigured(),
        sourceUsed: stage.source,
        available: true,
        reason: null,
      };
    }
  }

  const live = searchConfigured()
    ? await liveSearch(article)
    : { available: false, items: [], reason: "Live search is not configured." };
  const liveCandidates = live.available
    ? dedupe(live.items, article.externalLinks).slice(0, slotsRemaining + 3)
    : [];
  if (liveCandidates.length) {
    return {
      candidates: liveCandidates,
      slotsRemaining,
      searchUsed: true,
      searchConfigured: searchConfigured(),
      sourceUsed: "live",
      available: true,
      reason: null,
    };
  }

  return {
    candidates: [],
    slotsRemaining,
    searchUsed: searchConfigured(),
    searchConfigured: searchConfigured(),
    sourceUsed: null,
    available: false,
    reason: live.reason
      ? live.reason
      : searchConfigured()
        ? "No on-topic external candidates."
        : "No local candidates. Live search is not configured.",
  };
}
