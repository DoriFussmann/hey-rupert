import { NextResponse, type NextRequest } from "next/server";
import { isServiceRoleConfigured } from "@/lib/env";
import { runPresendChecks } from "@/lib/outreach/presend-report-server";
import { cronLogged } from "@/lib/cron-log";

// Vercel Cron: the pre-send email check, 04:00 UTC (8pm Pacific, the evening
// before) and again at 13:00 UTC (5am Pacific) for anything the first run
// didn't finish, both before the 15:00 UTC push. Emails Rupert the summary;
// the 5am run only when it had something to finish.
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
  // ?client=<id>: one client only, started when they approve the launch. Always emails the summary.
  const client = request.nextUrl.searchParams.get("client");
  const clientId = client && /^[0-9a-f-]{36}$/i.test(client) ? client : undefined;
  const morning = new Date().getUTCHours() >= 12;
  const result = await cronLogged("presend", (supabase) =>
    runPresendChecks(supabase, clientId ? { clientId, email: "always" } : { email: morning ? "if_checked" : "always" }),
  );
  return NextResponse.json({
    campaigns: result.campaigns.map((c) => ({ client: c.clientId, day: c.day, room: c.room, ready: c.ready, checked: c.outcomes.length, errors: c.errors.length })),
    delivered: result.delivered,
    emailed: result.emailed,
    error: result.error,
  });
}
