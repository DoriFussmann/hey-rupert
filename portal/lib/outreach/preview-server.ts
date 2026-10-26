import "server-only";
import type { createServiceClient } from "@/lib/supabase/admin";
import { copyTierOf, outreachRows, type TypedCopy } from "@/lib/outreach/copy";
import { asCorePerson, templateFor } from "@/lib/outreach/core";
import { otherGroupFor } from "@/lib/outreach/campaign";
import { loadCoreMessages, pickContacts } from "@/lib/outreach/core-server";
import { loadOverrides } from "@/lib/outreach/known-server";
import type { PreviewLead, PreviewLeads } from "@/lib/outreach/preview";
import { asInvestorList, type InvestorRow } from "@/lib/setup";
import { loadSetupSteps } from "@/lib/setup-server";

type ServiceClient = ReturnType<typeof createServiceClient>;

const PER_GROUP = 3;

/**
 * A few real leads per copy group, in list order, to preview the emails with:
 * each fund's first contact. Core leads carry a Quick Fact once their
 * personal emails are written. Never fails: no leads means no preview.
 */
export async function loadPreviewLeads(supabase: ServiceClient, clientId: string, typed: TypedCopy | null | undefined): Promise<PreviewLeads> {
  if (!typed) return {};
  try {
    const grouped = await loadSetupSteps(supabase, [clientId]);
    const listRow = (grouped.get(clientId) ?? []).find((item) => item.step === "investor_list");
    if (listRow?.status !== "confirmed") return {};
    const list = asInvestorList(listRow.published);
    if (!list.run_id) return {};
    const rows = outreachRows(list, await loadOverrides(supabase, clientId)).rows;

    // Pick each group's first funds, in list order, before looking up contacts.
    const chosen = new Map<string, InvestorRow[]>();
    for (const row of rows) {
      const core = copyTierOf(row) === 1;
      const group = core ? templateFor(typed, row.fund_type ?? "") : otherGroupFor(typed, row.fund_type ?? "");
      if (!group) continue;
      const key = `${core ? "core" : "others"}:${group.type}`;
      const list = chosen.get(key) ?? [];
      if (list.length < PER_GROUP) chosen.set(key, [...list, row]);
    }
    const all = Array.from(chosen.values()).flat();
    const [picked, core] = await Promise.all([pickContacts(supabase, clientId, list.run_id, all), loadCoreMessages(supabase, clientId)]);
    const facts = new Map<string, string>();
    if (core.ok) {
      for (const message of core.value) {
        const fact = message.quick_facts[0]?.fact;
        if (fact && message.slot === "active" && !facts.has(message.firm_id)) facts.set(message.firm_id, fact);
      }
    }

    const out: PreviewLeads = {};
    chosen.forEach((funds, key) => {
      out[key] = funds.map((row): PreviewLead => {
        const first = picked.ok ? picked.value.get(row.id)?.active[0] : undefined;
        const person = first ? asCorePerson(first) : null;
        const tier = copyTierOf(row);
        return {
          first_name: person?.first_name ?? "",
          person_name: person?.name ?? "",
          fund_name: row.fund_name,
          tier,
          quick_fact: tier === 1 ? facts.get(row.id) ?? null : null,
        };
      });
    });
    return out;
  } catch {
    return {};
  }
}
