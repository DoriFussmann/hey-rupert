import ExcelJS from "exceljs";
import { NextResponse, type NextRequest } from "next/server";
import { getAuthContext } from "@/lib/auth";
import { isServiceRoleConfigured } from "@/lib/env";
import { createServiceClient } from "@/lib/supabase/admin";
import { NEW_PLACES, OLD_PLACES, newPlaceLabel, oldPlaceLabel, reasonLabel } from "@/lib/match/tiers/compare";
import { loadComparison } from "@/lib/match/tiers/server";

// A saved comparison, every fund, for offline review. Admin only.
export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function GET(request: NextRequest, { params }: { params: { id: string } }) {
  const { user, role } = await getAuthContext();
  if (!user || role !== "admin") return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  if (!isServiceRoleConfigured()) return NextResponse.json({ error: "Service role key is not configured." }, { status: 500 });
  const comparisonId = request.nextUrl.searchParams.get("comparison") ?? "";
  if (!/^[0-9a-f-]{36}$/i.test(comparisonId) || !/^[0-9a-f-]{36}$/i.test(params.id)) {
    return NextResponse.json({ error: "Unknown comparison." }, { status: 400 });
  }
  const loaded = await loadComparison(createServiceClient(), params.id, comparisonId);
  if (!loaded.ok) return NextResponse.json({ error: loaded.error }, { status: 404 });
  const { legacy, tiers, comparison, complete } = loaded.value;

  const book = new ExcelJS.Workbook();
  const summary = book.addWorksheet("Summary");
  summary.columns = [{ width: 34 }, { width: 70 }];
  const inputs = tiers.profileInputs as Record<string, { label?: string } | unknown>;
  const label = (v: unknown) => (v as { label?: string } | null)?.label ?? "";
  summary.addRows([
    ["Client", tiers.clientName],
    ["Ran", tiers.ranAt],
    ["Ran by", tiers.ranBy ?? ""],
    ["Complete", complete ? "Yes" : "No: not every result was saved"],
    ["Fund Database version", `${tiers.fundDbFile} (${tiers.fundDbVersion})`],
    ["Taxonomy revision", tiers.taxonomyRevision],
    ["Company profile version", tiers.profileVersion ?? "Legacy profile"],
    ["Four-tier rules", tiers.rulesVersion],
    ["Current engine run", legacy.id],
    ["Four-tier run", tiers.id],
    ["Primary sector", label(inputs.primarySector)],
    ["Stage", label(inputs.stage)],
    ["HQ", [label(inputs.hqCountry), label(inputs.hqState)].filter(Boolean).join(", ")],
    ["Readiness", String(inputs.readiness ?? "")],
    [],
    ["Current engine", "Funds"],
    ...OLD_PLACES.filter((p) => p !== "not_listed").map((p) => [oldPlaceLabel(p), comparison.oldCounts[p]]),
    [],
    ["Four-tier engine", "Funds"],
    ...NEW_PLACES.map((p) => [newPlaceLabel(p), comparison.newCounts[p]]),
    [],
    ["Reason (outside the tiers)", "Funds / listed by the current engine"],
    ...comparison.reasons.map((r) => [r.label, `${r.funds} / ${r.wereListed}`]),
  ]);
  summary.getColumn(1).font = { bold: true };

  const matrix = book.addWorksheet("Current to four-tier");
  matrix.addRow(["Current \\ Four-tier", ...NEW_PLACES.map(newPlaceLabel)]).font = { bold: true };
  for (const o of OLD_PLACES) matrix.addRow([oldPlaceLabel(o), ...NEW_PLACES.map((p) => comparison.matrix[o][p])]);
  matrix.getColumn(1).width = 22;

  const funds = book.addWorksheet("Funds");
  funds.columns = [
    { header: "FirmID", key: "id", width: 14 },
    { header: "Fund", key: "name", width: 36 },
    { header: "Current engine", key: "old", width: 18 },
    { header: "Current engine reason", key: "oldWhy", width: 50 },
    { header: "Four-tier", key: "next", width: 18 },
    { header: "Deciding reason", key: "reason", width: 30 },
    { header: "Why", key: "why", width: 80 },
    { header: "Notes", key: "notes", width: 40 },
    { header: "Possible duplicate", key: "duplicate", width: 40 },
  ];
  funds.getRow(1).font = { bold: true };
  funds.views = [{ state: "frozen", ySplit: 1 }];
  for (const row of comparison.rows) {
    funds.addRow({
      id: row.firmId,
      name: row.name,
      old: oldPlaceLabel(row.old),
      oldWhy: row.oldWhy,
      next: newPlaceLabel(row.next),
      reason: row.reason ? reasonLabel(row.reason) : "",
      why: row.why,
      notes: row.notes.join("; "),
      duplicate: row.duplicate,
    });
  }

  const buffer = await book.xlsx.writeBuffer();
  const name = `four-tier-comparison-${tiers.clientName.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}-${tiers.ranAt.slice(0, 10)}.xlsx`;
  return new NextResponse(Buffer.from(buffer), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${name}"`,
      "Cache-Control": "no-store",
    },
  });
}
