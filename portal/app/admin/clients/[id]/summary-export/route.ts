import ExcelJS from "exceljs";
import { NextResponse } from "next/server";
import { getAuthContext } from "@/lib/auth";
import { isServiceRoleConfigured } from "@/lib/env";
import { createServiceClient } from "@/lib/supabase/admin";
import { currentFinalization, loadDeliverables } from "@/lib/match/summary/server";
import { cellText, type Detail, type Summary } from "@/lib/match/summary/core";

// Download: the matching summary or the Competitive Landscape Overview as an
// Excel file, one tab per step, each tab named after its step. From the
// finalized matching (?from=finalized, the default) or from what was pushed
// to the client page (?from=pushed). Admin only.
export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f-]{36}$/i;

/** A valid, unique Excel tab name (31 characters, none of []:*?/\). */
function tabName(name: string, taken: Set<string>) {
  const base = name.replace(/[[\]:*?/\\]/g, " ").replace(/\s+/g, " ").trim().slice(0, 31) || "Sheet";
  let out = base;
  for (let i = 2; taken.has(out.toLowerCase()); i += 1) out = `${base.slice(0, 31 - String(i).length - 1)} ${i}`;
  taken.add(out.toLowerCase());
  return out;
}

function workbook(summary: Summary) {
  const book = new ExcelJS.Workbook();
  const taken = new Set<string>();
  for (const step of summary.steps) {
    const sheet = book.addWorksheet(tabName(`${step.button} ${step.title}`, taken));
    sheet.addRow([`${step.button}: ${step.title}`]).font = { bold: true, size: 13 };
    if (step.headline) sheet.addRow([step.headline.label, step.headline.value]);
    if (step.line) sheet.addRow([step.line]);
    for (const table of step.tables) {
      sheet.addRow([]);
      if (table.title) sheet.addRow([table.title]).font = { bold: true };
      // The details shown on a row's click become extra columns here (those not already a column).
      const shownLabels = new Set(table.columns.map((c) => c.label.toLowerCase()));
      const extra = Array.from(new Set((table.details ?? []).flatMap((d) => d.map((x) => x.label)))).filter((l) => !shownLabels.has(l.toLowerCase()));
      sheet.addRow([...table.columns.map((c) => c.label), ...extra]).font = { bold: true };
      const asValue = (cell: Parameters<typeof cellText>[0]) => (cell && typeof cell === "object" ? { text: cell.text, hyperlink: cell.href } : cellText(cell));
      const add = (row: Record<string, unknown>, detail: Detail[] | undefined, bold = false) => {
        const r = sheet.addRow([
          ...table.columns.map((c) => asValue(row[c.key] as Parameters<typeof cellText>[0])),
          ...extra.map((label) => {
            const d = detail?.find((x) => x.label === label);
            if (!d) return "";
            return Array.isArray(d.value) ? d.value.map((v) => cellText(v)).join("; ") : asValue(d.value);
          }),
        ]);
        if (bold) r.font = { bold: true };
      };
      table.rows.forEach((row, i) => add(row, table.details?.[i]));
      if (table.total) add(table.total, undefined, true);
    }
    sheet.columns.forEach((col, i) => {
      let width = 10;
      col.eachCell?.({ includeEmpty: false }, (cell) => {
        const v = cell.value as { text?: string } | string | number | null;
        const text = v && typeof v === "object" ? v.text ?? "" : String(v ?? "");
        width = Math.max(width, Math.min(60, text.length + 2));
      });
      col.width = i === 0 && width > 45 ? 45 : width;
    });
  }
  return book;
}

export async function GET(request: Request, { params }: { params: { id: string } }) {
  const { user, role } = await getAuthContext();
  if (!user || role !== "admin") return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  if (!isServiceRoleConfigured()) return NextResponse.json({ error: "Service role key is not configured." }, { status: 500 });
  if (!UUID.test(params.id)) return NextResponse.json({ error: "Unknown client." }, { status: 400 });
  const url = new URL(request.url);
  const kind = url.searchParams.get("kind") === "landscape" ? "landscape" : "matching";
  const supabase = createServiceClient();

  let summary: Summary | null = null;
  if (url.searchParams.get("from") === "pushed") {
    const list = await loadDeliverables(supabase, params.id);
    if (!list.ok) return NextResponse.json({ error: list.error }, { status: 400 });
    summary = list.value.find((d) => d.kind === kind)?.content ?? null;
  } else {
    const fin = await currentFinalization(supabase, params.id);
    if (!fin.ok) return NextResponse.json({ error: fin.error }, { status: 400 });
    summary = fin.value ? (kind === "matching" ? fin.value.matching : fin.value.landscape) : null;
  }
  if (!summary) return NextResponse.json({ error: "Nothing to download yet." }, { status: 404 });

  const buffer = await workbook(summary).xlsx.writeBuffer();
  const slug = (summary.clientName || "client").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  const file = `${slug}-${kind === "matching" ? "matching-summary" : "competitive-landscape"}.xlsx`;
  return new NextResponse(buffer as ArrayBuffer, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${file}"`,
      "Cache-Control": "no-store",
    },
  });
}
