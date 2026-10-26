import { NextResponse, type NextRequest } from "next/server";
import { getAuthContext } from "@/lib/auth";
import { isServiceRoleConfigured } from "@/lib/env";
import { toCsv } from "@/lib/outreach/campaign";
import { campaignExport } from "@/lib/outreach/campaign-server";
import { createServiceClient } from "@/lib/supabase/admin";

// The Instantly import file: one row per active contact whose emails are
// exactly as approved. ?wave=1 (each fund's first contact), 2, or all. Admin only.
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const UUID = /^[0-9a-f-]{36}$/i;

export async function GET(request: NextRequest, { params }: { params: { id: string } }) {
  const { user, role } = await getAuthContext();
  if (!user || role !== "admin") return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  if (!isServiceRoleConfigured()) return NextResponse.json({ error: "Service role key is not configured." }, { status: 500 });
  if (!UUID.test(params.id)) return NextResponse.json({ error: "Unknown client." }, { status: 400 });
  const param = request.nextUrl.searchParams.get("wave");
  const wave = param === "1" ? 1 : param === "2" ? 2 : null;
  const result = await campaignExport(createServiceClient(), params.id, wave);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 409 });
  const name = `instantly-${params.id.slice(0, 8)}-${wave ? `wave-${wave}` : "all"}-${new Date().toISOString().slice(0, 10)}.csv`;
  return new NextResponse(`﻿${toCsv(result.value.rows)}`, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${name}"`,
      "X-Skipped-Contacts": String(result.value.skipped.length),
    },
  });
}
