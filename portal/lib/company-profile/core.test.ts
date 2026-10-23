import assert from "node:assert/strict";
import { test } from "node:test";
import { indexTaxonomy, rawKey, type TaxAlias, type TaxNode } from "../taxonomy/core.ts";
import {
  answerList,
  applyAiClassification,
  confirmWithFounder,
  founderTranscript,
  fromEngineProfile,
  matchingProfile,
  openBuildProblems,
  reconcile,
  sectorAnswers,
  setSectors,
  validateProfile,
  verifyQuote,
  type AnswerLists,
  type EngineProfileView,
} from "./core.ts";
import { classificationRules, interviewGuide } from "./prompt.ts";

// --- a small taxonomy shaped like the seeded one --------------------------------
function node(id: string, dimension: TaxNode["dimension"], label: string, kind: string, attrs = {}, status: TaxNode["status"] = "active"): TaxNode {
  return { id, dimension, label, parentId: null, kind, description: "", synonyms: [], attrs, status, sort: 0 };
}
function alias(field: TaxAlias["field"], value: string, nodeId: string): TaxAlias {
  return {
    field, rawKey: rawKey(value), rawValue: value, nodeIds: [nodeId], state: "mapped", review: "approved", method: "seed",
    rationale: "", aiProposal: null, reviewedBy: null, reviewedAt: null, updatedAt: "",
  };
}
const nodes = [
  node("sector.grp.financial", "sector", "Financial services", "group"),
  node("sector.fintech", "sector", "Fintech", "sector", { granularity: "specific" }),
  node("sector.insurtech", "sector", "Insurtech", "sector", { granularity: "specific" }),
  node("sector.saas", "sector", "SaaS", "sector", { granularity: "specific" }),
  node("sector.healthtech", "sector", "Healthtech", "sector", { granularity: "specific" }),
  node("sector.financial_services", "sector", "Financial Services", "sector", { granularity: "broad" }),
  node("sector.software", "sector", "Software", "sector", { granularity: "broad" }),
  node("sector.diversified", "sector", "Diversified", "generalist", { granularity: "broad" }),
  node("sector.old", "sector", "Old", "sector", {}, "retired"),
  node("sector.new_admin", "sector", "Brand New", "sector"),
  node("stage.seed", "stage", "Seed", "stage"),
  node("stage.series_a", "stage", "Series A", "stage"),
  node("geo.us", "geography", "United States", "country"),
  node("geo.canada", "geography", "Canada", "country"),
  node("geo.europe", "geography", "Europe", "region"),
  node("geo.us.state.texas", "geography", "Texas", "us_state"),
  node("financing.equity", "financing", "Equity", "financing"),
  node("firm_type.vc", "firm_type", "Venture capital firm", "firm_type"),
];
const aliases = [
  alias("vertical", "Fintech", "sector.fintech"),
  alias("vertical", "Insurtech", "sector.insurtech"),
  alias("vertical", "SaaS", "sector.saas"),
  alias("vertical", "Healthtech", "sector.healthtech"),
  alias("industry", "Financial Services", "sector.financial_services"),
  alias("industry", "Software", "sector.software"),
  alias("industry", "Diversified", "sector.diversified"),
  alias("stage", "Seed", "stage.seed"),
  alias("stage", "Series A", "stage.series_a"),
  alias("hq_country", "United States", "geo.us"),
  alias("hq_country", "Canada", "geo.canada"),
  alias("geography", "Europe", "geo.europe"),
  alias("hq_state", "Texas", "geo.us.state.texas"),
  alias("financing", "Equity", "financing.equity"),
  alias("firm_type", "Venture Capital Investment Firm", "firm_type.vc"),
];
const index = indexTaxonomy({ revision: 42, nodes, aliases, edges: [] });

