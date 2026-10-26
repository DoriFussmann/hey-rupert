import assert from "node:assert/strict";
import { test } from "node:test";
import { previewEmail } from "./preview.ts";
import type { TypedGroupCopy } from "./copy.ts";

const group: TypedGroupCopy = {
  type: "VC",
  funds: 3,
  style: { id: "direct", label: "Direct", max_words: 80 },
  approach: "",
  emails: [
    { subject: "Vault Extracts for {{fund_name}}", body: "Hi {{first_name}},\n\n{{tier_line}}\n\nJohn" },
    { subject: "", body: "More for {{fund_name}}.\n\nJohn" },
    { subject: "", body: "Last.\n\nJohn" },
  ],
  tier_lines: { "2": "{{fund_name}} backs CPG brands next to ours.", "3": "Broader." },
};

const text = (segments: { text: string }[]) => segments.map((s) => s.text).join("");

test("fills the lead's details, the tier line for their tier, and the opt-out on email 1", () => {
  const lead = { first_name: "Ana", person_name: "Ana Lopez", fund_name: "North Fund", tier: 2 as const, quick_fact: null };
  const out = previewEmail(group, "others", 0, lead, "Not relevant? Tell me.");
  assert.equal(text(out.subject), "Vault Extracts for North Fund");
  assert.equal(text(out.body), "Hi Ana,\n\nNorth Fund backs CPG brands next to ours.\n\nJohn\n\nNot relevant? Tell me.");
  assert.ok(out.body.some((s) => s.field === "tier_line" && !s.missing));
  assert.equal(text(previewEmail(group, "others", 1, lead, "Opt").body), "More for North Fund.\n\nJohn");
});

test("a missing value is shown, marked, not silently blank", () => {
  const lead = { first_name: "", person_name: "", fund_name: "South VC", tier: 1 as const, quick_fact: null };
  const core = { ...group, emails: [{ subject: "s", body: "Hi {{first_name}},\n\n{{quick_fact}}.\n\nJohn" }, group.emails[1], group.emails[2]] };
  const out = previewEmail(core, "core", 0, lead, "");
  const missing = out.body.filter((s) => s.missing).map((s) => s.field);
  assert.deepEqual(missing, ["first_name", "quick_fact"]);
  const written = previewEmail(core, "core", 0, { ...lead, first_name: "Sam", quick_fact: "You led Acme's seed in 2025" }, "");
  assert.equal(text(written.body), "Hi Sam,\n\nYou led Acme's seed in 2025.\n\nJohn");
});
