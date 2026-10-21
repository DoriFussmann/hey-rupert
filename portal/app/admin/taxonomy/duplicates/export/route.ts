import ExcelJS from "exceljs";
import { NextResponse } from "next/server";
import { getAuthContext } from "@/lib/auth";
import { isServiceRoleConfigured } from "@/lib/env";
import { loadLiveDb } from "@/lib/match/db-server";
import { createServiceClient } from "@/lib/supabase/admin";
import { loadTaxonomy } from "@/lib/taxonomy/server";
import { DUPLICATE_LEVELS, DUPLICATE_LEVEL_INFO, identityProposals, resolveIdentities } from "@/lib/match/tiers/duplicates";
import { duplicateReport, loadIdentityDecisions } from "@/lib/match/tiers/server";

// The duplicate report, every group, for offline review. Admin only, read-only.
export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function GET() {
  const { user, role } = await getAuthContext();
  if (!user || role !== "admin") return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  if (!isServiceRoleConfigured()) return NextResponse.json({ error: "Service role key is not configured." }, { status: 500 });
  const supabase = createServiceClient();
  const [taxonomy, live] = await Promise.all([loadTaxonomy(supabase), loadLiveDb(supabase)]);
  if (!taxonomy.ok) return NextResponse.json({ error: taxonomy.error }, { status: 500 });
  if (!live.ok) return NextResponse.json({ error: live.error }, { status: 500 });
  const [report, decisions] = await Promise.all([duplicateReport(supabase, live.value.db, taxonomy.value), loadIdentityDecisions(supabase)]);
  if (!report.ok) return NextResponse.json({ error: report.error }, { status: 500 });
  if (!decisions.ok) return NextResponse.json({ error: decisions.error }, { status: 500 });
  const resolved = new Map(resolveIdentities(identityProposals(report.value), decisions.value).map((r) => [r.key, r]));
  const statusText = (key: string) => {
    const r = resolved.get(key);
    if (!r) return "";
    if (r.stale) return "Changed since the decision: not applied";
    if (r.decision) return `${r.decision.status === "confirmed" ? "Confirmed as one firm" : "Kept separate"} by ${r.decision.decidedBy ?? "admin"} (${r.decision.decidedAt ?? ""})`;
    return r.applied ? "Offices: shown once automatically" : "Waiting for a decision: not merged";
  };

  const book = new ExcelJS.Workbook();
  const summary = book.addWorksheet("Summary");
  summary.columns = [{ width: 22 }, { width: 70 }, { width: 60 }, { width: 10 }, { width: 10 }];
  summary.addRow(["Level", "Rule", "Proposal", "Groups", "Firms"]).font = { bold: true };
  for (const level of DUPLICATE_LEVELS) {
    const info = DUPLICATE_LEVEL_INFO[level];
    summary.addRow([info.label, info.rule, info.proposal, report.value.counts[level].groups, report.value.counts[level].firms]);
  }
  summary.addRow([]);
  summary.addRow(["Fund Database", `${live.value.version.fileName} (${live.value.version.id})`]);
  summary.addRow(["Taxonomy revision", taxonomy.value.taxonomy.revision]);
  summary.addRow(["Firms", report.value.firms]);
  for (const watch of report.value.watched) {
    summary.addRow([watch.name, watch.groups.length ? watch.groups.map((g) => `${DUPLICATE_LEVEL_INFO[g.level].label}: ${g.shared}`).join(" | ") : "Not in any group"]);
  }

  const groups = book.addWorksheet("Groups");
  groups.columns = [
    { header: "Level", key: "level", width: 16 },
    { header: "Kind", key: "kind", width: 12 },
    { header: "Status", key: "status", width: 46 },
    { header: "Group", key: "group", width: 60 },
    { header: "FirmID", key: "id", width: 14 },
    { header: "Name", key: "name", width: 36 },
    { header: "Website", key: "website", width: 32 },
    { header: "HQ", key: "location", width: 30 },
    { header: "Type", key: "type", width: 28 },
    { header: "Contacts", key: "contacts", width: 10 },
    { header: "Verification", key: "verified", width: 36 },
  ];
  groups.getRow(1).font = { bold: true };
  groups.views = [{ state: "frozen", ySplit: 1 }];
  for (const group of report.value.groups) {
    for (const m of group.members) {
      groups.addRow({
        level: DUPLICATE_LEVEL_INFO[group.level].label,
        kind: resolved.get(group.key)?.kind === "offices" ? "Offices" : "Duplicate",
        status: statusText(group.key),
        group: group.shared,
        id: m.id,
        name: m.name,
        website: m.website,
        location: m.location,
        type: m.type,
        contacts: m.contacts,
        verified: Object.entries(m.verified).map(([s, c]) => `${c} ${s}`).join(", "),
      });
    }
  }

  const buffer = await book.xlsx.writeBuffer();
  return new NextResponse(Buffer.from(buffer), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="rupert-duplicate-firms-${new Date().toISOString().slice(0, 10)}.xlsx"`,
      "Cache-Control": "no-store",
    },
  });
}
