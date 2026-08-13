import fs from "node:fs/promises";
import path from "node:path";
import { SITE_URL } from "../../site/src/config/site.ts";
import { getTeamMember } from "./listContent.ts";
import { previewArticleJsonLd } from "./previewJsonLd.ts";
import { SITE_ROOT } from "./paths.ts";
import {
  linksStatus,
  missingInternalTargets,
  requiredInternalTargets,
  type HealthArticle,
} from "./articleLinks.ts";
import { scoreColor, type PagespeedCacheEntry } from "./pagespeed.ts";

export type Finding = { ok: boolean; message: string };
export type HealthStatus = "green" | "orange" | "red" | "gray";

export type CategoryReport = {
  status: HealthStatus;
  findings: Finding[];
};

function asString(value: unknown): string {
  if (value == null) return "";
  return String(value).trim();
}

function expectedCanonical(slug: string): string {
  return `${SITE_URL.replace(/\/+$/, "")}/articles/${slug}/`;
}

export function scanMeta(article: HealthArticle): CategoryReport {
  const findings: Finding[] = [];
  const title = asString(article.data.title);
  const description = asString(article.data.description);
  const titleOk = title.length >= 55 && title.length <= 60;
  const descOk = description.length >= 140 && description.length <= 160;
  findings.push({
    ok: titleOk,
    message: `title ${title.length} chars (needs 55–60)`,
  });
  findings.push({
    ok: descOk,
    message: `description ${description.length} chars (needs 140–160)`,
  });

  const expected = expectedCanonical(article.slug);
  const canonical = asString(article.data.canonical);
  if (!canonical) {
    findings.push({
      ok: true,
      message: `canonical not set; layout falls back to ${expected}`,
    });
  } else {
    const ok =
      canonical.replace(/\/+$/, "") === expected.replace(/\/+$/, "");
    findings.push({
      ok,
      message: ok ? "canonical present and correct" : `canonical mismatch: ${canonical}`,
    });
  }

  findings.push({
    ok: true,
    message: "og:title, og:description, og:url, og:type emitted by layout",
  });
  findings.push({
    ok: Boolean(article.data.image),
    message: article.data.image
      ? "og:image present (hero)"
      : "og:image missing (no hero image)",
  });

  const h1 = asString(article.data.h1);
  if (h1) {
    findings.push({
      ok: h1.length >= 20,
      message: `h1 set (${h1.length} chars)`,
    });
  } else {
    findings.push({
      ok: true,
      message: "h1 cleanly falls back to title",
    });
  }

  const failed = findings.filter((item) => !item.ok);
  let status: HealthStatus = "green";
  if (failed.length) status = titleOk && descOk ? "orange" : "red";
  return { status, findings };
}

function collectTypes(nodes: unknown[]): string[] {
  const types: string[] = [];
  const walk = (node: unknown) => {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) {
      node.forEach(walk);
      return;
    }
    const record = node as Record<string, unknown>;
    const type = record["@type"];
    if (typeof type === "string") types.push(type);
    else if (Array.isArray(type)) {
      for (const item of type) if (typeof item === "string") types.push(item);
    }
  };
  walk(nodes);
  return types;
}

function extractJsonLd(html: string): { nodes: unknown[]; parseErrors: number } {
  const nodes: unknown[] = [];
  let parseErrors = 0;
  const re = /<script type="application\/ld\+json">([\s\S]*?)<\/script>/gi;
  let match: RegExpExecArray | null;
  while ((match = re.exec(html))) {
    try {
      nodes.push(JSON.parse(match[1]));
    } catch {
      parseErrors += 1;
    }
  }
  return { nodes, parseErrors };
}

