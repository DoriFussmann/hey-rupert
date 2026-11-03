import { NextResponse, type NextRequest } from "next/server";
import { getAuthContext } from "@/lib/auth";
import { isServiceRoleConfigured } from "@/lib/env";
import { contactsCsv, fundsCsv } from "@/lib/fund-db-csv";
import { listAddedFunds } from "@/lib/match/added/server";
import { toContacts, toFirm } from "@/lib/match/added/core";
import { loadLiveDb } from "@/lib/match/db-server";
import { createServiceClient } from "@/lib/supabase/admin";

// The live Fund Database as CSV: ?kind=funds (one row per fund) or ?kind=contacts
// (one row per contact). Includes funds Rupert added once approved. Admin only.
export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function GET(request: NextRequest) {
  const { user, role } = await getAuthContext();
  if (!user || role !== "admin") return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  if (!isServiceRoleConfigured()) return NextResponse.json({ error: "Service role key is not configured." }, { status: 500 });

  const kind = request.nextUrl.searchParams.get("kind") === "contacts" ? "contacts" : "funds";
  const supabase = createServiceClient();
  const live = await loadLiveDb(supabase);
  if (!live.ok) return NextResponse.json({ error: live.error }, { status: 409 });

  // Approved Rupert-added funds carry taxonomy labels as they are (no provider raw values to map back to).
  const approved = await listAddedFunds(supabase, "approved");
  const funds = approved.ok ? approved.value : [];
  const added = {
    firms: funds.map((fund) => toFirm(fund, (_field, label) => label)),
    contacts: funds.flatMap(toContacts),
  };

  const body = kind === "contacts" ? contactsCsv(live.value.db, added) : fundsCsv(live.value.db, added);
  const name = `fund-database-${kind}-${new Date().toISOString().slice(0, 10)}.csv`;
  return new NextResponse(body, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${name}"`,
      "Cache-Control": "no-store",
    },
  });
}