function engine(extra: Partial<EngineProfileView> = {}): EngineProfileView {
  return {
    name: "Ledgerly", web: "ledgerly.io", oneliner: "Accounts payable automation for clinics", model: "B2B",
    stage: "Seed", raise: "$2M", instruments: ["Equity"], firmTypes: null,
    verticals: ["Fintech", "SaaS"], industries: ["Financial Services", "Software"],
    country: "United States", city: "Austin", markets: ["Europe"], exclusions: "", ...extra,
  };
}
const lists: AnswerLists = { existingInvestors: [], alreadyPitched: [], noGo: [], competitors: ["Bill.com"], explicitIndustries: false, hqState: "Texas" };
const meta = { basis: "b1", interviewAt: null, source: "legacy" as const, converterWarnings: [] };

// --- a sample intake -------------------------------------------------------------
const messages = [
  { role: "assistant", content: "What does Ledgerly do, and who pays for it?" },
  { role: "user", content: "We build accounts-payable automation software. Our customers are mostly dental and medical clinics, but we’re a fintech company — we move the money." },
  { role: "assistant", content: "Got it. Are you raising a seed round?" },
  { role: "user", content: "Yes, a $2M seed round. We're based in Austin, Texas, USA." },
];
const transcript = founderTranscript(messages);

const aiOutput = {
  product: "Accounts-payable automation software that also moves the payments.",
  product_evidence: ["We build accounts-payable automation software"],
  business_model: "B2B",
  customers: "Dental and medical clinics.",
  customers_evidence: ["Our customers are mostly dental and medical clinics"],
  not_company_sectors: [{ label: "Healthtech", reason: "Clinics are the customers; Ledgerly does not build health products." }],
  primary_sector: {
    node_id: "sector.fintech", founder_stated: true,
    evidence: ["we're a fintech company — we move the money"],
    rationale: "The founder calls the company a fintech that moves the money; payments are the core of the product.",
    confidence: "high",
  },
  secondary_sectors: [
    {
      node_id: "sector.saas", founder_stated: false,
      evidence: ["We build accounts-payable automation software"],
      rationale: "The product is delivered as automation software sold to businesses, which is SaaS.",
      confidence: "medium",
    },
  ],
  stage: {
    node_id: "stage.seed", founder_stated: true, evidence: ["Yes, a $2M seed round"],
    rationale: "The founder says they are raising a $2M seed round.", confidence: "high",
  },
  hq_country: {
    node_id: "geo.us", founder_stated: true, evidence: ["We're based in Austin, Texas, USA"],
    rationale: "The founder says the company is based in Austin, Texas, USA.", confidence: "high",
  },
  ambiguities: [],
};

test("quotes are checked against the founder's own messages", () => {
  assert.equal(verifyQuote("we're a fintech company", transcript), true); // curly apostrophe in the source
  assert.equal(verifyQuote("WE BUILD accounts-payable automation software.", transcript), true);
  assert.equal(verifyQuote("accounts-payable automation … move the money", transcript), true);
  assert.equal(verifyQuote("move the money … accounts-payable automation", transcript), false); // wrong order
  assert.equal(verifyQuote("Are you raising a seed round", transcript), false); // Rupert's words, not the founder's
  assert.equal(verifyQuote("we are a payments platform", transcript), false);
  assert.equal(verifyQuote("fintech", transcript), false); // too short to prove anything
});

test("a legacy profile converts to categories, with no evidence, and stays unconfirmed", () => {
  const profile = fromEngineProfile(engine(), lists, index, meta);
  assert.deepEqual(profile.sectors.map((s) => [s.nodeId, s.role, s.source]), [
    ["sector.fintech", "primary", "legacy"],
    ["sector.saas", "secondary", "legacy"],
  ]); // derived industries are not the company's sectors
  assert.equal(profile.stage?.nodeId, "stage.seed");
  assert.equal(profile.hq.state?.nodeId, "geo.us.state.texas");
  assert.deepEqual(profile.markets.map((m) => m.nodeId), ["geo.europe"]);
  const { readiness, issues } = validateProfile(profile, index);
  assert.equal(readiness, "limited");
  assert.ok(issues.some((i) => i.message.includes("Legacy profile")));
});