async function jsonLdForArticle(article: HealthArticle): Promise<{
  nodes: unknown[];
  parseErrors: number;
  source: "dist" | "preview";
}> {
  const distPath = path.join(
    SITE_ROOT,
    "dist",
    "articles",
    article.slug,
    "index.html",
  );
  try {
    const html = await fs.readFile(distPath, "utf8");
    const extracted = extractJsonLd(html);
    if (extracted.nodes.length || extracted.parseErrors) {
      return { ...extracted, source: "dist" };
    }
  } catch {
    // fall through to preview
  }

  const authorSlug = asString(article.data.author);
  const member = authorSlug ? await getTeamMember(authorSlug) : null;
  if (!member) {
    return { nodes: [], parseErrors: 0, source: "preview" };
  }
  const nodes = previewArticleJsonLd({
    title: article.title,
    description: asString(article.data.description),
    slug: article.slug,
    date: asString(article.data.date) || todayFallback(),
    updatedDate: asString(article.data.updatedDate) || undefined,
    schemaType: asString(article.data.schemaType) || undefined,
    locale: asString(article.data.locale) || undefined,
    faqs: Array.isArray(article.data.faqs)
      ? (article.data.faqs as { question: string; answer: string }[])
      : [],
    author: {
      name: asString(member.data.name) || member.slug,
      slug: member.slug,
      role: asString(member.data.role),
      bio: asString(member.data.bio),
      sameAs: Array.isArray(member.data.sameAs)
        ? (member.data.sameAs as string[])
        : [],
    },
  });
  return { nodes, parseErrors: 0, source: "preview" };
}

function todayFallback(): string {
  return new Date().toISOString().slice(0, 10);
}

export async function scanSchema(article: HealthArticle): Promise<CategoryReport> {
  const { nodes, parseErrors, source } = await jsonLdForArticle(article);
  const findings: Finding[] = [];
  if (!nodes.length && !parseErrors) {
    return {
      status: "red",
      findings: [{ ok: false, message: "No JSON-LD found" }],
    };
  }
  findings.push({
    ok: parseErrors === 0,
    message:
      parseErrors === 0
        ? `JSON-LD parses (${source})`
        : `${parseErrors} JSON-LD block(s) failed to parse`,
  });
  const types = collectTypes(nodes);
  const expected = ["Organization", "Person", asString(article.data.schemaType) || "BlogPosting", "BreadcrumbList"];
  if (article.faqs.length) expected.push("FAQPage");
  for (const type of expected) {
    findings.push({
      ok: types.includes(type),
      message: types.includes(type)
        ? `@type ${type} present`
        : `@type ${type} missing`,
    });
  }
  const failed = findings.filter((item) => !item.ok);
  let status: HealthStatus = "green";
  if (parseErrors || !nodes.length) status = "red";
  else if (failed.length) status = "orange";
  return { status, findings };
}

type SitemapUrl = { loc: string; lastmod: string | null };

function parseSitemapXml(xml: string): { urls: SitemapUrl[]; children: string[] } {
  const urls: SitemapUrl[] = [];
  const children: string[] = [];
  const urlBlocks = xml.match(/<url>[\s\S]*?<\/url>/g) || [];
  for (const block of urlBlocks) {
    const loc = block.match(/<loc>([^<]+)<\/loc>/)?.[1] ?? "";
    const lastmod = block.match(/<lastmod>([^<]*)<\/lastmod>/)?.[1] ?? null;
    if (loc) urls.push({ loc, lastmod: lastmod && lastmod !== "null" ? lastmod : null });
  }
  const mapBlocks = xml.match(/<sitemap>[\s\S]*?<\/sitemap>/g) || [];
  for (const block of mapBlocks) {
    const loc = block.match(/<loc>([^<]+)<\/loc>/)?.[1];
    if (loc) children.push(loc);
  }
  return { urls, children };
}

async function readLocalOrFetch(fileName: string, href: string): Promise<string> {
  const local = path.join(SITE_ROOT, "dist", fileName);
  try {
    return await fs.readFile(local, "utf8");
  } catch {
    const res = await fetch(href);
    if (!res.ok) throw new Error(`Failed to fetch ${href} (${res.status})`);
    return res.text();
  }
}

export async function loadSitemapUrls(): Promise<SitemapUrl[]> {
  const origin = SITE_URL.replace(/\/+$/, "");
  const indexXml = await readLocalOrFetch(
    "sitemap-index.xml",
    `${origin}/sitemap-index.xml`,
  );
  const index = parseSitemapXml(indexXml);
  const urls = [...index.urls];
  for (const child of index.children) {
    const fileName = child.split("/").pop() || "sitemap-0.xml";
    try {
      const xml = await readLocalOrFetch(fileName, child);
      urls.push(...parseSitemapXml(xml).urls);
    } catch {
      // skip unreadable child
    }
  }
  if (!urls.length && !index.children.length) {
    try {
      const xml = await readLocalOrFetch("sitemap-0.xml", `${origin}/sitemap-0.xml`);
      urls.push(...parseSitemapXml(xml).urls);
    } catch {
      // empty
    }
  }
  return urls;
}

