import assert from "node:assert/strict";
import { test } from "node:test";
import RME from "../engine/index.mjs";
import { onlyLabels, pickContacts, splitName, toContacts, toFirm, type AddedFund } from "./core.ts";

const person = (email: string, position: string, confidence: number | null = 90) => ({ email, position, confidence });

test("contacts: investing people first (decision makers, then champions), operations and advisors never, at most 5", () => {
  const picked = pickContacts(
    [
      person("ops@x.vc", "Head of Operations"),
      person("assoc@x.vc", "Associate", 99),
      person("gp@x.vc", "General Partner", 70),
      person("vp@x.vc", "Vice President", 95),
      person("ir@x.vc", "Investor Relations Manager"),
      person("gp@x.vc", "General Partner", 70),
      person("p2@x.vc", "Partner", 99),
      person("a@x.vc", "Principal"),
      person("b@x.vc", "Analyst"),
      person("c@x.vc", ""),
    ],
    RME.roleOf,
  );
  assert.equal(picked.length, 5);
  // The engine's own role order: every decision maker before any champion, by Hunter's confidence within a role.
  const order = ["decision", "champion", "scout", "other"];
  const ranks = picked.map((p) => order.indexOf(RME.roleOf(p.position)));
  assert.deepEqual(ranks, [...ranks].sort((a, b) => a - b), JSON.stringify(picked));
  assert.equal(RME.roleOf(picked[0].position), "decision");
  assert.ok(!picked.some((p) => p.email === "ops@x.vc" || p.email === "ir@x.vc"));
  assert.equal(new Set(picked.map((p) => p.email)).size, 5);
});

test("labels: only the taxonomy's, spelled its way; names split", () => {
  assert.deepEqual(onlyLabels(["seed", "Series A", "Pre-seed", "Mega round"], ["Pre-Seed", "Seed", "Series A"]), ["Seed", "Series A", "Pre-Seed"]);
  assert.deepEqual(onlyLabels("Seed", ["Seed"]), []);
  assert.deepEqual(splitName("Jean de La Rochebrochard"), { first: "Jean", last: "de La Rochebrochard" });
  assert.deepEqual(splitName("Cher"), { first: "Cher", last: "" });
});

const fund: AddedFund = {
  id: "u1",
  firmId: "RUP-ABC12345",
  name: "Footwork",
  kind: "fund",
  status: "approved",
  website: "https://footwork.vc/",
  description: "",
  hqCity: "San Francisco",
  hqCountry: "United States",
  foundedYear: 2021,
  firmType: "Venture capital firm",
  stages: ["Seed", "Series A"],
  geographies: ["United States"],
  industries: ["Software"],
  verticals: ["AI/ML"],
  financing: [],
  contacts: [
    { first: "Nikhil", last: "Basu Trivedi", title: "General Partner", email: "nikhil@footwork.vc", confidence: 95, linkedin: "", source: "hunter_domain" },
    { first: "No", last: "Email", title: "Partner", email: "", confidence: null, linkedin: "", source: "research" },
  ],
  sources: [],
  notes: "",
  foundForClient: null,
  landscapeId: null,
  investorId: null,
  createdBy: null,
  createdAt: "",
  reviewedBy: null,
  reviewedAt: null,
  reviewNote: "",
};

test("an approved fund as a database record: raw values the taxonomy maps; Equity when financing is empty; contacts with an email only", () => {
  const rawFor = (field: string, label: string) => (field === "firm_type" && label === "Venture capital firm" ? "Venture Capital Investment Firm" : label);
  const firm = toFirm(fund, rawFor);
  assert.equal(firm.id, "RUP-ABC12345");
  assert.equal(firm.type, "Venture Capital Investment Firm");
  assert.deepEqual(firm.stages, ["Seed", "Series A"]);
  assert.deepEqual(firm.fin, ["Equity"]);
  assert.equal(firm.web, "https://footwork.vc/");
  const contacts = toContacts(fund);
  assert.equal(contacts.length, 1);
  assert.equal(contacts[0].fid, "RUP-ABC12345");
});

test("a fund's own website: platforms (LinkedIn, Crunchbase…) are never one", async () => {
  const { ownSite } = await import("./core.ts");
  assert.equal(ownSite("https://www.linkedin.com/in/someone"), "");
  assert.equal(ownSite("crunchbase.com/organization/footwork"), "");
  assert.equal(ownSite("https://uk.linkedin.com/company/x"), "");
  assert.equal(ownSite("footwork.vc"), "https://footwork.vc/");
  assert.equal(ownSite("not a url"), "");
});

test("raw values: the alias that maps only to the label's category wins; the label itself when there is none", async () => {
  const { rawForFn } = await import("./core.ts");
  const { indexTaxonomy, rawKey } = await import("../../taxonomy/core.ts");
  const node = (id: string, dimension: "sector" | "stage", label: string, kind = "sector") =>
    ({ id, dimension, label, parentId: null, kind, description: "", synonyms: [], attrs: {}, status: "active" as const, sort: 0 });
  const alias = (field: "vertical" | "stage", value: string, nodeIds: string[], review: "approved" | "needs_review" = "approved") => ({
    field, rawKey: rawKey(value), rawValue: value, nodeIds, state: "mapped" as const, review, method: "seed" as const,
    rationale: "", aiProposal: null, reviewedBy: null, reviewedAt: null, updatedAt: "",
  });
  const index = indexTaxonomy({
    revision: 1,
    nodes: [node("sector.fintech", "sector", "Fintech"), node("sector.insurtech", "sector", "Insurtech"), node("stage.seed", "stage", "Seed", "stage")],
    aliases: [
      alias("vertical", "Fintech & Insurtech", ["sector.fintech", "sector.insurtech"]),
      alias("vertical", "FinTech (Financial Technology)", ["sector.fintech"]),
      alias("stage", "Seed Round", ["stage.seed"], "needs_review"),
    ],
    edges: [],
  });
  const rawFor = rawForFn(index);
  // Not the combined value, which would also tag Insurtech.
  assert.equal(rawFor("vertical", "Fintech"), "FinTech (Financial Technology)");
  // Only a needs-review alias: the label itself.
  assert.equal(rawFor("stage", "Seed"), "Seed");
  assert.equal(rawFor("vertical", "Nothing"), "Nothing");
});