test("explicit industries count; generalist markers never become a sector", () => {
  const profile = fromEngineProfile(engine({ verticals: [], industries: ["Diversified", "Software"] }), { ...lists, explicitIndustries: true }, index, meta);
  assert.deepEqual(profile.sectors.map((s) => s.nodeId), ["sector.software"]);
});

test("missing information blocks", () => {
  const profile = fromEngineProfile(engine({ verticals: [], industries: [], stage: "", country: "" }), lists, index, meta);
  const { readiness, issues } = validateProfile(profile, index);
  assert.equal(readiness, "blocked");
  assert.deepEqual(issues.filter((i) => i.severity === "blocking").map((i) => i.field).sort(), ["HQ country", "Primary sector", "Stage"]);
});

test("a sample intake becomes a profile Phase 3 can use without string matching", () => {
  const base = fromEngineProfile(engine(), lists, index, { ...meta, source: "ai" });
  const { profile, problems } = applyAiClassification(base, aiOutput, index, transcript);
  assert.deepEqual(problems, []);
  const primary = profile.sectors[0];
  assert.equal(primary.source, "founder");
  assert.equal(primary.status, "accepted");
  assert.ok(primary.evidence.every((e) => e.verified));
  assert.equal(profile.sectors[1].source, "ai");
  assert.equal(profile.business.notCompanySectors[0].label, "Healthtech");
  const m = matchingProfile(profile, index);
  assert.equal(m.primarySector, "sector.fintech");
  assert.deepEqual(m.secondarySectors, ["sector.saas"]);
  assert.equal(m.stage, "stage.seed");
  assert.equal(m.hqCountry, "geo.us");
  assert.equal(m.hqState, "geo.us.state.texas");
  // The founder named the state ("Austin, Texas, USA"), so it needs no confirming.
  assert.equal(profile.hq.state?.status, "accepted");
  assert.equal(m.readiness, "ready");
});

test("a state the founder never named needs confirming, and confirming it settles it", () => {
  const silent = founderTranscript([
    ...messages.slice(0, 3),
    { role: "user", content: "Yes, a $2M seed round. We're based in the United States." },
  ]);
  const base = fromEngineProfile(engine(), lists, index, { ...meta, source: "ai" });
  const { profile } = applyAiClassification(base, {
    ...aiOutput,
    hq_country: { ...aiOutput.hq_country, evidence: ["We're based in the United States"] },
  }, index, silent);
  const m = matchingProfile(profile, index);
  assert.equal(m.readiness, "limited");
  assert.ok(m.issues.some((i) => i.field === "HQ state" && i.severity === "limited"));
  const confirmed = confirmWithFounder(profile, "hq_state", "admin@x.com", "2026-10-21T00:00:00Z")!;
  assert.equal(matchingProfile(confirmed, index).readiness, "ready");
});

test("what the founder's shared files say counts as evidence", () => {
  const withFiles = founderTranscript([
    { role: "assistant", content: "Could you share your deck?" },
    {
      role: "user",
      content: "Here it is.",
      attachments: [{ facts: "Ledgerly: B2B SaaS priced per dock door per month. Seed round of $2M." }],
    },
  ]);
  assert.equal(verifyQuote("B2B SaaS priced per dock door per month", withFiles), true);
  assert.equal(verifyQuote("Could you share your deck", withFiles), false); // still never Rupert's words
});

test("confirming a sector with the founder clears its unfound quotes", () => {
  const base = fromEngineProfile(engine(), lists, index, { ...meta, source: "ai" });
  const { profile, problems } = applyAiClassification(base, {
    ...aiOutput,
    primary_sector: { ...aiOutput.primary_sector, evidence: ["we are the leading payments platform for clinics"] },
  }, index, transcript);
  const confirmed = confirmWithFounder(profile, "sector:sector.fintech", "admin@x.com", "2026-10-21T00:00:00Z")!;
  const { issues } = validateProfile(confirmed, index, openBuildProblems(confirmed, problems));
  assert.ok(!issues.some((i) => i.field === "Primary sector"));
});