export function scanSitemap(
  article: HealthArticle,
  urls: SitemapUrl[],
): CategoryReport {
  const expected = expectedCanonical(article.slug).replace(/\/+$/, "");
  const match = urls.find(
    (item) => item.loc.replace(/\/+$/, "") === expected,
  );
  if (!match) {
    return {
      status: "red",
      findings: [{ ok: false, message: "Article not present in sitemap" }],
    };
  }
  if (!match.lastmod) {
    return {
      status: "orange",
      findings: [
        { ok: true, message: "Present in sitemap" },
        { ok: false, message: "lastmod is missing or null" },
      ],
    };
  }
  return {
    status: "green",
    findings: [
      { ok: true, message: "Present in sitemap-index set" },
      { ok: true, message: `lastmod ${match.lastmod}` },
    ],
  };
}

export function linksReport(
  article: HealthArticle,
  published: HealthArticle[],
): CategoryReport & {
  required: { slug: string; title: string; url: string }[];
  missing: { slug: string; title: string; url: string }[];
  externalCount: number;
} {
  const required = requiredInternalTargets(article, published).map((item) => ({
    slug: item.slug,
    title: item.title,
    url: `/articles/${item.slug}/`,
  }));
  const missing = missingInternalTargets(article, published).map((item) => ({
    slug: item.slug,
    title: item.title,
    url: `/articles/${item.slug}/`,
  }));
  const externalCount = article.externalLinks.length;
  const findings: Finding[] = [
    {
      ok: missing.length === 0,
      message:
        missing.length === 0
          ? `All ${required.length} required internal link(s) present`
          : `Missing ${missing.length} required internal link(s)`,
    },
    {
      ok: externalCount >= 3,
      message: `${externalCount} external link(s) (need 3+)`,
    },
  ];
  return {
    status: linksStatus(article, published),
    findings,
    required,
    missing,
    externalCount,
  };
}

export function speedReport(
  entry: PagespeedCacheEntry | undefined,
  configured: boolean,
  publishedUrl: string | null,
): CategoryReport & {
  configured: boolean;
  scanned: boolean;
  mobile: PagespeedCacheEntry["mobile"] | null;
  desktop: PagespeedCacheEntry["desktop"] | null;
  scannedAt?: string;
} {
  if (!configured) {
    return {
      status: "gray",
      findings: [{ ok: false, message: "not configured" }],
      configured: false,
      scanned: false,
      mobile: null,
      desktop: null,
    };
  }
  if (!publishedUrl) {
    return {
      status: "gray",
      findings: [{ ok: false, message: "No published URL — Speed scan disabled" }],
      configured: true,
      scanned: false,
      mobile: null,
      desktop: null,
    };
  }
  if (!entry) {
    return {
      status: "gray",
      findings: [{ ok: true, message: "Not yet scanned" }],
      configured: true,
      scanned: false,
      mobile: null,
      desktop: null,
    };
  }
  const mobilePerf = entry.mobile.ok ? entry.mobile.scores?.performance ?? null : null;
  const status = scoreColor(mobilePerf);
  const findings: Finding[] = [];
  if (entry.mobile.ok && entry.mobile.scores) {
    findings.push({
      ok: (entry.mobile.scores.performance ?? 0) >= 50,
      message: `mobile Performance ${entry.mobile.scores.performance}`,
    });
  } else {
    findings.push({ ok: false, message: `mobile: ${entry.mobile.error || "failed"}` });
  }
  if (entry.desktop.ok && entry.desktop.scores) {
    findings.push({
      ok: (entry.desktop.scores.performance ?? 0) >= 50,
      message: `desktop Performance ${entry.desktop.scores.performance}`,
    });
  } else {
    findings.push({ ok: false, message: `desktop: ${entry.desktop.error || "failed"}` });
  }
  return {
    status,
    findings,
    configured: true,
    scanned: true,
    mobile: entry.mobile,
    desktop: entry.desktop,
    scannedAt: entry.scannedAt,
  };
}
