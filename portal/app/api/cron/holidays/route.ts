import { NextResponse, type NextRequest } from "next/server";
import { isServiceRoleConfigured } from "@/lib/env";
import { runHolidayGuard } from "@/lib/outreach/live-server";
import { cronLogged } from "@/lib/cron-log";

// Vercel Cron, daily before the sending window: pauses live campaigns on a
// US federal holiday and starts them again on the next Business Day.
// Same CRON_SECRET check as the other crons.
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return NextResponse.json({ error: "CRON_SECRET is not configured." }, { status: 500 });
  if (request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }
  if (!isServiceRoleConfigured()) return NextResponse.json({ error: "Service role key is not configured." }, { status: 500 });
  const result = await cronLogged("holidays", (supabase) => runHolidayGuard(supabase));
  return NextResponse.json(result);
}
