import "server-only";
import type { createServiceClient } from "@/lib/supabase/admin";
import type { FundDb } from "@/lib/match/engine/index.mjs";
import type { TaxIndex } from "@/lib/taxonomy/core";
import { rawForFn } from "@/lib/match/added/core";
import { proofByFirm, provenRevision, withProof, type Proof, type ProvenInvestment } from "./core.ts";

type ServiceClient = ReturnType<typeof createServiceClient>;

/** Every recorded investment (Step 2C / 3C). Empty before the migration, so matching never breaks. */
export async function loadProven(supabase: ServiceClient): Promise<ProvenInvestment[]> {
  const rows: ProvenInvestment[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase
      .from("fund_investments")
      .select("firm_id, company, company_sectors, round")
      .order("id")
      .range(from, from + 999);
    if (error || !data) return rows;
    for (const r of data as { firm_id: string | null; company: string | null; company_sectors: string[] | null; round: string | null }[]) {
      if (r.firm_id) rows.push({ firmId: r.firm_id, company: r.company ?? "", sectors: r.company_sectors ?? [], round: r.round ?? "" });
    }
    if (data.length < 1000) return rows;
  }
}

/** The database with every fund's proven sectors and stages added, the proof by fund, and its fingerprint. */
export function applyProven(db: FundDb, index: TaxIndex, rows: ProvenInvestment[]): { db: FundDb; proof: Map<string, Proof>; revision: string } {
  const proof = proofByFirm(rows);
  if (!proof.size) return { db, proof, revision: "" };
  const rawFor = rawForFn(index);
  const byLabel = new Map<string, "industry" | "vertical">();
  for (const n of Array.from(index.nodes.values())) {
    if (n.status === "active" && n.dimension === "sector" && n.kind === "sector") {
      byLabel.set(n.label.toLowerCase(), n.attrs.granularity === "broad" ? "industry" : "vertical");
    }
  }
  const firms = withProof(db.firms, proof, rawFor, (label) => byLabel.get(label.toLowerCase()) ?? null);
  return { db: { ...db, firms }, proof, revision: provenRevision(rows) };
}
