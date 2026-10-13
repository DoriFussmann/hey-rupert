import { NextResponse, type NextRequest } from "next/server";
import { isServiceRoleConfigured } from "@/lib/env";
import { runClientReminders } from "@/lib/reminders";
import { createServiceClient } from "@/lib/supabase/admin";

// Vercel Cron calls this on the schedule in vercel.json and sends
// "Authorization: Bearer <CRON_SECRET>" when CRON_SECRET is set on the
// project. Anyone else is refused.
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json(
      { error: "CRON_SECRET is not configured." },
      { status: 500 },
    );
  }
  if (request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }
  if (!isServiceRoleConfigured()) {
    return NextResponse.json(
      { error: "Service role key is not configured." },
      { status: 500 },
    );
  }

  const run = await runClientReminders(createServiceClient());
  if (run.errors.length > 0) console.error("Reminders:", run.errors);
  return NextResponse.json(run);
}
