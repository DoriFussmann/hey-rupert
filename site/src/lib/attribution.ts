/**
 * Lead source: where a visitor came from, kept in the browser so the booking
 * page can hand it to Cal.com with the booking.
 *
 * Two touches are kept: the first one ever seen (expires after 90 days) and the
 * latest one that came from outside the site. Only the referring site, UTM
 * tags, the landing path and a timestamp are stored. Nothing personal.
 */

export type Touch = {
  /** Short name: "chatgpt", "google", "linkedin", a domain, or "direct". */
  source: string;
  /** "ai", "search", "social", "email", "paid", "campaign", "referral" or "none". */
  medium: string;
  /** Referring host, or "" when there was none. */
  referrer: string;
  /** Path the visitor landed on. */
  landing: string;
  /** ISO time of the visit. */
  at: string;
  /** UTM tags present on the landing URL. */
  utm: Record<string, string>;
};

export type Attribution = { first: Touch; last: Touch };

export const UTM_KEYS = ["utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content"] as const;

const STORAGE_KEY = "rupert_lead_source";
const FIRST_TOUCH_DAYS = 90;
const MAX_VALUE = 200;

// Host suffix -> [source, medium]. First match wins, so specific hosts go first.
const KNOWN: [string, string, string][] = [
  ["chatgpt.com", "chatgpt", "ai"],
  ["chat.openai.com", "chatgpt", "ai"],
  ["openai.com", "chatgpt", "ai"],
  ["perplexity.ai", "perplexity", "ai"],
  ["claude.ai", "claude", "ai"],
  ["gemini.google.com", "gemini", "ai"],
  ["copilot.microsoft.com", "copilot", "ai"],
  ["copilot.com", "copilot", "ai"],
  ["you.com", "you.com", "ai"],
  ["phind.com", "phind", "ai"],
  ["meta.ai", "meta-ai", "ai"],
  ["grok.com", "grok", "ai"],
  ["mail.google.com", "gmail", "email"],
  ["outlook.live.com", "outlook", "email"],
  ["outlook.office.com", "outlook", "email"],
  ["bing.com", "bing", "search"],
  ["duckduckgo.com", "duckduckgo", "search"],
  ["search.yahoo.com", "yahoo", "search"],
  ["search.brave.com", "brave", "search"],
  ["ecosia.org", "ecosia", "search"],
  ["linkedin.com", "linkedin", "social"],
  ["lnkd.in", "linkedin", "social"],
  ["twitter.com", "x", "social"],
  ["x.com", "x", "social"],
  ["t.co", "x", "social"],
  ["facebook.com", "facebook", "social"],
  ["instagram.com", "instagram", "social"],
  ["reddit.com", "reddit", "social"],
  ["youtube.com", "youtube", "social"],
  ["news.ycombinator.com", "hacker-news", "social"],
];

// Paid click identifiers -> source.
const CLICK_IDS: [string, string][] = [
  ["gclid", "google"],
  ["gbraid", "google"],
  ["wbraid", "google"],
  ["msclkid", "bing"],
  ["li_fat_id", "linkedin"],
  ["fbclid", "facebook"],
  ["twclid", "x"],
];

const clip = (value: string) => value.trim().slice(0, MAX_VALUE);

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return "";
  }
}

const matches = (host: string, suffix: string) => host === suffix || host.endsWith(`.${suffix}`);

