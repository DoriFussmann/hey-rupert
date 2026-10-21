import ExcelJS from "exceljs";
import { NextResponse } from "next/server";
import { getAuthContext } from "@/lib/auth";
import { isServiceRoleConfigured } from "@/lib/env";
import { createServiceClient } from "@/lib/supabase/admin";
import { RELATIONS, RELATION_HELP, RELATION_LABEL, type EdgeOrigin, type EdgeReview } from "@/lib/taxonomy/core";
import { loadTaxonomy } from "@/lib/taxonomy/server";

// Every sector relationship, for offline review. Admin only.
export const dynamic = "force-dynamic";

const ORIGIN: Record<EdgeOrigin, string> = {
  seed: "Seeded",
  legacy: "Current match engine",
  manual: "Added by an admin",
  ai: "AI suggestion",
};

const STATUS: Record<EdgeReview, string> = {
  approved: "Approved",
  needs_review: "Needs review",
  rejected: "Rejected",
};

export async function GET() {
  const { user, role } = await getAuthContext();
  if (!user || role !== "admin") {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }
  if (!isServiceRoleConfigured()) {
    return NextResponse.json({ error: "Service role key is not configured." }, { status: 500 });
  }
  const taxonomy = await loadTaxonomy(createServiceClient());
  if (!taxonomy.ok) return NextResponse.json({ error: taxonomy.error }, { status: 500 });
  const index = taxonomy.value;
  const label = (id: string) => index.nodes.get(id)?.label ?? id;

  const rows = index.taxonomy.edges
    .map((edge) => [
      label(edge.fromId),
      edge.directed ? "one way →" : "both ways ↔",
      label(edge.toId),
      RELATION_LABEL[edge.relation],
      STATUS[edge.review],
      ORIGIN[edge.origin],
      edge.source,
      edge.rationale,
      edge.context,
      edge.reviewedBy ?? "",
      edge.reviewedAt ? edge.reviewedAt.slice(0, 10) : "",
      edge.fromId,
      edge.toId,
      edge.id,
    ])
    .sort((a, b) => String(a[0]).localeCompare(String(b[0])) || String(a[2]).localeCompare(String(b[2])));

  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Relationships", { views: [{ state: "frozen", ySplit: 1 }] });
  sheet.addRow([
    "Sector",
    "Direction",
    "Related sector",
    "Type",
    "Status",
    "Origin",
    "Source",
    "Rationale",
    "Only holds when",
    "Reviewed by",
    "Reviewed on",
    "Sector ID",
    "Related sector ID",
    "Relationship ID",
  ]);
  sheet.addRows(rows);
  sheet.getRow(1).font = { bold: true };
  workbook
    .addWorksheet("Types")
    .addRows([["Type", "Meaning"], ...RELATIONS.map((relation) => [RELATION_LABEL[relation], RELATION_HELP[relation]])]);

  const buffer = await workbook.xlsx.writeBuffer();
  return new NextResponse(Buffer.from(buffer), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="rupert-sector-relationships-r${index.taxonomy.revision}.xlsx"`,
      "Cache-Control": "no-store",
    },
  });
}
