import { NextResponse, type NextRequest } from "next/server";
import { isServiceRoleConfigured } from "@/lib/env";
import { dailyProspectSweep } from "@/lib/prospects/server";
import { createServiceClient } from "@/lib/supabase/admin";

// Vercel Cron, daily: schedules the prep and check-in emails for calls that
// were too far ahead when booked, retries failed briefs, and sends one
// reminder about good-fit prospects who aren't clients 3 days after the call.
// Same CRON_SECRET check as the other crons.
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return NextResponse.json({ error: "CRON_SECRET is not configured." }, { status: 500 });
  if (request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }
  if (!isServiceRoleConfigured()) return NextResponse.json({ error: "Service role key is not configured." }, { status: 500 });
  return NextResponse.json(await dailyProspectSweep(createServiceClient()));
}