/** Name a visit from its referrer and landing URL. `siteHost` is this site, so internal clicks read as no referrer. */
export function classifyTouch(referrerUrl: string, landingUrl: string, siteHost: string, now: Date = new Date()): Touch {
  let params = new URLSearchParams();
  let landing = "/";
  try {
    const url = new URL(landingUrl);
    params = url.searchParams;
    landing = url.pathname;
  } catch {
    // keep defaults
  }

  const utm: Record<string, string> = {};
  for (const key of UTM_KEYS) {
    const value = clip(params.get(key) ?? "");
    if (value) utm[key] = value;
  }

  const own = siteHost.toLowerCase().replace(/^www\./, "");
  let referrer = hostOf(referrerUrl);
  if (referrer && (referrer === own || referrer.endsWith(`.${own}`))) referrer = "";

  const base = { referrer, landing: clip(landing), at: now.toISOString(), utm };

  if (utm.utm_source) {
    // ChatGPT and other assistants tag their links (utm_source=chatgpt.com).
    const known = KNOWN.find(([suffix]) => matches(utm.utm_source.toLowerCase(), suffix));
    return { ...base, source: known ? known[1] : utm.utm_source.toLowerCase(), medium: utm.utm_medium?.toLowerCase() || (known ? known[2] : "campaign") };
  }
  const clickId = CLICK_IDS.find(([key]) => params.has(key));
  // fbclid is added to unpaid Facebook links too, so it names the source but not the medium.
  if (clickId) return { ...base, source: clickId[1], medium: clickId[0] === "fbclid" ? "social" : "paid" };
  if (!referrer) return { ...base, source: "direct", medium: "none" };

  const known = KNOWN.find(([suffix]) => matches(referrer, suffix));
  if (known) return { ...base, source: known[1], medium: known[2] };
  if (/(^|\.)google\.[a-z.]+$/.test(referrer)) return { ...base, source: "google", medium: "search" };
  return { ...base, source: referrer, medium: "referral" };
}

function isTouch(value: unknown): value is Touch {
  if (!value || typeof value !== "object") return false;
  const t = value as Record<string, unknown>;
  return typeof t.source === "string" && typeof t.medium === "string" && typeof t.at === "string";
}

/** Fold a new visit into what is already stored. Pure, so it can be tested. */
export function mergeTouch(stored: Attribution | null, touch: Touch): Attribution {
  const now = Date.parse(touch.at);
  const firstAlive = stored && now - Date.parse(stored.first.at) < FIRST_TOUCH_DAYS * 86_400_000;
  if (!stored || !firstAlive) return { first: touch, last: touch };
  // A direct visit (typed address, internal click, reload) never replaces a named source.
  if (touch.source === "direct") return stored;
  // The same visit seen again (reload, or two scripts on one page) changes nothing.
  const l = stored.last;
  if (l.source === touch.source && l.medium === touch.medium && l.referrer === touch.referrer && l.landing === touch.landing && JSON.stringify(l.utm) === JSON.stringify(touch.utm)) return stored;
  return { first: stored.first, last: touch };
}

export function readAttribution(): Attribution | null {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<Attribution>;
    return isTouch(parsed.first) && isTouch(parsed.last) ? { first: parsed.first, last: parsed.last } : null;
  } catch {
    return null;
  }
}

/** Record this page view. Safe to call on every page; storage errors are ignored. */
export function recordVisit(): Attribution {
  const touch = classifyTouch(document.referrer, window.location.href, window.location.hostname);
  const merged = mergeTouch(readAttribution(), touch);
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(merged));
  } catch {
    // Private mode or storage disabled: this page view still gets its own touch.
  }
  return merged;
}

/**
 * Query parameters for the Cal.com booking page. `utm_*` feed Cal.com's own UTM
 * tracking; `metadata[...]` arrives in the booking webhook as payload.metadata.
 */
export function bookingParams(a: Attribution): Record<string, string> {
  const out: Record<string, string> = {};
  const set = (key: string, value: string | undefined) => {
    if (value) out[key] = clip(value);
  };
  // UTM tags of the latest named visit, else of the first one.
  const utm = Object.keys(a.last.utm).length ? a.last.utm : a.first.utm;
  for (const key of UTM_KEYS) {
    set(key, utm[key]);
    set(`metadata[${key}]`, utm[key]);
  }
  set("metadata[src]", a.last.source);
  set("metadata[src_medium]", a.last.medium);
  set("metadata[src_referrer]", a.last.referrer);
  set("metadata[src_landing]", a.last.landing);
  set("metadata[src_at]", a.last.at);
  if (a.first.at !== a.last.at) {
    set("metadata[first_src]", a.first.source);
    set("metadata[first_medium]", a.first.medium);
    set("metadata[first_referrer]", a.first.referrer);
    set("metadata[first_landing]", a.first.landing);
    set("metadata[first_at]", a.first.at);
  }
  return out;
}
