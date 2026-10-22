import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { BROAD_LABEL, NAMED_CORE_MAX, listFacts, listFactsText } from "./founder-list-facts.ts";
import { promptDefinition } from "./prompts.ts";
import type { InvestorListPayload, InvestorRow } from "./setup.ts";

const portal = fileURLToPath(new URL("..", import.meta.url));
const read = (path: string) => readFileSync(`${portal}${path}`, "utf8").replace(/\r\n/g, "\n");

let next = 0;
function row(tier: 1 | 2 | 3 | 4, extra: Partial<InvestorRow> = {}): InvestorRow {
  next += 1;
  return {
    id: `F${next}`,
    fund_name: `Fund ${next}`,
    contact: "",
    details: "",
    tier,
    why: "",
    comments: "",
    fund_type: "VC",
    location: "Boston, MA",
    reasons: ["Stage: Seed", "Sector: Fintech"],
    ...extra,
  };
}

function list(): InvestorListPayload {
  next = 0;
  return {
    rows: [
      ...Array.from({ length: 7 }, () => row(1)),
      row(1, { hidden_duplicate: true, fund_name: "Hidden duplicate" }),
      ...Array.from({ length: 6 }, () => row(2)),
      ...Array.from({ length: 4 }, () => row(3)),
      ...Array.from({ length: 2 }, () => row(4)),
      row(4, { broad: true, fund_name: "Broad Co" }),
    ],
    source_file: "",
    tier_scheme: "four",
    run_id: "11111111-2222-3333-4444-555555555555",
    client_flags: { F1: { excluded: true } },
    verification: {
      verification_ran: true,
      verified_at: "2026-10-20T15:00:00Z",
      sample_size: 40,
      emails_checked: 38,
      emails_valid: 33,
      deliverable_rate: 87,
    },
  };
}

test("the email counts and names only funds on this founder's list", () => {
  const facts = listFacts(list());
  // 21 rows: one hidden duplicate and one fund the founder excluded are left out.
  assert.equal(facts.total, 19);
  assert.deepEqual(
    facts.tiers.map((t) => [t.label, t.funds, t.percent]),
    [["Core", 6, 32], ["Sphere", 6, 32], ["Tier 3", 4, 21], ["Tier 4", 2, 11]],
  );
  assert.deepEqual(facts.broad, { funds: 1, percent: 5 });
  // At most five Core funds, best first, never the excluded one, a broad investor or a hidden duplicate.
  assert.ok(facts.named.length <= NAMED_CORE_MAX);
  assert.deepEqual(facts.named.map((f) => f.name), ["Fund 2", "Fund 3", "Fund 4", "Fund 5", "Fund 6"]);
  assert.equal(facts.named[0].facts, "VC · Boston, MA. Matched on stage: Seed; sector: Fintech.");
});

test("verification: valid of checked, with its definition, date and sample", () => {
  const text = listFactsText(listFacts(list()), { months: 3, fundsRequired: 340, planned: 289 });
  assert.match(text, /33 of 38 email addresses checked were verified deliverable \(87%\)/);
  assert.match(text, /Checked 2026-10-20, on a sample of 40 contacts/);
  assert.match(text, /does not guarantee that an email is delivered, read or answered/);
  assert.match(text, /planned for 3 months, and the outreach can work through 340 firms/);
  assert.match(text, new RegExp(`${BROAD_LABEL}: 1 \\(5%\\)`));
  // No results: the email is told not to mention checks, and no figure appears.
  const bare = { ...list(), verification: { verification_ran: false } };
  const without = listFactsText(listFacts(bare), null);
  assert.match(without, /No verification results for this list. Do not mention email checks./);
  assert.doesNotMatch(without, /verified deliverable \(/);
  assert.doesNotMatch(without, /Why this number/);
});

test("nothing internal reaches the email's facts", () => {
  const withInternals = list();
  withInternals.rows[1] = { ...withInternals.rows[1], why: "internal score 92", comments: "Rupert: weak partner", hidden_duplicate: undefined };
  const text = listFactsText(listFacts(withInternals), null);
  assert.doesNotMatch(text, /internal score|weak partner|Hidden duplicate/);
  // No Core funds on the list: the email names none.
  const noCore = { ...list(), rows: list().rows.filter((r) => r.tier !== 1) };
  assert.match(listFactsText(listFacts(noCore), null), /None: do not name any fund./);
});

test("the founder list email uses these facts and the managed prompt; it is only ever a draft", () => {
  const agents = read("lib/agents-server.ts");
  const fn = agents.slice(agents.indexOf("export async function draftInvestorListEmail("), agents.indexOf("// Outreach narrative"));
  assert.match(fn, /loadPrompt\(supabase, "investor_list_email"/);
  assert.match(fn, /listFactsText\(listFacts\(list\), plan\)/);
  assert.match(fn, /return draftEmailMiddle\(promptSystem\(prompt\.value\), context\);/);
  // The migration loads the new text only over the unedited old default.
  const sql = read("supabase/founder_list_email_prompt.sql");
  assert.ok(sql.includes(`$rupert_prompt$${promptDefinition("investor_list_email").defaultText}$rupert_prompt$`));
  assert.match(sql, /if btrim\(v_active\) <> btrim\(v_old\) then/);
});
