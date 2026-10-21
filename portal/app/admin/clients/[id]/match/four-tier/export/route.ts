import ExcelJS from "exceljs";
import { NextResponse, type NextRequest } from "next/server";
import { getAuthContext } from "@/lib/auth";
import { isServiceRoleConfigured } from "@/lib/env";
import { createServiceClient } from "@/lib/supabase/admin";
import { contactRows, fundRows, outsideRows, runFacts } from "@/lib/match/tiers/export";
import { contactStates, loadTierRun } from "@/lib/match/tiers/server";

// Exports one saved four-tier run: nothing is recomputed, so the file is
// exactly what the run saved. Verification is as of the export. Admin only.
export const dynamic = "force-dynamic";
export const maxDuration = 120;

const UUID = /^[0-9a-f-]{36}$/i;

export async function GET(request: NextRequest, { params }: { params: { id: string } }) {
  const { user, role } = await getAuthContext();
  if (!user || role !== "admin") return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  if (!isServiceRoleConfigured()) return NextResponse.json({ error: "Service role key is not configured." }, { status: 500 });
  const runId = request.nextUrl.searchParams.get("run") ?? "";
  const includeAll = request.nextUrl.searchParams.get("all") === "1";
  if (!UUID.test(runId) || !UUID.test(params.id)) return NextResponse.json({ error: "Unknown run." }, { status: 400 });
  const supabase = createServiceClient();
  const loaded = await loadTierRun(supabase, params.id, runId);
  if (!loaded.ok) return NextResponse.json({ error: loaded.error }, { status: 404 });
  const { header, rows, complete } = loaded.value;
  const fids = Array.from(new Set(rows.flatMap((r) => ((r.detail.people ?? []) as { fid: string }[]).map((p) => p.fid))));
  const states = await contactStates(supabase, params.id, fids);
  if (!states.ok) return NextResponse.json({ error: states.error }, { status: 500 });
  const people = contactRows(rows, states.value, includeAll);

  const book = new ExcelJS.Workbook();
  const summary = book.addWorksheet("Run");
  summary.columns = [{ width: 28 }, { width: 90 }];
  summary.addRows([
    ...runFacts(header, complete),
    ["Exported", new Date().toISOString()],
    ["Exported by", user.email ?? ""],
    ["Contacts", includeAll ? "Everyone (verified or not)" : "Everyone except known problems (Email bad, Left firm, Role changed, Not found) not kept for this client"],
    ["Verification", "As of the export; the run itself is unchanged."],
    [
      "Left out",
      `${people.leftOut} contact${people.leftOut === 1 ? "" : "s"} with a known problem; ${people.repeated} repeated email${people.repeated === 1 ? "" : "s"}.`,
    ],
  ]);
  summary.getColumn(1).font = { bold: true };
  const add = (name: string, data: (string | number)[][], widths: number[]) => {
    const sheet = book.addWorksheet(name);
    sheet.addRows(data);
    sheet.getRow(1).font = { bold: true };
    sheet.views = [{ state: "frozen", ySplit: 1 }];
    widths.forEach((w, i) => (sheet.getColumn(i + 1).width = w));
  };
  add("Funds", fundRows(rows), [10, 6, 12, 32, 6, 20, 50, 70, 30, 40, 40, 40, 60, 14]);
  add("Contacts", people.rows, [10, 32, 12, 10, 26, 30, 20, 32, 16, 16, 14, 8, 18]);
  add("Outside the tiers", outsideRows(rows), [22, 36, 12, 32, 80, 40]);

  const buffer = await book.xlsx.writeBuffer();
  const name = `four-tier-${header.clientName.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}-${header.ranAt.slice(0, 10)}-${header.id.slice(0, 8)}.xlsx`;
  return new NextResponse(Buffer.from(buffer), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${name}"`,
      "Cache-Control": "no-store",
    },
  });
}
