import "server-only";
import { PORTAL_URL } from "@/lib/portal-url";

/**
 * Starts the pre-send email check for one client in its own request (it takes minutes), without
 * waiting for it. Used when the client approves the launch, so the first batch is checked before
 * Rupert clicks Add Leads instead of waiting for the nightly run. Best effort: the nightly run and
 * Check Next Batch still cover it if this doesn't start.
 */
export async function kickPresend(clientId: string): Promise<void> {
  const secret = process.env.CRON_SECRET;
  if (!secret) return;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 3000);
  try {
    await fetch(`${PORTAL_URL}/api/cron/presend?client=${encodeURIComponent(clientId)}`, {
      headers: { authorization: `Bearer ${secret}` },
      signal: controller.signal,
      cache: "no-store",
    });
  } catch {
    // Aborted after the request went out (the check keeps running there), or it didn't start.
  } finally {
    clearTimeout(timer);
  }
}
