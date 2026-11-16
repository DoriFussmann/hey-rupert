import { NextResponse, type NextRequest } from "next/server";
import { isServiceRoleConfigured } from "@/lib/env";
import { parseResendEvent } from "@/lib/email-tracking";
import { recordTrackingEvent } from "@/lib/email-tracking-server";
import { resendSignatureValid } from "@/lib/email-tracking-signature";
import { createServiceClient } from "@/lib/supabase/admin";

// Resend → delivered, opened, clicked, bounced and complained for the emails
// the portal sends. Signed with RESEND_WEBHOOK_SECRET (the webhook's signing
// secret in Resend); anything else is refused. Each event is stored and the
// email's row in the client's history is brought up to date.
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const secret = process.env.RESEND_WEBHOOK_SECRET;
  if (!secret) return NextResponse.json({ error: "RESEND_WEBHOOK_SECRET is not configured." }, { status: 503 });
  if (!isServiceRoleConfigured()) return NextResponse.json({ error: "Not configured." }, { status: 503 });

  const raw = await request.text();
  const webhookId = request.headers.get("svix-id");
  const valid = resendSignatureValid(secret, raw, {
    id: webhookId,
    timestamp: request.headers.get("svix-timestamp"),
    signature: request.headers.get("svix-signature"),
  });
  if (!valid || !webhookId) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });

  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: "Invalid payload." }, { status: 400 });
  }

  const event = parseResendEvent(body, new Date().toISOString());
  // Events this endpoint doesn't use (sent, scheduled, contacts…): acknowledged, not stored.
  if (!event) return NextResponse.json({ received: true, ignored: true });

  const result = await recordTrackingEvent(createServiceClient(), webhookId, event, body);
  if (!result.ok) {
    console.error(`Resend event not recorded (${event.type}): ${result.error}`);
    // A 5xx makes Resend retry; a missing table won't fix itself, so don't ask for one.
    return NextResponse.json({ error: result.error }, { status: result.retry ? 500 : 200 });
  }
  return NextResponse.json({ received: true, outcome: result.outcome });
}
