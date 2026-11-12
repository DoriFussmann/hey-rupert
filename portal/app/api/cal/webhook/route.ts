import { waitUntil } from "@vercel/functions";
import { NextResponse, type NextRequest } from "next/server";
import { isServiceRoleConfigured } from "@/lib/env";
import { parseCalEvent } from "@/lib/prospects/core";
import { calSignatureValid } from "@/lib/prospects/signature";
import { applyBooking, logWebhookEvent, prepareProspect } from "@/lib/prospects/server";
import { createServiceClient } from "@/lib/supabase/admin";

// Cal.com → every booking event (created, rescheduled, cancelled, ...).
// Signed with CAL_WEBHOOK_SECRET (the webhook's Secret in Cal.com); anything
// else is refused. The booking is stored right away and Cal.com gets its 2xx;
// the brief, the estimate and the scheduled emails run after the response.
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(request: NextRequest) {
  const secret = process.env.CAL_WEBHOOK_SECRET;
  if (!secret) return NextResponse.json({ error: "CAL_WEBHOOK_SECRET is not configured." }, { status: 503 });
  if (!isServiceRoleConfigured()) return NextResponse.json({ error: "Not configured." }, { status: 503 });

  const raw = await request.text();
  if (!calSignatureValid(secret, raw, request.headers.get("x-cal-signature-256"))) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: "Invalid payload." }, { status: 400 });
  }

  const supabase = createServiceClient();
  const event = parseCalEvent(body);
  if (event.kind === "ignored") {
    await logWebhookEvent(supabase, event.trigger, event.uid, `ignored: ${event.reason}`, body);
    return NextResponse.json({ received: true, ignored: event.reason });
  }

  const applied = await applyBooking(supabase, event.booking);
  await logWebhookEvent(supabase, event.trigger, event.booking.uid, applied.ok ? applied.outcome : `error: ${applied.error}`, body);
  if (!applied.ok) return NextResponse.json({ error: "Temporary failure." }, { status: 500 });

  if (applied.prepare && applied.prospectId) {
    const prospectId = applied.prospectId;
    waitUntil(
      prepareProspect(supabase, prospectId).then(
        (result) => {
          if (!result.ok) console.error(`Prospect prep failed (${prospectId}): ${result.error}`);
        },
        (err) => console.error(`Prospect prep failed (${prospectId}):`, err),
      ),
    );
  }
  return NextResponse.json({ received: true, outcome: applied.outcome });
}
