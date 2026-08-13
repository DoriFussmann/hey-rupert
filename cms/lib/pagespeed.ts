import fs from "node:fs/promises";
import path from "node:path";
import { CMS_ROOT } from "./paths.ts";
import { pagespeedConfigured } from "./env.ts";

const ENDPOINT = "https://www.googleapis.com/pagespeedonline/v5/runPagespeed";
const CACHE_PATH = path.join(CMS_ROOT, "data", "pagespeed-cache.json");

export type PagespeedScores = {
  performance: number | null;
  accessibility: number | null;
  bestPractices: number | null;
  seo: number | null;
};

export type PagespeedResult = {
  ok: boolean;
  strategy: "mobile" | "desktop";
  scores?: PagespeedScores;
  error?: string;
  finalUrl?: string;
};

export type PagespeedCacheEntry = {
  scannedAt: string;
  url: string;
  mobile: PagespeedResult;
  desktop: PagespeedResult;
};

type CacheFile = Record<string, PagespeedCacheEntry>;

function scoreTo100(raw: unknown): number | null {
  if (typeof raw !== "number" || Number.isNaN(raw)) return null;
  return Math.round(raw * 100);
}

export function scoreColor(score: number | null): "green" | "orange" | "red" | "gray" {
  if (score == null) return "gray";
  if (score >= 90) return "green";
  if (score >= 50) return "orange";
  return "red";
}

async function readCache(): Promise<CacheFile> {
  try {
    const raw = await fs.readFile(CACHE_PATH, "utf8");
    const parsed = JSON.parse(raw) as CacheFile;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

async function writeCache(cache: CacheFile): Promise<void> {
  await fs.mkdir(path.dirname(CACHE_PATH), { recursive: true });
  await fs.writeFile(CACHE_PATH, `${JSON.stringify(cache, null, 2)}\n`, "utf8");
}

export async function getPagespeedCache(): Promise<CacheFile> {
  return readCache();
}

async function runStrategy(
  url: string,
  strategy: "mobile" | "desktop",
  apiKey: string,
): Promise<PagespeedResult> {
  const params = new URLSearchParams({ url, strategy, key: apiKey });
  for (const category of ["performance", "accessibility", "best-practices", "seo"]) {
    params.append("category", category);
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 90000);
  try {
    const res = await fetch(`${ENDPOINT}?${params.toString()}`, {
      method: "GET",
      headers: { Accept: "application/json" },
      signal: controller.signal,
    });
    const data = (await res.json().catch(() => ({}))) as {
      error?: { message?: string };
      lighthouseResult?: {
        categories?: Record<string, { score?: number }>;
        finalUrl?: string;
      };
      id?: string;
    };
    if (!res.ok) {
      return {
        ok: false,
        strategy,
        error: data.error?.message || `PageSpeed API error (${res.status})`,
      };
    }
    const categories = data.lighthouseResult?.categories || {};
    return {
      ok: true,
      strategy,
      scores: {
        performance: scoreTo100(categories.performance?.score),
        accessibility: scoreTo100(categories.accessibility?.score),
        bestPractices: scoreTo100(categories["best-practices"]?.score),
        seo: scoreTo100(categories.seo?.score),
      },
      finalUrl: data.lighthouseResult?.finalUrl || data.id || url,
    };
  } catch (error) {
    const err = error as { name?: string; message?: string };
    return {
      ok: false,
      strategy,
      error:
        err.name === "AbortError"
          ? "PageSpeed request timed out"
          : err.message || "PageSpeed request failed",
    };
  } finally {
    clearTimeout(timer);
  }
}

export async function scanPagespeed(
  slug: string,
  url: string,
): Promise<PagespeedCacheEntry> {
  if (!pagespeedConfigured()) {
    throw Object.assign(new Error("GOOGLE_PAGESPEED_API_KEY is not configured"), {
      status: 400,
    });
  }
  const apiKey = process.env.GOOGLE_PAGESPEED_API_KEY || "";
  const mobile = await runStrategy(url, "mobile", apiKey);
  const desktop = await runStrategy(url, "desktop", apiKey);
  const entry: PagespeedCacheEntry = {
    scannedAt: new Date().toISOString(),
    url,
    mobile,
    desktop,
  };
  const cache = await readCache();
  cache[slug] = entry;
  await writeCache(cache);
  return entry;
}