test("markets and investor types left empty add no notes", () => {
  const profile = fromEngineProfile(engine({ markets: [] }), lists, index, meta);
  const { issues } = validateProfile(profile, index);
  assert.ok(!issues.some((i) => i.field === "Markets" || i.field === "Investor types"));
});

test("an unverifiable 'founder' claim becomes an AI interpretation that needs confirmation", () => {
  const base = fromEngineProfile(engine(), lists, index, { ...meta, source: "ai" });
  const { profile, problems } = applyAiClassification(base, {
    ...aiOutput,
    primary_sector: { ...aiOutput.primary_sector, evidence: ["we are the leading payments platform for clinics"] },
  }, index, transcript);
  assert.equal(profile.sectors[0].source, "ai");
  assert.equal(profile.sectors[0].status, "needs_confirmation");
  assert.ok(problems.some((p) => p.message.includes("no supplied quote was found")));
  const { readiness, issues } = validateProfile(profile, index, problems);
  assert.equal(readiness, "limited");
  assert.ok(issues.some((i) => i.message.startsWith("Quote not found")));
});

test("ambiguous sectors: low confidence or missing reasoning needs confirmation", () => {
  const base = fromEngineProfile(engine(), lists, index, { ...meta, source: "ai" });
  const { profile } = applyAiClassification(base, {
    ...aiOutput,
    primary_sector: { ...aiOutput.primary_sector, confidence: "low" },
    secondary_sectors: [{ node_id: "sector.insurtech", evidence: [], rationale: "", confidence: "low" }],
    ambiguities: [{ topic: "sector", question: "Do you also underwrite payment risk?" }],
  }, index, transcript);
  const { readiness, issues } = validateProfile(profile, index);
  assert.equal(readiness, "limited");
  assert.ok(issues.some((i) => i.message.includes("Fintech: needs confirmation")));
  assert.ok(issues.some((i) => i.message.includes("Insurtech: a secondary sector needs its own founder evidence")));
  assert.ok(issues.some((i) => i.message === "Do you also underwrite payment risk?"));
});

test("invalid taxonomy references are rejected or block", () => {
  const base = fromEngineProfile(engine({ verticals: [], industries: [] }), lists, index, { ...meta, source: "ai" });
  const bad = applyAiClassification(base, {
    ...aiOutput,
    primary_sector: { ...aiOutput.primary_sector, node_id: "sector.crypto_made_up" },
    secondary_sectors: [aiOutput.secondary_sectors[0], { node_id: "sector.grp.financial" }, { node_id: "sector.diversified" }],
  }, index, transcript);
  assert.equal(bad.profile.sectors.some((s) => s.role === "primary"), false);
  assert.ok(bad.problems.some((p) => p.severity === "blocking" && p.message.includes("sector.crypto_made_up")));
  assert.ok(bad.problems.some((p) => p.message.includes("only the first 2")));
  assert.equal(validateProfile(bad.profile, index, bad.problems).readiness, "blocked");

  // With a sector already in the profile fields, that one is kept, unconfirmed.
  const withFields = fromEngineProfile(engine(), lists, index, { ...meta, source: "ai" });
  const kept = applyAiClassification(withFields, { ...aiOutput, primary_sector: { node_id: "sector.made_up" } }, index, transcript);
  assert.equal(kept.profile.sectors[0].nodeId, "sector.fintech");
  assert.equal(kept.profile.sectors[0].status, "needs_confirmation");
  assert.ok(kept.problems.every((p) => p.severity !== "blocking"));

  const retired = { ...withFields, sectors: [{ ...withFields.sectors[0], nodeId: "sector.old", label: "Old" }] };
  assert.ok(validateProfile(retired, index).issues.some((i) => i.severity === "blocking" && i.message.includes("not a valid")));
});

