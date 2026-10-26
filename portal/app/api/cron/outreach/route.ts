import { NextResponse, type NextRequest } from "next/server";
import { isServiceRoleConfigured } from "@/lib/env";
import { runDueWaves } from "@/lib/outreach/live-server";
import { createServiceClient } from "@/lib/supabase/admin";

// Vercel Cron, daily: starts wave 2 (each fund's second contact) for live
// campaigns whose delay has passed. Same CRON_SECRET check as the reminders.
export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return NextResponse.json({ error: "CRON_SECRET is not configured." }, { status: 500 });
  if (request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }
  if (!isServiceRoleConfigured()) return NextResponse.json({ error: "Service role key is not configured." }, { status: 500 });
  const result = await runDueWaves(createServiceClient());
  return NextResponse.json(result);
}
