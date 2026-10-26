import { NextResponse, type NextRequest } from "next/server";
import { isServiceRoleConfigured } from "@/lib/env";
import { webhookAuthorized } from "@/lib/outreach/live-server";
import { handleInstantlyEvent } from "@/lib/outreach/replies-server";
import { createServiceClient } from "@/lib/supabase/admin";

// Instantly → every event of a live campaign. Registered by Go Live with
// "Authorization: Bearer <INSTANTLY_WEBHOOK_SECRET>"; anything else is refused.
// 2xx for anything handled or ignored; 5xx only when a retry could succeed.
export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function POST(request: NextRequest) {
  if (!isServiceRoleConfigured()) return NextResponse.json({ error: "Not configured." }, { status: 503 });
  if (!webhookAuthorized(request.headers.get("authorization"))) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }
  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid payload." }, { status: 400 });
  }
  if (!payload || typeof payload !== "object") return NextResponse.json({ received: true, ignored: true });
  const outcome = await handleInstantlyEvent(createServiceClient(), payload as Record<string, unknown>);
  if (outcome === "error") return NextResponse.json({ error: "Temporary failure." }, { status: 500 });
  return NextResponse.json({ received: true, outcome });
}
