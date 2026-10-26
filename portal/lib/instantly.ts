import "server-only";

// Instantly API v2: the calls the outreach campaign needs. Instantly only
// delivers: every email is rendered in the portal and passed per lead as
// custom variables. Docs: https://developer.instantly.ai
//
// Not confirmed by the public docs, so the code is defensive about them:
// account status codes (only 1 is treated as healthy), the warmup endpoint,
// and the pause endpoint.

const BASE = "https://api.instantly.ai/api/v2";
const TIMEOUT_MS = 30_000;

export type InstantlyResult<T> = { ok: true; value: T } | { ok: false; error: string; status?: number };

export function isInstantlyConfigured() {
  return Boolean(process.env.INSTANTLY_API_KEY);
}

async function call<T>(method: "GET" | "POST" | "PATCH", path: string, body?: unknown): Promise<InstantlyResult<T>> {
  const key = process.env.INSTANTLY_API_KEY;
  if (!key) return { ok: false, error: "Instantly is not configured (INSTANTLY_API_KEY)." };
  try {
    const response = await fetch(`${BASE}${path}`, {
      method,
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: "no-store",
    });
    const text = await response.text();
    let data: unknown = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = text;
    }
    if (!response.ok) {
      const message =
        data && typeof data === "object" && "message" in data ? String((data as { message: unknown }).message) : String(text).slice(0, 300);
      const hint =
        response.status === 401 ? " Check INSTANTLY_API_KEY." : response.status === 402 ? " The Instantly workspace has no active paid plan." : response.status === 429 ? " Rate limited; try again shortly." : "";
      return { ok: false, error: `Instantly ${response.status}: ${message || response.statusText}.${hint}`, status: response.status };
    }
    return { ok: true, value: data as T };
  } catch (err) {
    return { ok: false, error: `Instantly could not be reached: ${err instanceof Error ? err.message : "network error"}.` };
  }
}

// ---------------------------------------------------------------------------
// Inbox connection (OAuth): the client signs in with Google or Microsoft; no
// password ever reaches the portal.

export type OAuthProvider = "google" | "microsoft";

export function oauthInit(provider: OAuthProvider) {
  return call<{ session_id: string; auth_url: string; expires_at: string }>("POST", `/oauth/${provider}/init`, {});
}

export type OAuthStatus =
  | { status: "pending" }
  | { status: "success"; email: string; name?: string; account_id?: string }
  | { status: "error"; error?: string; error_description?: string }
  | { status: "expired" };

export async function oauthStatus(sessionId: string): Promise<InstantlyResult<OAuthStatus>> {
  const result = await call<OAuthStatus>("GET", `/oauth/session/status/${encodeURIComponent(sessionId)}`);
  // A finished session is deleted after its first read; a later read is a 404.
  if (!result.ok && result.status === 404) return { ok: true, value: { status: "expired" } };
  return result;
}

export type InstantlyAccount = { email: string; status?: number; warmup_status?: number; setup_pending?: boolean };

export function getAccount(email: string) {
  return call<InstantlyAccount>("GET", `/accounts/${encodeURIComponent(email)}`);
}

export function enableWarmup(emails: string[]) {
  return call<unknown>("POST", "/accounts/warmup/enable", { emails });
}

// ---------------------------------------------------------------------------
// Campaigns and leads

export type CampaignBody = Record<string, unknown>;

export function createCampaign(body: CampaignBody) {
  return call<{ id: string; status?: number }>("POST", "/campaigns", body);
}

export function activateCampaign(id: string) {
  return call<unknown>("POST", `/campaigns/${encodeURIComponent(id)}/activate`, {});
}

export function pauseCampaign(id: string) {
  return call<unknown>("POST", `/campaigns/${encodeURIComponent(id)}/pause`, {});
}

export type LeadInput = {
  email: string;
  first_name?: string | null;
  last_name?: string | null;
  company_name?: string | null;
  job_title?: string | null;
  custom_variables?: Record<string, string | number | boolean | null>;
};

export type AddLeadsResponse = {
  leads_uploaded?: number;
  skipped_count?: number;
  in_blocklist?: number;
  invalid_email_count?: number;
  created_leads?: { index: number; id: string; email?: string }[];
};

/** Up to 1,000 leads per request. */
export function addLeads(campaignId: string, leads: LeadInput[]) {
  return call<AddLeadsResponse>("POST", "/leads/add", { campaign_id: campaignId, leads, skip_if_in_campaign: false });
}

export function createWebhook(body: { target_hook_url: string; event_type: string; campaign: string; name: string; headers: Record<string, string> }) {
  return call<{ id: string }>("POST", "/webhooks", body);
}