test("multi-sector profiles give the engine its labels, primary first", () => {
  const base = fromEngineProfile(engine(), lists, index, { ...meta, source: "ai" });
  const set = setSectors(base, index, {
    primary: "sector.fintech", secondary: ["sector.financial_services", "sector.new_admin"],
    rationale: "Payments company; the broad industry and the new category both describe it.",
  }, "admin@x.com");
  assert.ok(set.ok);
  if (!set.ok) return;
  const answers = sectorAnswers(set.profile, index);
  assert.deepEqual(answers.verticals, ["Fintech"]);
  assert.deepEqual(answers.industries, ["Financial Services"]);
  assert.deepEqual(answers.unusable, ["Brand New"]);
  assert.equal(set.profile.sectors[2].source, "admin");
});

test("admin sector changes are validated", () => {
  const base = fromEngineProfile(engine(), lists, index, meta);
  const tooMany = setSectors(base, index, { primary: "sector.fintech", secondary: ["sector.saas", "sector.insurtech", "sector.healthtech"], rationale: "x".repeat(30) }, null);
  assert.equal(tooMany.ok, false);
  const noReason = setSectors(base, index, { primary: "sector.saas", secondary: [], rationale: "" }, null);
  assert.equal(noReason.ok, false);
  const generalist = setSectors(base, index, { primary: "sector.diversified", secondary: [], rationale: "x".repeat(30) }, null);
  assert.equal(generalist.ok, false);
});

test("edits outside the classification keep evidence for unchanged categories", () => {
  const base = fromEngineProfile(engine(), lists, index, { ...meta, source: "ai" });
  const built = applyAiClassification(base, aiOutput, index, transcript).profile;
  const edited = fromEngineProfile(engine({ verticals: ["Fintech", "Insurtech"] }), lists, index, meta);
  const merged = reconcile(built, edited, "admin@x.com");
  assert.equal(merged.sectors[0].source, "founder");
  assert.equal(merged.sectors[0].evidence.length, 1);
  assert.equal(merged.sectors[1].nodeId, "sector.insurtech");
  assert.equal(merged.sectors[1].source, "admin");
  assert.equal(merged.business.product?.text, built.business.product?.text);
});

test("confirming with the founder clears the need to confirm", () => {
  const profile = fromEngineProfile(engine(), lists, index, meta);
  const confirmed = confirmWithFounder(confirmWithFounder(profile, "sector:sector.fintech", "a@x.com", "2026-10-21")!, "stage", "a@x.com", "2026-10-21")!;
  assert.equal(confirmed.sectors[0].status, "confirmed_founder");
  assert.equal(confirmed.sectors[0].source, "legacy"); // who decided is unchanged
  assert.ok(!validateProfile(confirmed, index).issues.some((i) => i.message.startsWith("Fintech: needs confirmation")));
  assert.equal(confirmWithFounder(profile, "sector:sector.unknown", null, ""), null);
});

test("answer lists treat 'none' as empty", () => {
  assert.deepEqual(answerList("none"), []);
  assert.deepEqual(answerList("Acme Ventures\nBeta Capital; Gamma"), ["Acme Ventures", "Beta Capital", "Gamma"]);
});

test("build problems stay open only until the classification is decided", () => {
  const base = fromEngineProfile(engine(), lists, index, meta);
  const problems = [
    { field: "Primary sector", severity: "limited" as const, message: "AI category invalid" },
    { field: "Stage", severity: "limited" as const, message: "stage unclear" },
  ];
  assert.equal(openBuildProblems(base, problems).length, 2);
  const confirmed = confirmWithFounder(base, "sector:sector.fintech", "a@x.com", "2026-10-21")!;
  assert.deepEqual(openBuildProblems(confirmed, problems).map((p) => p.field), ["Stage"]);
});

test("the interview guide and AI rules only offer real categories", () => {
  const rules = classificationRules(index);
  assert.ok(rules.includes("sector.fintech: Fintech"));
  assert.ok(!rules.includes("sector.diversified"));
  assert.ok(!rules.includes("sector.grp.financial"));
  assert.ok(!rules.includes("sector.old"));
  const guide = interviewGuide(index);
  assert.ok(guide.includes("Fintech") && guide.includes("not healthtech"));
  assert.ok(interviewGuide(null).includes("Never widen"));
});
