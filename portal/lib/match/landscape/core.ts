// Step 2: Competitive Landscape Enrichment. Pure module: the competitor
// record, cleaning what the AI or the admin sends, and the relevance order.

export const MAX_COMPETITORS = 10;

export type LinkState = "live" | "broken" | "unchecked";

export type Competitor = {
  id: string;
  name: string;
  website: string;
  oneLiner: string;
  /** HQ city and country, as found. */
  hq: string;
  /** "client": the founder named it. "web": found by the search. */
  source: "client" | "web";
  /** Why it is a direct competitor, in one or two sentences. */
  why: string;
  funding: { totalRaised: string; lastRound: string; lastRoundDate: string; investors: string[] };
  newsUrl: string;
  newsTitle: string;
  links: { website: LinkState; news: LinkState };
};

const text = (value: unknown, max: number) => (typeof value === "string" ? value.trim().slice(0, max) : "");

/** A web address with a scheme, or "" when it isn't one. */
export function cleanUrl(value: unknown): string {
  let raw = text(value, 500);
  if (!raw) return "";
  if (!/^https?:\/\//i.test(raw)) raw = `https://${raw}`;
  try {
    const url = new URL(raw);
    if (!["http:", "https:"].includes(url.protocol) || !url.hostname.includes(".")) return "";
    return url.toString();
  } catch {
    return "";
  }
}

const LINK_STATES: LinkState[] = ["live", "broken", "unchecked"];

/** Cleans one competitor; null when it has no name. */
export function cleanCompetitor(value: unknown, fallbackId: string): Competitor | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Record<string, unknown>;
  const name = text(v.name, 120);
  if (!name) return null;
  const funding = (v.funding && typeof v.funding === "object" ? v.funding : {}) as Record<string, unknown>;
  const links = (v.links && typeof v.links === "object" ? v.links : {}) as Record<string, unknown>;
  const state = (s: unknown): LinkState => (LINK_STATES.includes(s as LinkState) ? (s as LinkState) : "unchecked");
  return {
    id: text(v.id, 64) || fallbackId,
    name,
    website: cleanUrl(v.website),
    oneLiner: text(v.oneLiner, 300),
    hq: text(v.hq, 120),
    source: v.source === "client" ? "client" : "web",
    why: text(v.why, 600),
    funding: {
      totalRaised: text(funding.totalRaised, 60),
      lastRound: text(funding.lastRound, 80),
      lastRoundDate: text(funding.lastRoundDate, 40),
      investors: Array.isArray(funding.investors)
        ? Array.from(new Set(funding.investors.map((i) => text(i, 120)).filter(Boolean))).slice(0, 30)
        : [],
    },
    newsUrl: cleanUrl(v.newsUrl),
    newsTitle: text(v.newsTitle, 200),
    links: { website: state(links.website), news: state(links.news) },
  };
}

const key = (name: string) => name.toLowerCase().replace(/[^a-z0-9]/g, "");

/**
 * The list as saved: cleaned, one per name, client-named first (in the order
 * given), then the rest in the order given, at most 10.
 */
export function orderCompetitors(items: unknown[], makeId: (i: number) => string): Competitor[] {
  const seen = new Set<string>();
  const clean: Competitor[] = [];
  items.forEach((item, i) => {
    const c = cleanCompetitor(item, makeId(i));
    if (!c || seen.has(key(c.name))) return;
    seen.add(key(c.name));
    clean.push(c);
  });
  return [...clean.filter((c) => c.source === "client"), ...clean.filter((c) => c.source !== "client")].slice(0, MAX_COMPETITORS);
}

/** Whether a name is on a list, ignoring case, spaces and punctuation. */
export function sameName(a: string, b: string) {
  return key(a) === key(b) && key(a) !== "";
}

/** The names the founder gave, from free text: one per line or comma. "None" gives none. */
export function namesFromText(value: string): string[] {
  return value
    .split(/[\n,;]+/)
    .map((s) => s.replace(/^[-•*\d.)\s]+/, "").trim())
    .filter((s) => s && !/^(none|n\/a|no|nothing|-)\.?$/i.test(s))
    .slice(0, 20);
}
