import { NextResponse, type NextRequest } from "next/server";
import { isServiceRoleConfigured } from "@/lib/env";
import { sendDailySummary } from "@/lib/outreach/daily-summary-server";
import { createServiceClient } from "@/lib/supabase/admin";

// Vercel Cron, weekdays at 22:00 UTC: Rupert's daily summary of every live
// campaign. 22:00 UTC is 5pm Eastern in winter (EST) and 6pm in summer (EDT);
// Vercel schedules in UTC only. Same CRON_SECRET check as the other crons.
export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return NextResponse.json({ error: "CRON_SECRET is not configured." }, { status: 500 });
  if (request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }
  if (!isServiceRoleConfigured()) return NextResponse.json({ error: "Service role key is not configured." }, { status: 500 });
  const result = await sendDailySummary(createServiceClient());
  return NextResponse.json(result);
}
