import "server-only";

// Minimal Hunter.io client: Email Verifier and Email Finder (API v2).
// Docs: https://hunter.io/api-documentation/v2
const BASE = "https://api.hunter.io/v2";
const TIMEOUT_MS = 30_000;
// A 202 means Hunter is still checking: the same request is polled.
const MAX_POLLS = 2;

export type MailboxStatus =
  | "valid"
  | "invalid"
  | "accept_all"
  | "webmail"
  | "disposable"
  | "unknown";

export type HunterResult<T> = { ok: true; value: T } | { ok: false; reason: string };

export function isHunterConfigured() {
  return Boolean(process.env.HUNTER_API_KEY);
}

const MAILBOX_STATUSES = new Set<MailboxStatus>([
  "valid",
  "invalid",
  "accept_all",
  "webmail",
  "disposable",
  "unknown",
]);

function errorReason(status: number) {
  if (status === 401) return "Hunter rejected the API key.";
  if (status === 403) return "Hunter rate limit reached. Try again shortly.";
  if (status === 429) return "Hunter usage limit reached for this plan.";
  if (status === 451) return "This person asked Hunter not to process their data.";
  if (status === 400) return "Hunter could not read this request.";
  return `Hunter error (${status}).`;
}

async function get(path: string, params: Record<string, string>) {
  const apiKey = process.env.HUNTER_API_KEY;
  if (!apiKey) return { ok: false as const, status: 0, reason: "HUNTER_API_KEY is not configured." };
  const url = `${BASE}/${path}?${new URLSearchParams(params).toString()}`;
  try {
    const response = await fetch(url, {
      headers: { "X-API-KEY": apiKey },
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: "no-store",
    });
    if (response.status === 200 || response.status === 202 || response.status === 222) {
      const body = (await response.json().catch(() => null)) as { data?: unknown } | null;
      return { ok: true as const, status: response.status, data: body?.data };
    }
    return { ok: false as const, status: response.status, reason: errorReason(response.status) };
  } catch (err) {
    return {
      ok: false as const,
      status: 0,
      reason: `Hunter request failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

/** Whether a mailbox accepts mail. One Hunter verification credit. */
export async function verifyEmail(
  email: string,
): Promise<HunterResult<{ status: MailboxStatus; score: number | null }>> {
  for (let poll = 0; poll <= MAX_POLLS; poll += 1) {
    const result = await get("email-verifier", { email });
    if (!result.ok) return { ok: false, reason: result.reason };
    if (result.status === 202) continue;
    if (result.status === 222) {
      return { ok: true, value: { status: "unknown", score: null } };
    }
    const data = (result.data ?? {}) as { status?: unknown; score?: unknown };
    const status = MAILBOX_STATUSES.has(data.status as MailboxStatus)
      ? (data.status as MailboxStatus)
      : "unknown";
    return {
      ok: true,
      value: { status, score: typeof data.score === "number" ? data.score : null },
    };
  }
  return { ok: false, reason: "Hunter was still checking this address. Try again later." };
}

/**
 * The most likely address for a person at a domain, or null when Hunter has
 * none. Charged only when an address is found.
 */
export async function findEmail(input: {
  domain: string;
  firstName: string;
  lastName: string;
}): Promise<HunterResult<{ email: string; score: number | null } | null>> {
  if (!input.domain || !input.firstName || !input.lastName) return { ok: true, value: null };
  const result = await get("email-finder", {
    domain: input.domain,
    first_name: input.firstName,
    last_name: input.lastName,
  });
  if (!result.ok) {
    return result.status === 404 ? { ok: true, value: null } : { ok: false, reason: result.reason };
  }
  const data = (result.data ?? {}) as { email?: unknown; score?: unknown };
  if (typeof data.email !== "string" || !data.email) return { ok: true, value: null };
  return {
    ok: true,
    value: { email: data.email, score: typeof data.score === "number" ? data.score : null },
  };
}
