import ExcelJS from "exceljs";
import { NextResponse, type NextRequest } from "next/server";
import { getAuthContext } from "@/lib/auth";
import { isServiceRoleConfigured } from "@/lib/env";
import { createServiceClient } from "@/lib/supabase/admin";
import { NEAR_MISS_BANNER, nearMissRows, runFacts } from "@/lib/match/tiers/export";
import { loadTierRun } from "@/lib/match/tiers/server";

// Funds of one saved run excluded as one stage off. For review only: marked
// NOT AN ELIGIBLE MATCH LIST on every sheet and row. Admin only.
export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f-]{36}$/i;

export async function GET(request: NextRequest, { params }: { params: { id: string } }) {
  const { user, role } = await getAuthContext();
  if (!user || role !== "admin") return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  if (!isServiceRoleConfigured()) return NextResponse.json({ error: "Service role key is not configured." }, { status: 500 });
  const runId = request.nextUrl.searchParams.get("run") ?? "";
  if (!UUID.test(runId) || !UUID.test(params.id)) return NextResponse.json({ error: "Unknown run." }, { status: 400 });
  const loaded = await loadTierRun(createServiceClient(), params.id, runId);
  if (!loaded.ok) return NextResponse.json({ error: loaded.error }, { status: 404 });
  const { header, rows, complete } = loaded.value;

  const book = new ExcelJS.Workbook();
  const sheet = book.addWorksheet("NOT ELIGIBLE near misses");
  const banner = { font: { bold: true, color: { argb: "FF9C0006" } }, fill: { type: "pattern" as const, pattern: "solid" as const, fgColor: { argb: "FFF8D7DA" } } };
  for (const line of NEAR_MISS_BANNER) {
    const row = sheet.addRow([line]);
    row.getCell(1).font = banner.font;
    row.getCell(1).fill = banner.fill;
  }
  sheet.addRow([]);
  const data = nearMissRows(rows);
  sheet.addRows(data);
  sheet.getRow(NEAR_MISS_BANNER.length + 2).font = { bold: true };
  [30, 12, 34, 40, 50].forEach((w, i) => (sheet.getColumn(i + 1).width = w));
  const facts = book.addWorksheet("Run");
  facts.addRow([NEAR_MISS_BANNER[0]]).getCell(1).font = banner.font;
  facts.addRows(runFacts(header, complete));
  facts.getColumn(1).width = 28;
  facts.getColumn(2).width = 90;

  const buffer = await book.xlsx.writeBuffer();
  const name = `NOT-ELIGIBLE-near-misses-${header.clientName.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}-${header.id.slice(0, 8)}.xlsx`;
  return new NextResponse(Buffer.from(buffer), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${name}"`,
      "Cache-Control": "no-store",
    },
  });
}
