import ExcelJS from "exceljs";
import { NextResponse } from "next/server";
import { getAuthContext } from "@/lib/auth";
import { isServiceRoleConfigured } from "@/lib/env";
import { exportRows, runClientMatch } from "@/lib/match/run-server";
import { createServiceClient } from "@/lib/supabase/admin";

// Internal export: full fund and contact detail. Admin only; never sent to clients.
export const dynamic = "force-dynamic";
export const maxDuration = 60;

function fileName(name: string, includeAll: boolean) {
  const safe = name.replace(/[^\w\- ]+/g, "").trim().replace(/\s+/g, "-") || "client";
  return `rupert-match-${safe}${includeAll ? "-everyone" : ""}-${new Date().toISOString().slice(0, 10)}.xlsx`;
}

export async function GET(request: Request, { params }: { params: { id: string } }) {
  const { user, role } = await getAuthContext();
  if (!user || role !== "admin") {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }
  if (!isServiceRoleConfigured()) {
    return NextResponse.json({ error: "Service role key is not configured." }, { status: 500 });
  }

  const run = await runClientMatch(createServiceClient(), params.id);
  if (!run.ok) return NextResponse.json({ error: run.error }, { status: 400 });

  const includeAll = new URL(request.url).searchParams.get("all") === "1";
  const { summary, outreach, people } = exportRows(run.value, { includeAll });
  const workbook = new ExcelJS.Workbook();
  workbook.addWorksheet("Summary").addRows(summary);
  const outreachSheet = workbook.addWorksheet("Outreach", { views: [{ state: "frozen", ySplit: 1 }] });
  outreachSheet.addRows(outreach);
  outreachSheet.getRow(1).font = { bold: true };
  const peopleSheet = workbook.addWorksheet("All investing contacts", {
    views: [{ state: "frozen", ySplit: 1 }],
  });
  peopleSheet.addRows(people);
  peopleSheet.getRow(1).font = { bold: true };

  const buffer = await workbook.xlsx.writeBuffer();
  return new NextResponse(Buffer.from(buffer), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${fileName(run.value.profile.name || "client", includeAll)}"`,
      "Cache-Control": "no-store",
    },
  });
}
