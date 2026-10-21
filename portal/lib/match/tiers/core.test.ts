import assert from "node:assert/strict";
import { test } from "node:test";
import RME, { type Contact, type Firm, type FundDb, type MatchProfile } from "../engine/index.mjs";
import type { MatchingProfile } from "../../company-profile/core.ts";
import { indexTaxonomy, rawKey, type TaxAlias, type TaxEdge, type TaxNode, type Taxonomy } from "../../taxonomy/core.ts";
import {
  RULES_VERSION,
  blockedReason,
  containers,
  profileWarnings,
  runTiers,
  tierFor,
  type FirmOutcome,
  type FofException,
  type TierRunInput,
} from "./core.ts";
import type { StoredResult } from "./stored.ts";
import { appliedGroups, duplicateFlags, findDuplicates, identityProposals, normalizedName, resolveIdentities } from "./duplicates.ts";
import { NEAR_MISS_BANNER, contactRows, fundRows, nearMissRows, outsideRows, runFacts, storedCounts, type ContactStates } from "./export.ts";
import { tierRows } from "./record.ts";
import { distinctPeople, firmsByRowKey, fourTierClientList, reachablePeople } from "./client-list.ts";
import { clientFacingList } from "../client-list-dedupe.ts";
import { asInvestorList, investorListForClient } from "../../setup.ts";

// ---------------------------------------------------------------------------
// A small taxonomy shaped like the real one

function node(id: string, dimension: TaxNode["dimension"], kind: string, parentId: string | null = null, attrs: Record<string, unknown> = {}): TaxNode {
  return { id, dimension, label: id, parentId, kind, description: "", synonyms: [], attrs, status: "active", sort: 0 };
}

const labels: Record<string, string> = {
  "sector.fintech": "Fintech",
  "sector.insurtech": "Insurtech",
  "sector.blockchain": "Blockchain",
  "sector.proptech": "Proptech",
  "sector.healthtech": "Healthtech",
  "sector.financial_services": "Financial Services",
  "sector.software": "Software",
  "sector.cannabis": "Cannabis",
  "sector.consumer_tech": "Consumer Tech",
  "sector.consumer_products": "Consumer Products & Services",
  "sector.climate_tech": "Climate Tech",
  "sector.cleantech": "Cleantech",
  "sector.diversified": "Diversified",
  "stage.pre_seed": "Pre-Seed",
  "stage.seed": "Seed",
  "stage.series_a": "Series A",
  "stage.series_b": "Series B",
  "geo.north_america": "North America",
  "geo.europe": "Europe",
  "geo.europe_western": "Europe (Western)",
  "geo.europe_central": "Europe (Central)",
  "geo.asia": "Asia",
  "geo.us": "United States",
  "geo.canada": "Canada",
  "geo.uk": "United Kingdom",
  "geo.germany": "Germany",
  "geo.france": "France",
  "geo.us.california": "United States (California)",
  "geo.us.northeast": "United States (Northeast)",
  "geo.us.southwest": "United States (Southwest)",
  "geo.us.state.california": "California",
  "geo.us.state.texas": "Texas",
  "geo.us.state.new_york": "New York",
  "geo.us.puerto_rico": "Puerto Rico",
  "financing.equity": "Equity",
  "financing.debt": "Debt",
  "financing.fund_of_funds": "Fund of funds",
  "firm_type.vc": "Venture Capital Investment Firm",
  "firm_type.pe": "Private Equity Investment Firm",
  "firm_type.family_office": "Family Investment Office",
  "firm_type.angel_group": "Angel Investor Group",
};

const nodes: TaxNode[] = [
  ...["fintech", "insurtech", "blockchain", "proptech", "healthtech", "cannabis", "consumer_tech", "climate_tech", "cleantech"].map((s) => node(`sector.${s}`, "sector", "sector")),
  node("sector.financial_services", "sector", "sector"),
  node("sector.software", "sector", "sector"),
  node("sector.consumer_products", "sector", "sector"),
  node("sector.diversified", "sector", "generalist"),
  node("stage.pre_seed", "stage", "stage", null, { ladder: 1 }),
  node("stage.seed", "stage", "stage", null, { ladder: 2 }),
  node("stage.series_a", "stage", "stage", null, { ladder: 3 }),
  node("stage.series_b", "stage", "stage", null, { ladder: 4 }),
  node("geo.north_america", "geography", "region"),
  node("geo.europe", "geography", "region"),
  node("geo.asia", "geography", "region"),
  node("geo.europe_western", "geography", "subregion", "geo.europe"),
  node("geo.europe_central", "geography", "subregion", "geo.europe"),
  node("geo.us", "geography", "country", "geo.north_america"),
  node("geo.canada", "geography", "country", "geo.north_america"),
  node("geo.uk", "geography", "country", "geo.europe_western"),
  node("geo.france", "geography", "country", "geo.europe_western"),
  node("geo.germany", "geography", "country", "geo.europe_western", { memberOf: ["geo.europe_central"] }),
  node("geo.us.california", "geography", "us_region", "geo.us"),
  node("geo.us.northeast", "geography", "us_region", "geo.us"),
  node("geo.us.southwest", "geography", "us_region", "geo.us"),
  node("geo.us.state.california", "geography", "us_state", "geo.us.california"),
  node("geo.us.state.texas", "geography", "us_state", "geo.us.southwest"),
  node("geo.us.state.new_york", "geography", "us_state", "geo.us.northeast"),
  node("geo.us.puerto_rico", "geography", "us_territory", "geo.us"),
  node("financing.equity", "financing", "financing"),
  node("financing.debt", "financing", "financing"),
  node("financing.fund_of_funds", "financing", "financing"),
  node("firm_type.vc", "firm_type", "firm_type"),
  node("firm_type.pe", "firm_type", "firm_type"),
  node("firm_type.family_office", "firm_type", "firm_type"),
  node("firm_type.angel_group", "firm_type", "firm_type"),
].map((n) => ({ ...n, label: labels[n.id] ?? n.id }));

function alias(field: TaxAlias["field"], value: string, nodeIds: string[], extra: Partial<TaxAlias> = {}): TaxAlias {
  return {
    field, rawKey: rawKey(value), rawValue: value, nodeIds, state: nodeIds.length ? "mapped" : "unmapped",
    review: "approved", method: "seed", rationale: "", aiProposal: null, reviewedBy: null, reviewedAt: null, updatedAt: "", ...extra,
  };
}

const sectorVerticals = ["fintech", "insurtech", "blockchain", "proptech", "healthtech", "cannabis", "consumer_tech", "climate_tech", "cleantech"];
const aliases: TaxAlias[] = [
  ...sectorVerticals.map((s) => alias("vertical", labels[`sector.${s}`], [`sector.${s}`])),
  alias("industry", "Financial Services", ["sector.financial_services"]),
  alias("industry", "Software", ["sector.software"]),
  alias("industry", "Consumer Products & Services", ["sector.consumer_products"]),
  alias("industry", "Diversified", ["sector.diversified"]),
  alias("vertical", "Neobanking", ["sector.fintech"], { review: "needs_review", method: "manual" }),
  alias("stage", "Pre-Seed", ["stage.pre_seed"]),
  alias("stage", "Seed", ["stage.seed"]),
  alias("stage", "Series A", ["stage.series_a"]),
  alias("stage", "Series B", ["stage.series_b"]),
  alias("stage", "Early Stage", ["stage.seed", "stage.series_a"]),
  alias("stage", "Seedish", ["stage.seed"], { review: "needs_review", method: "manual" }),
  ...["geo.north_america", "geo.europe", "geo.asia", "geo.europe_western", "geo.europe_central", "geo.us", "geo.canada", "geo.uk", "geo.france", "geo.germany", "geo.us.california", "geo.us.northeast", "geo.us.southwest"].map((id) =>
    alias("geography", labels[id], [id]),
  ),
  alias("geography", "Global", [], { state: "ignored" }),
  alias("geography", "Nordics-ish", ["geo.europe"], { review: "needs_review", method: "manual" }),
  ...["geo.us", "geo.canada", "geo.uk", "geo.france", "geo.germany"].map((id) => alias("hq_country", labels[id], [id])),
  alias("hq_state", "California", ["geo.us.state.california"]),
  alias("hq_state", "Texas", ["geo.us.state.texas"]),
  alias("financing", "Equity", ["financing.equity"]),
  alias("financing", "Debt", ["financing.debt"]),
  alias("financing", "Fund of Funds", ["financing.fund_of_funds"]),
  ...["firm_type.vc", "firm_type.pe", "firm_type.family_office", "firm_type.angel_group"].map((id) => alias("firm_type", labels[id], [id])),
];

function edge(fromId: string, toId: string, relation: TaxEdge["relation"], extra: Partial<TaxEdge> = {}): TaxEdge {
  return {
    id: `${fromId}>${toId}`, fromId, toId, relation, directed: false, origin: "seed", review: "approved",
    rationale: `${fromId} to ${toId}`, source: "", context: "", reviewedBy: "a@x.com", reviewedAt: "", ...extra,
  };
}

const edges: TaxEdge[] = [
  edge("sector.fintech", "sector.insurtech", "immediate"),
  edge("sector.fintech", "sector.financial_services", "immediate"),
  edge("sector.fintech", "sector.blockchain", "broad"),
  edge("sector.fintech", "sector.proptech", "weak"),
  edge("sector.fintech", "sector.software", "weak"),
  edge("sector.insurtech", "sector.healthtech", "weak"),
  edge("sector.insurtech", "sector.financial_services", "immediate"),
  edge("sector.cannabis", "sector.consumer_tech", "immediate", { directed: true, review: "rejected" }),
  edge("sector.cannabis", "sector.consumer_products", "weak"),
  edge("sector.climate_tech", "sector.cleantech", "equivalent"),
  edge("sector.fintech", "sector.healthtech", "immediate", { review: "needs_review" }),
];

const taxonomy: Taxonomy = { revision: 700, nodes, aliases, edges };
const index = indexTaxonomy(taxonomy);

// ---------------------------------------------------------------------------
// Firms and profiles

let seq = 0;
function firm(extra: Partial<Firm> = {}): Firm {
  seq += 1;
  return {
    id: `F${seq}`, name: `Fund ${seq}`, type: "Venture Capital Investment Firm", region: "", year: 2021,
    stages: ["Seed"], fin: ["Equity"], ind: [], vert: ["Fintech"], geo: ["United States"],
    city: "Austin", state: "Texas", country: "United States", web: `https://fund${seq}.vc`, email: "", phone: "",
    nContacts: 2, offices: [], ...extra,
  };
}

function contactsFor(firms: Firm[]): Contact[] {
  return firms.flatMap((f) => [
    { fid: f.id, first: "Ann", last: "Lee", prefix: "", title: "General Partner", email: `ann@${f.id}.vc`, phone: "", city: "Austin", state: "Texas", country: "United States", officeType: "", principal: true, lead: false, matchQ: "Exact" },
    { fid: f.id, first: "Bo", last: "Ng", prefix: "", title: "Principal", email: `bo@${f.id}.vc`, phone: "", city: "Austin", state: "Texas", country: "United States", officeType: "", principal: false, lead: false, matchQ: "Exact" },
  ]);
}

function profile(extra: Partial<MatchingProfile> = {}): MatchingProfile {
  return {
    primarySector: "sector.fintech", secondarySectors: [], stage: "stage.seed", hqCountry: "geo.us", hqState: "geo.us.state.texas",
    markets: [], financing: [], firmTypes: [], exclusions: { existingInvestors: [], alreadyPitched: [], noGo: [], competitors: [] },
    readiness: "ready", issues: [], unconfirmed: [], ...extra,
  };
}

function legacy(extra: Partial<MatchProfile> = {}): MatchProfile {
  return {
    name: "Co", web: "", oneliner: "", model: "", stage: "Seed", raise: "", instruments: ["Equity"], firmTypes: null, lead: false,
    verticals: ["Fintech"], industries: [], country: "United States", usRegion: "Southwest", city: "Austin", markets: [], arr: "", growth: "",
    notes: "", exclusions: "", waveSize: 100, tune: { bullseye: -3, match: -3, expansion: -3 }, filters: {}, siteN: 0, dropDead: true, ...extra,
  };
}

function run(firms: Firm[], extra: Partial<TierRunInput> = {}) {
  const db: FundDb = { firms, contacts: contactsFor(firms) };
  return runTiers({ db, index, profile: profile(), legacy: legacy(), ...extra });
}

function outcome(result: ReturnType<typeof run>, f: Firm): FirmOutcome {
  const found = result.outcomes.find((o) => o.firmId === f.id);
  assert.ok(found, `no outcome for ${f.id}`);
  return found;
}

function place(o: FirmOutcome) {
  return o.status === "tiered" ? o.tier : `${o.status}:${o.reasons.at(-1)}`;
}

// ---------------------------------------------------------------------------
// Tier assignment

test("tier table: every cell from the primary and the secondary sectors", () => {
  assert.equal(tierFor("primary", "same"), "core");
  assert.equal(tierFor("primary", "equivalent"), "core");
  assert.equal(tierFor("primary", "immediate"), "sphere");
  assert.equal(tierFor("primary", "broad"), "tier3");
  assert.equal(tierFor("primary", "weak"), "tier4");
  assert.equal(tierFor("secondary", "same"), "sphere");
  assert.equal(tierFor("secondary", "immediate"), "tier3");
  assert.equal(tierFor("secondary", "broad"), "tier4");
  assert.equal(tierFor("secondary", "weak"), null);
});

test("primary sector: direct, immediate, broader and weak links give Core to Tier 4", () => {
  const core = firm({ vert: ["Fintech"] });
  const sphere = firm({ vert: ["Insurtech"] });
  const tier3 = firm({ vert: ["Blockchain"] });
  const tier4 = firm({ vert: ["Proptech"] });
  const none = firm({ vert: ["Cannabis"] });
  const result = run([core, sphere, tier3, tier4, none]);
  assert.deepEqual([core, sphere, tier3, tier4, none].map((f) => place(outcome(result, f))), [
    "core", "sphere", "tier3", "tier4", "excluded:no_sector_link",
  ]);
  const link = outcome(result, sphere).sector!;
  assert.equal(link.relation, "immediate");
  assert.equal(link.role, "primary");
  assert.equal(link.edgeId, "sector.fintech>sector.insurtech");
  assert.match(outcome(result, sphere).checks.sector!.detail, /Sphere: immediate relationship from the primary sector Fintech to Insurtech/);
});

test("equivalent sectors count as a direct match", () => {
  const f = firm({ vert: ["Cleantech"] });
  const result = run([f], { profile: profile({ primarySector: "sector.climate_tech" }) });
  assert.equal(outcome(result, f).tier, "core");
});

test("secondary sectors: direct = Sphere, immediate = Tier 3, broader = Tier 4, weak = nothing", () => {
  const p = profile({ primarySector: "sector.cannabis", secondarySectors: ["sector.fintech"] });
  const direct = firm({ vert: ["Fintech"] });
  const immediate = firm({ vert: ["Insurtech"] });
  const broad = firm({ vert: ["Blockchain"] });
  const weak = firm({ vert: ["Proptech"] });
  const result = run([direct, immediate, broad, weak], { profile: p });
  assert.deepEqual([direct, immediate, broad, weak].map((f) => place(outcome(result, f))), [
    "sphere", "tier3", "tier4", "excluded:no_sector_link",
  ]);
  assert.equal(outcome(result, direct).sector!.role, "secondary");
});

test("a direct primary match wins over every other link; a multi-sector firm gets its strongest tier once", () => {
  const p = profile({ primarySector: "sector.insurtech", secondarySectors: ["sector.fintech"] });
  const multi = firm({ vert: ["Fintech", "Insurtech", "Blockchain"] });
  const result = run([multi], { profile: p });
  const o = outcome(result, multi);
  assert.equal(o.tier, "core");
  assert.equal(o.sector!.role, "primary");
  assert.equal(result.outcomes.filter((x) => x.firmId === multi.id).length, 1);
  assert.equal(result.counts.tiers.core, 1);
});

test("primary beats secondary in the same tier", () => {
  // Insurtech is immediate to the primary (Sphere) and a direct secondary match (Sphere).
  const p = profile({ primarySector: "sector.fintech", secondarySectors: ["sector.insurtech"] });
  const f = firm({ vert: ["Insurtech"] });
  const o = outcome(run([f], { profile: p }), f);
  assert.equal(o.tier, "sphere");
  assert.equal(o.sector!.role, "primary");
});

test("rejected and unreviewed relationships never place a fund: Cannabis → Consumer Tech", () => {
  const p = profile({ primarySector: "sector.cannabis" });
  const consumerTech = firm({ vert: ["Consumer Tech"] });
  const consumerProducts = firm({ vert: [], ind: ["Consumer Products & Services"] });
  const result = run([consumerTech, consumerProducts], { profile: p });
  assert.equal(place(outcome(result, consumerTech)), "excluded:no_sector_link");
  assert.equal(outcome(result, consumerProducts).tier, "tier4");
  // Fintech → Healthtech is under review: no link.
  const health = firm({ vert: ["Healthtech"] });
  assert.equal(place(outcome(run([health]), health)), "excluded:no_sector_link");
});

test("sector values under review leave the fund unresolved, not linked", () => {
  const f = firm({ vert: ["Neobanking"] });
  const unknown = firm({ vert: ["Quantum Banking"] });
  const result = run([f, unknown]);
  assert.equal(place(outcome(result, f)), "unresolved:sector_ambiguous");
  assert.equal(place(outcome(result, unknown)), "unresolved:sector_ambiguous");
  const none = firm({ vert: [], ind: [] });
  assert.equal(place(outcome(run([none]), none)), "excluded:sector_not_stated");
});

test("generalists go to their own group, never Tier 4", () => {
  const diversified = firm({ ind: ["Diversified"], vert: ["Fintech"] });
  const many = firm({ ind: Array.from({ length: 15 }, (_, i) => `Industry ${i}`), vert: [] });
  const result = run([diversified, many]);
  assert.equal(place(outcome(result, diversified)), "generalist:generalist");
  assert.equal(place(outcome(result, many)), "generalist:generalist");
  assert.equal(result.counts.generalists, 2);
  assert.equal(result.counts.tiers.tier4, 0);
  assert.equal(outcome(result, many).generalistWhy, "Lists 15 industries");
});

// ---------------------------------------------------------------------------
// Eligibility gates

test("stage: exact passes; one stage off is excluded and counted; not stated or ambiguous is unresolved", () => {
  const exact = firm({ stages: ["Seed"] });
  const spanning = firm({ stages: ["Early Stage"] });
  const oneOff = firm({ stages: ["Pre-Seed"] });
  const far = firm({ stages: ["Series B"] });
  const none = firm({ stages: [] });
  const review = firm({ stages: ["Seedish"] });
  const unknown = firm({ stages: ["Series B", "Mystery"] });
  const result = run([exact, spanning, oneOff, far, none, review, unknown]);
  assert.deepEqual([exact, spanning, oneOff, far, none, review, unknown].map((f) => place(outcome(result, f))), [
    "core", "core", "excluded:stage_one_off", "excluded:stage_mismatch", "unresolved:stage_not_stated",
    "unresolved:stage_ambiguous", "unresolved:stage_ambiguous",
  ]);
  assert.equal(result.counts.reasons.stage_one_off, 1);
  assert.match(outcome(result, oneOff).checks.stage!.detail, /Lists Pre-Seed, not Seed/);
});

test("a sector relationship never overrides a failed gate", () => {
  const f = firm({ stages: ["Series B"], vert: ["Fintech"] });
  const o = outcome(run([f]), f);
  assert.equal(o.status, "excluded");
  assert.equal(o.tier, null);
  assert.equal(o.sector, null);
});

test("geography, national coverage: the HQ country, US and non-US", () => {
  const us = firm({ geo: ["United States"] });
  const result = run([us]);
  assert.match(outcome(result, us).checks.geography!.detail, /Invests across United States/);
  const uk = firm({ geo: ["United Kingdom"], country: "United Kingdom", state: "" });
  const ukProfile = profile({ hqCountry: "geo.uk", hqState: null });
  assert.equal(outcome(run([uk], { profile: ukProfile, legacy: legacy({ country: "United Kingdom", usRegion: "" }) }), uk).tier, "core");
});

test("geography, regional coverage: region, subregion, a country in two subregions, North America, the state's US region", () => {
  const de = profile({ hqCountry: "geo.germany", hqState: null });
  const deLegacy = legacy({ country: "Germany", usRegion: "", city: "Berlin" });
  const europe = firm({ geo: ["Europe"] });
  const western = firm({ geo: ["Europe (Western)"] });
  const central = firm({ geo: ["Europe (Central)"] });
  const asia = firm({ geo: ["Asia"] });
  const result = run([europe, western, central, asia], { profile: de, legacy: deLegacy });
  assert.deepEqual([europe, western, central, asia].map((f) => place(outcome(result, f))), ["core", "core", "core", "excluded:geo_outside"]);
  assert.match(outcome(result, central).checks.geography!.detail, /Europe \(Central\), which contains Germany/);

  const na = firm({ geo: ["North America"] });
  const southwest = firm({ geo: ["United States (Southwest)"] });
  const us = run([na, southwest]);
  assert.equal(outcome(us, na).tier, "core");
  assert.match(outcome(us, southwest).checks.geography!.detail, /United States \(Southwest\), which contains Texas/);
});

test("geography: another US region alongside national coverage never excludes", () => {
  const f = firm({ geo: ["United States", "United States (Northeast)"] });
  const ca = profile({ hqState: "geo.us.state.california" });
  assert.equal(outcome(run([f], { profile: ca }), f).tier, "core");
});

test("geography: a US fund listing only other US regions is unresolved, not excluded", () => {
  const ne = firm({ geo: ["United States (Northeast)"] });
  const mixed = firm({ geo: ["Asia", "United States (Northeast)"] });
  const result = run([ne, mixed], { profile: profile({ hqState: "geo.us.state.california" }) });
  assert.equal(place(outcome(result, ne)), "unresolved:geo_us_other_regions");
  assert.equal(place(outcome(result, mixed)), "unresolved:geo_us_other_regions");
  assert.match(outcome(result, ne).checks.geography!.detail, /US focus stated as United States \(Northeast\); California is not in them/);
  const noState = run([ne], { profile: profile({ hqState: null }) });
  assert.equal(place(outcome(noState, ne)), "unresolved:geo_company_state_unknown");
});

test("geography: not stated, ambiguous, ambiguous next to covering, office/person only, outside", () => {
  const none = firm({ geo: [] });
  const ignored = firm({ geo: ["Global"] });
  const ambiguous = firm({ geo: ["Nordics-ish"] });
  const unknown = firm({ geo: ["Somewhere"] });
  const coveredToo = firm({ geo: ["United States", "Somewhere"] });
  const office = firm({ geo: ["Asia"], offices: [{ city: "Dallas", country: "United States", type: "Branch" }] });
  const outside = firm({ geo: ["Asia"], country: "Japan", state: "", city: "Tokyo" });
  const firms = [none, ignored, ambiguous, unknown, coveredToo, office, outside];
  const db: FundDb = {
    firms,
    // `outside` has no one in the US; the others' contacts are in Austin.
    contacts: contactsFor(firms.filter((f) => f !== outside && f !== office)),
  };
  const result = runTiers({ db, index, profile: profile(), legacy: legacy() });
  assert.deepEqual(firms.map((f) => place(outcome(result, f))), [
    "unresolved:geo_not_stated", "unresolved:geo_not_stated", "unresolved:geo_ambiguous", "unresolved:geo_ambiguous",
    "core", "unresolved:geo_office_only", "excluded:geo_outside",
  ]);
  assert.ok(outcome(result, coveredToo).notes.includes("geo_review_note"));
});

test("geography: a team member in the country (no office) is unresolved, not eligible", () => {
  const f = firm({ geo: ["Asia"] });
  const result = run([f]);
  assert.equal(place(outcome(result, f)), "unresolved:geo_office_only");
  assert.match(outcome(result, f).checks.geography!.detail, /Team member in Austin/);
});

test("geography: Puerto Rico is covered by the United States, not by a US region", () => {
  const us = firm({ geo: ["United States"] });
  const region = firm({ geo: ["United States (Southwest)"] });
  const result = run([us, region], { profile: profile({ hqState: "geo.us.puerto_rico" }) });
  assert.equal(outcome(result, us).tier, "core");
  assert.equal(place(outcome(result, region)), "unresolved:geo_us_other_regions");
  assert.ok(containers(index, "geo.us.puerto_rico").has("geo.us"));
});

test("firm type: missing, not mapped and mismatched are told apart; stage defaults and chosen types apply", () => {
  const missing = firm({ type: "" });
  const unmapped = firm({ type: "Corporate VC" });
  const pe = firm({ type: "Private Equity Investment Firm" });
  const angel = firm({ type: "Angel Investor Group" });
  const result = run([missing, unmapped, pe, angel]);
  assert.deepEqual([missing, unmapped, pe, angel].map((f) => place(outcome(result, f))), [
    "excluded:firm_type_missing", "excluded:firm_type_unrecognized", "excluded:firm_type_mismatch", "core",
  ]);
  // Series A defaults: VC and family office only.
  const seriesA = profile({ stage: "stage.series_a" });
  const angelA = firm({ type: "Angel Investor Group", stages: ["Series A"] });
  assert.equal(place(outcome(run([angelA], { profile: seriesA }), angelA)), "excluded:firm_type_mismatch");
  // Chosen types replace the defaults.
  const vc = firm();
  assert.equal(place(outcome(run([vc], { profile: profile({ firmTypes: ["firm_type.pe"] }) }), vc)), "excluded:firm_type_mismatch");
});

test("financing: default Equity, chosen instruments; missing, not mapped and mismatched are told apart", () => {
  const equity = firm({ fin: ["Equity"] });
  const debt = firm({ fin: ["Debt"] });
  const missing = firm({ fin: [] });
  const unknown = firm({ fin: ["Barter"] });
  const result = run([equity, debt, missing, unknown]);
  assert.deepEqual([equity, debt, missing, unknown].map((f) => place(outcome(result, f))), [
    "core", "excluded:financing_mismatch", "excluded:financing_missing", "excluded:financing_unrecognized",
  ]);
  assert.equal(outcome(run([debt], { profile: profile({ financing: ["financing.debt"] }) }), debt).tier, "core");
  assert.equal(result.counts.reasons.financing_missing, 1);
  assert.equal(result.counts.reasons.financing_mismatch, 1);
});

test("funds of funds: excluded only when it is their only financing; an approved exception lets them in", () => {
  const fofOnly = firm({ fin: ["Fund of Funds"] });
  const fofAndEquity = firm({ fin: ["Fund of Funds", "Equity"] });
  const fofAndDebt = firm({ fin: ["Fund of Funds", "Debt"] });
  const fofAndUnknown = firm({ fin: ["Fund of Funds", "Barter"] });
  const result = run([fofOnly, fofAndEquity, fofAndDebt, fofAndUnknown]);
  assert.equal(place(outcome(result, fofOnly)), "excluded:fof_no_exception");
  assert.match(outcome(result, fofOnly).checks.financing!.detail, /Only financing is "Fund of funds"/);
  assert.equal(outcome(result, fofAndEquity).tier, "core");
  // Listed next to another financing type it is checked like any fund.
  assert.equal(place(outcome(result, fofAndDebt)), "excluded:financing_mismatch");
  assert.equal(place(outcome(result, fofAndUnknown)), "excluded:financing_unrecognized");
  assert.equal(result.counts.fofWithOtherFinancing, 3);

  const pending: FofException = { firmId: fofOnly.id, status: "needs_review", evidenceUrl: "", evidenceNote: "Portfolio lists direct deals.", rationale: "Direct seed deals on the website.", reviewedBy: null };
  assert.equal(place(outcome(run([fofOnly], { fofExceptions: new Map([[fofOnly.id, pending]]) }), fofOnly)), "excluded:fof_no_exception");
  const rejected = run([fofOnly], { fofExceptions: new Map([[fofOnly.id, { ...pending, status: "rejected" }]]) });
  assert.match(outcome(rejected, fofOnly).checks.financing!.detail, /rejected/);
  // An approved exception passes the fund-of-funds check; it still needs the financing the company wants.
  const approved = run([fofOnly], { fofExceptions: new Map([[fofOnly.id, { ...pending, status: "approved", reviewedBy: "b@x.com" }]]) });
  const o = outcome(approved, fofOnly);
  assert.ok(o.notes.includes("fof_exception"));
  assert.equal(o.fof?.evidenceNote, "Portfolio lists direct deals.");
  assert.equal(place(o), "excluded:financing_mismatch");
  const approvedForFof = run([fofOnly], {
    profile: profile({ financing: ["financing.fund_of_funds"] }),
    fofExceptions: new Map([[fofOnly.id, { ...pending, status: "approved" }]]),
  });
  assert.equal(outcome(approvedForFof, fofOnly).tier, "core");
});

test("client exclusions (name, domain, name contains), hidden funds and client rejections", () => {
  const byName = firm({ name: "Acme Ventures" });
  const byDomain = firm({ web: "https://www.blocked.vc/team" });
  const contains = firm({ name: "Big Acme Capital Fund" });
  const hidden = firm();
  const rejected = firm();
  const result = run([byName, byDomain, contains, hidden, rejected], {
    legacy: legacy({ exclusions: "Acme Ventures\nblocked.vc\nbig acme" }),
    suppressed: { [hidden.id]: "Not investing" },
    rejected: { [rejected.id]: "Client said no" },
  });
  assert.deepEqual([byName, byDomain, contains, hidden].map((f) => place(outcome(result, f))), [
    "excluded:client_exclusion", "excluded:client_exclusion", "excluded:client_exclusion", "excluded:hidden_all",
  ]);
  const r = outcome(result, rejected);
  assert.equal(r.tier, "core");
  assert.equal(r.rejected, "Client said no");
  assert.equal(result.counts.rejected, 1);
  assert.equal(result.counts.tiers.core, 0);
});

test("optional filters apply as today, each with its own reason", () => {
  const platform = firm({ stages: ["Seed", "Pre-Seed", "Series A", "Series B", "A", "B", "C", "D"] });
  const old = firm({ year: 2001 });
  const result = run([platform, old], { legacy: legacy({ filters: { noPlatforms: true, foundedAfter: 2010 } }) });
  assert.equal(place(outcome(result, platform)), "excluded:filter_platform");
  assert.equal(place(outcome(result, old)), "excluded:filter_founded");
  const noContacts = firm();
  const bare = runTiers({ db: { firms: [noContacts], contacts: [] }, index, profile: profile(), legacy: legacy({ filters: { needEmail: true } }) });
  assert.equal(place(outcome(bare, noContacts)), "excluded:filter_email");
  const decision = runTiers({ db: { firms: [noContacts], contacts: [] }, index, profile: profile(), legacy: legacy({ filters: { needDecision: true } }) });
  assert.equal(place(outcome(decision, noContacts)), "excluded:filter_decision_maker");
  const near = runTiers({ db: { firms: [noContacts], contacts: [] }, index, profile: profile(), legacy: legacy({ filters: { nearOnly: true } }) });
  assert.equal(place(outcome(near, noContacts)), "excluded:filter_near");
  const conf = runTiers({ db: { firms: [noContacts], contacts: [] }, index, profile: profile(), legacy: legacy({ filters: { minConf: 0.99 } }) });
  assert.equal(place(outcome(conf, noContacts)), "excluded:filter_confidence");
});

test("website check: dead sites leave the tier after tiering, only within each tier's checked funds", () => {
  const dead = firm();
  const fine = firm();
  const unchecked = firm({ vert: ["Insurtech"] });
  const result = run([dead, fine, unchecked], {
    legacy: legacy({ siteN: 50 }),
    sites: { [dead.id]: { st: "parked", at: "2026-10-01" }, [fine.id]: { st: "ok", at: "2026-10-01", title: "Fund" } },
  });
  assert.equal(place(outcome(result, dead)), "excluded:dead_website");
  assert.equal(outcome(result, fine).site, "ok");
  assert.equal(outcome(result, unchecked).site, "unscanned");
  assert.equal(result.counts.tiers.core, 1);
});

// ---------------------------------------------------------------------------
// Old engine against new: kept rules give the same result

test("kept rules match the current engine: exclusions, hidden, firm type, financing, filters", () => {
  // Every firm passes stage, sector and geography in both engines, so only the kept rules decide.
  const firms = [
    firm({ name: "Acme Ventures" }),
    firm(),
    firm({ type: "Private Equity Investment Firm" }),
    firm({ type: "Angel Investor Group" }),
    firm({ type: "" }),
    firm({ fin: ["Debt"] }),
    firm({ fin: [] }),
    firm({ fin: ["Debt", "Equity"] }),
    firm({ year: 2001 }),
    firm(),
  ];
  const db: FundDb = { firms, contacts: contactsFor(firms) };
  const settings = { exclusions: "Acme Ventures", filters: { foundedAfter: 2010 } };
  const suppressed = { [firms[9].id]: "Hidden" };
  const oldOut = RME.run(db, legacy(settings), { suppressed });
  const oldListed = new Set(oldOut.results.map((r) => r.f.id));
  const newRun = runTiers({ db, index, profile: profile(), legacy: legacy(settings), suppressed });
  const newListed = new Set(newRun.outcomes.filter((o) => o.status === "tiered").map((o) => o.firmId));
  assert.deepEqual(Array.from(newListed).sort(), Array.from(oldListed).sort());
  assert.equal(newListed.size, 3);
});

test("the engine module still provides the helpers the four-tier engine uses", () => {
  const firms = [firm(), firm({ vert: ["Insurtech"] }), firm({ stages: ["Pre-Seed"] })];
  const db: FundDb = { firms, contacts: contactsFor(firms) };
  const p = legacy({ tune: { bullseye: 0, match: 0, expansion: 0 } });
  const first = RME.run(db, p);
  const second = RME.run({ firms, contacts: db.contacts }, p);
  assert.deepEqual(first.results.map((r) => [r.f.id, r.tier, r.score]), second.results.map((r) => [r.f.id, r.tier, r.score]));
  assert.equal(first.results.length, 3);
  for (const name of ["rankContacts", "pickSequence", "assess", "applySite", "isNear", "parseExclusions", "domainOf"] as const) {
    assert.equal(typeof RME[name], "function", name);
  }
});

// ---------------------------------------------------------------------------
// Determinism, readiness, saving and comparison

test("same inputs give identical results; each firm appears once; rules version recorded", () => {
  const firms = [firm(), firm({ vert: ["Insurtech"] }), firm({ stages: [] }), firm({ ind: ["Diversified"] }), firm({ vert: ["Blockchain"] })];
  const a = run(firms);
  const b = run(firms);
  assert.equal(JSON.stringify(a), JSON.stringify(b));
  assert.equal(a.outcomes.length, firms.length);
  assert.equal(new Set(a.outcomes.map((o) => o.firmId)).size, firms.length);
  assert.equal(a.rulesVersion, RULES_VERSION);
  const total = Object.values(a.counts.tiers).reduce((x, y) => x + y, 0) + a.counts.rejected + a.counts.generalists + a.counts.excluded + a.counts.unresolved;
  assert.equal(total, firms.length);
});

test("within a tier funds are ordered by fit score, then firm ID", () => {
  const strong = firm({ stages: ["Seed"], year: 2023 });
  const weak = firm({ stages: ["Seed", "Pre-Seed", "Series A", "Series B", "Early Stage", "Growth"], year: 1999 });
  const result = run([weak, strong]);
  const core = result.outcomes.filter((o) => o.tier === "core");
  assert.deepEqual(core.map((o) => o.firmId), [strong.id, weak.id]);
  assert.ok((core[0].score ?? 0) > (core[1].score ?? 0));
});

test("profile readiness: Blocked refuses, Limited lists every point with the check it affects", () => {
  assert.equal(blockedReason("ready", []), null);
  assert.match(blockedReason("blocked", [{ field: "Stage", severity: "blocking", message: "No stage." }])!, /blocked: No stage\./);
  const warnings = profileWarnings([
    { field: "Primary sector", severity: "limited", message: "Fintech: needs confirmation (no founder quote supports it)." },
    { field: "HQ state", severity: "limited", message: "US company without a state." },
    { field: "Markets", severity: "info", message: "No other markets given." },
  ]);
  assert.equal(warnings.length, 2);
  assert.match(warnings[0], /affects the sector tiers/);
  assert.match(warnings[1], /affects the US regional geography check/);
  assert.throws(() => runTiers({ db: { firms: [], contacts: [] }, index, profile: profile({ stage: null }), legacy: legacy() }));
});

test("stored rows keep repeated FirmIDs apart", () => {
  const a = firm({ id: "DUP", name: "Same Fund" });
  const b = firm({ id: "DUP", name: "Same Fund", web: "https://other.vc" });
  const c = firm({ vert: ["Insurtech"] });
  const d = firm({ stages: ["Pre-Seed"] });
  const db: FundDb = { firms: [a, b, c, d], contacts: contactsFor([a, c, d]) };
  const newRows = tierRows(runTiers({ db, index, profile: profile(), legacy: legacy() }));
  assert.deepEqual(newRows.map((r) => r.firm_id).sort(), ["DUP", "DUP#2", c.id, d.id].sort());
  const oneOff = newRows.find((r) => r.firm_id === d.id)!;
  assert.equal(oneOff.status, "excluded");
  assert.deepEqual(oneOff.reason_codes, ["stage_one_off"]);
});

// ---------------------------------------------------------------------------
// Duplicates (read-only)

test("duplicate levels: same ID, certain, likely, ambiguous; Willow-style records; nothing changed", () => {
  const willowA = firm({ id: "W1", name: "Willow Growth Partners", web: "https://willowgrowth.com", country: "United States" });
  const willowB = firm({ id: "W2", name: "Willow Growth Partners, LLC", web: "http://www.willowgrowth.com/", country: "United States" });
  const sisterA = firm({ id: "S1", name: "North Fund I", web: "https://north.vc" });
  const sisterB = firm({ id: "S2", name: "North Opportunity Fund", web: "https://north.vc" });
  const sameNameA = firm({ id: "N1", name: "Summit Capital", web: "https://summit.com" });
  const sameNameB = firm({ id: "N2", name: "Summit Capital", web: "https://summitcap.de", country: "Germany" });
  const repeatA = firm({ id: "R1", name: "Repeat VC" });
  const repeatB = { ...repeatA };
  const firms = [willowA, willowB, sisterA, sisterB, sameNameA, sameNameB, repeatA, repeatB];
  const db: FundDb = { firms, contacts: contactsFor([willowA]) };
  const before = JSON.stringify(db);
  const report = findDuplicates(db, index);
  assert.equal(JSON.stringify(db), before);
  const levelOf = (id: string) => report.groups.filter((g) => g.members.some((m) => m.id === id)).map((g) => g.level);
  assert.deepEqual(levelOf("W1"), ["certain"]);
  assert.deepEqual(levelOf("S1"), ["likely"]);
  assert.deepEqual(levelOf("N1"), ["ambiguous"]);
  assert.ok(levelOf("R1").includes("same_id"));
  assert.equal(report.counts.certain.groups, 1);
  const willow = report.watched.find((w) => w.name === "Willow Growth Partners")!;
  assert.equal(willow.groups.length, 1);
  assert.deepEqual(willow.groups[0].members.map((m) => [m.id, m.contacts]), [["W1", 2], ["W2", 0]]);
  assert.equal(normalizedName("Willow Growth Partners, LLC"), "willow growth partners");
  // Flags only: the match keeps both records and marks them.
  const flags = duplicateFlags(report);
  const result = run([willowA, willowB], { duplicates: flags });
  assert.equal(result.outcomes.filter((o) => o.status === "tiered").length, 2);
  assert.ok(result.outcomes.every((o) => o.notes.includes("possible_duplicate")));
});

// ---------------------------------------------------------------------------
// Identity groups (Sprint 3B-1)

function asStored(rows: ReturnType<typeof tierRows>): StoredResult[] {
  return rows.map((r) => ({ firmId: r.firm_id, firmName: r.firm_name, status: r.status, tier: r.tier || null, reasonCodes: r.reason_codes, detail: JSON.parse(JSON.stringify(r.detail)), score: r.score === "" ? null : r.score, position: r.position }));
}

function identityFixture() {
  const keep = firm({ id: "W1", name: "Willow Growth Partners", web: "https://willowgrowth.com" });
  const shell = firm({ id: "W2", name: "Willow Growth Partners", web: "http://www.willowgrowth.com/" });
  const officeUs = firm({ id: "B1", name: "Bridge Group", web: "https://bridge.eu", country: "United States", geo: ["United States"] });
  const officeUk = firm({ id: "B2", name: "Bridge Group", web: "https://bridge.eu", country: "United Kingdom", state: "", city: "London", geo: ["Europe"] });
  const firms = [keep, shell, officeUs, officeUk];
  const contacts = [
    ...contactsFor([keep]),
    { fid: "W2", first: "Cy", last: "Diaz", prefix: "", title: "Partner", email: "cy@willowgrowth.com", phone: "", city: "Austin", state: "Texas", country: "United States", officeType: "", principal: false, lead: false, matchQ: "Exact" },
    { fid: "W2", first: "Ann", last: "Lee", prefix: "", title: "General Partner", email: "ann@W1.vc", phone: "", city: "Austin", state: "Texas", country: "United States", officeType: "", principal: true, lead: false, matchQ: "Exact" },
    ...contactsFor([officeUs, officeUk]),
  ];
  return { keep, shell, officeUs, officeUk, db: { firms, contacts } as FundDb };
}

test("identity decisions: duplicates need a confirmation; offices apply unless rejected; a changed group needs a new decision", () => {
  const { db } = identityFixture();
  const proposals = identityProposals(findDuplicates(db, index));
  const dup = proposals.find((p) => p.members.some((m) => m.id === "W1"))!;
  const offices = proposals.find((p) => p.members.some((m) => m.id === "B1"))!;
  assert.equal(dup.kind, "duplicate");
  assert.equal(dup.auto, false);
  assert.equal(offices.kind, "offices");
  assert.equal(offices.auto, true);

  const none = resolveIdentities(proposals, []);
  assert.equal(none.find((r) => r.key === dup.key)!.applied, false);
  assert.equal(none.find((r) => r.key === offices.key)!.applied, true);

  const decision = (key: string, status: "confirmed" | "rejected", memberIds: string[]) =>
    ({ groupKey: key, kind: "duplicate" as const, status, memberIds, note: "", decidedBy: "a@x.com", decidedAt: "2026-10-21" });
  const confirmed = resolveIdentities(proposals, [decision(dup.key, "confirmed", ["W2", "W1"]), decision(offices.key, "rejected", ["B1", "B2"])]);
  assert.equal(confirmed.find((r) => r.key === dup.key)!.applied, true);
  assert.equal(confirmed.find((r) => r.key === offices.key)!.applied, false);
  const stale = resolveIdentities(proposals, [decision(dup.key, "confirmed", ["W1", "W9"])]).find((r) => r.key === dup.key)!;
  assert.equal(stale.stale, true);
  assert.equal(stale.applied, false);
  const groups = appliedGroups(confirmed);
  assert.deepEqual(groups.map((g) => [g.kind, g.status, g.memberIds.sort().join(",")]), [["duplicate", "confirmed", "W1,W2"]]);
});

test("a confirmed duplicate shows once, keeps both records' contacts under their own FirmIDs and never moves a review", () => {
  const { db, keep, shell } = identityFixture();
  const proposals = identityProposals(findDuplicates(db, index));
  const dup = proposals.find((p) => p.members.some((m) => m.id === "W1"))!;
  const groups = appliedGroups(resolveIdentities(proposals, [{ groupKey: dup.key, kind: "duplicate", status: "confirmed", memberIds: ["W1", "W2"], note: "", decidedBy: "a@x.com", decidedAt: "2026-10-21" }]));
  const result = runTiers({ db, index, profile: profile(), legacy: legacy(), identities: groups, rejected: { W2: "Client said no" } });
  const shown = outcome(result, keep);
  const hidden = outcome(result, shell);
  assert.equal(shown.status, "tiered");
  assert.equal(shown.identity?.kind, "duplicate");
  assert.equal(shown.identity?.status, "confirmed");
  assert.equal(shown.identity?.decidedBy, "a@x.com");
  assert.match(shown.identity!.derivation, /^Shown as W1: /);
  assert.equal(hidden.representedBy, "W1");
  assert.equal(result.counts.represented, 2); // W2, and the UK office shown through B1
  assert.equal(result.counts.tiers.core, 2); // W1 and B1
  // Contacts: Ann (in both records, once), Bo (W1) and Cy (W2), each under its own FirmID.
  assert.deepEqual(shown.people.map((p) => `${p.name}@${p.fid}`).sort(), ["Ann Lee@W1", "Bo Ng@W1", "Cy Diaz@W2"]);
  // The rejection is W2's: shown, never applied to W1.
  assert.equal(shown.rejected, null);
  assert.ok(shown.notes.includes("linked_record_rejected"));
  assert.equal(shown.identity!.members.find((m) => m.firmId === "W2")!.rejected, "Client said no");
});

test("offices: each office keeps its own checks; the firm shows once as its strongest office; the others stay in the details", () => {
  const { db, officeUs, officeUk } = identityFixture();
  const groups = appliedGroups(resolveIdentities(identityProposals(findDuplicates(db, index)), []));
  const result = runTiers({ db, index, profile: profile(), legacy: legacy(), identities: groups });
  const us = outcome(result, officeUs);
  const uk = outcome(result, officeUk);
  assert.equal(us.tier, "core");
  assert.equal(us.identity?.kind, "offices");
  assert.equal(us.identity?.status, "auto");
  assert.match(us.identity!.derivation, /strongest outcome \(Core; next: B2, Unresolved: Office\/person location only\)/);
  assert.equal(uk.representedBy, "B1");
  assert.equal(uk.reasons.at(-1), "geo_office_only"); // its own result is kept
  const ukMember = us.identity!.members.find((m) => m.firmId === "B2")!;
  assert.equal(ukMember.reason, "geo_office_only");
  assert.match(ukMember.checks.geography!.detail, /stated geography is "Europe"/);
  // Offices keep their own contacts.
  assert.ok(us.people.every((p) => p.fid === "B1"));
});

test("exports read only the saved rows: listed funds, contacts with verification, outside the tiers, near misses", () => {
  const near = firm({ stages: ["Pre-Seed"], name: "Near Fund" });
  const { db, keep } = identityFixture();
  // Without the duplicate shell (W2): its own copy of Ann has no verification of its own.
  const all: FundDb = { firms: [...db.firms.filter((f) => f.id !== "W2"), near], contacts: [...db.contacts.filter((c) => c.fid !== "W2"), ...contactsFor([near])] };
  const groups = appliedGroups(resolveIdentities(identityProposals(findDuplicates(all, index)), []));
  const result = runTiers({ db: all, index, profile: profile(), legacy: legacy(), identities: groups });
  const rows = asStored(tierRows(result));
  const counted = storedCounts(rows);
  assert.deepEqual(counted.tiers, result.counts.tiers);
  assert.equal(counted.represented, result.counts.represented);
  assert.equal(counted.total, all.firms.length);

  const funds = fundRows(rows);
  assert.ok(funds.slice(1).every((r) => r[2] !== "B2")); // shown through B1
  assert.ok(funds.some((r) => r[2] === "B1" && String(r[12]).includes("Offices")));

  const states: ContactStates = new Map([
    [`${keep.id}|ann@w1.vc`, { email: "ann@W1.vc", status: "email_bad", checkedAt: "2026-10-01", decision: null }],
    [`${keep.id}|bo@w1.vc`, { email: "old@W1.vc", status: "clean", checkedAt: "2026-10-01", decision: null }],
  ]);
  const people = contactRows(rows, states);
  const emails = people.rows.slice(1).map((r) => String(r[7]));
  assert.ok(!emails.includes("ann@W1.vc")); // known problem, not kept
  assert.equal(people.leftOut, 1);
  assert.equal(people.rows.find((r) => r[7] === "bo@W1.vc")![12], "Not verified"); // checked an older email
  const kept = contactRows(rows, new Map([[`${keep.id}|ann@w1.vc`, { email: "ann@W1.vc", status: "email_bad", checkedAt: "2026-10-01", decision: "keep" }]]));
  assert.ok(kept.rows.some((r) => r[7] === "ann@W1.vc" && String(r[12]).includes("(kept)")));
  assert.equal(contactRows(rows, states, true).leftOut, 0);

  const outside = outsideRows(rows);
  assert.ok(outside.some((r) => r[0] === "Shown as another record" && r[2] === "B2"));
  assert.ok(outside.some((r) => r[1] === "One stage off" && r[2] === near.id));

  const misses = nearMissRows(rows);
  assert.deepEqual(misses.slice(1).map((r) => [r[0], r[1]]), [["NOT ELIGIBLE: one stage off", near.id]]);
  assert.match(NEAR_MISS_BANNER[0], /NOT AN ELIGIBLE MATCH LIST/);

  const facts = runFacts({ id: "RUN-1", clientName: "Co", rulesVersion: RULES_VERSION, taxonomyRevision: 700, profileVersion: 4, fundDbVersion: "v1", fundDbFile: "f.xlsx", ranAt: "2026-10-21", ranBy: "a@x.com", resultsExpected: rows.length, profileInputs: {}, settings: { identities: groups } }, true);
  assert.deepEqual(facts[0], ["Saved run", "RUN-1"]);
  assert.ok(facts.some((r) => r[0] === "Rules" && r[1] === RULES_VERSION));
});

// ---------------------------------------------------------------------------
// Sprint 3B-2: the founder's list from a saved four-tier run

test("four-tier push list: the four tiers only, exactly as saved, traced to the run", () => {
  const core = firm({ vert: ["Fintech"] });
  const sphere = firm({ vert: ["Insurtech"] });
  const tier3 = firm({ vert: ["Blockchain"] });
  const tier4 = firm({ vert: ["Proptech"] });
  const generalist = firm({ vert: [], ind: ["Diversified"] });
  const oneOff = firm({ stages: ["Series A"] });
  const outside = firm({ geo: ["Europe"] });
  const rejected = firm({ vert: ["Fintech"] });
  const firms = [core, sphere, tier3, tier4, generalist, oneOff, outside, rejected];
  const result = run(firms, { rejected: { [rejected.id]: "Client veto" } });
  const rows = asStored(tierRows(result));
  const runInfo = { id: "11111111-2222-3333-4444-555555555555", rulesVersion: RULES_VERSION, ranAt: "2026-10-21T10:00:00Z" };

  const built = fourTierClientList(runInfo, rows, firmsByRowKey(firms), "Seed", { [core.id]: "$1M–$3M" });
  assert.ok(built.ok);
  const list = built.value;
  assert.deepEqual(list.rows.map((r) => [r.id, r.tier]), [[core.id, 1], [sphere.id, 2], [tier3.id, 3], [tier4.id, 4]]);
  assert.equal(list.tier_scheme, "four");
  assert.equal(list.run_id, runInfo.id);
  assert.equal(list.rules_version, RULES_VERSION);
  assert.deepEqual(list.summary!.tiers.map((t) => [t.tier, t.funds, t.contacts]), [[1, 1, 2], [2, 1, 2], [3, 1, 2], [4, 1, 2]]);
  const first = list.rows[0];
  assert.equal(first.contact_count, 2);
  assert.equal(first.check_size, "$1M–$3M");
  assert.deepEqual(first.reasons, ["Stage: Seed", "Sector: Fintech", "Geo: United States"]);
  assert.equal(first.why, "");
  // Generalists, near misses, excluded and rejected funds are never on the list.
  for (const left of [generalist, oneOff, outside, rejected]) assert.ok(!list.rows.some((r) => r.id === left.id));

  // The markers survive every step a pushed list goes through.
  const sent = asInvestorList(investorListForClient(asInvestorList(clientFacingList(list))));
  assert.equal(sent.tier_scheme, "four");
  assert.equal(sent.run_id, runInfo.id);
  assert.equal(sent.rules_version, RULES_VERSION);
  assert.deepEqual(sent.rows.map((r) => r.tier), [1, 2, 3, 4]);
  assert.deepEqual(sent.summary!.tiers.map((t) => t.tier), [1, 2, 3, 4]);

  // A Fund Database that no longer has the run's funds can't build the list.
  const changed = fourTierClientList(runInfo, rows, firmsByRowKey(firms.filter((f) => f !== tier4)), "Seed");
  assert.ok(!changed.ok);
});

test("four-tier push list: a confirmed duplicate counts each person once; offices stay separate", () => {
  const { db } = identityFixture();
  const proposals = identityProposals(findDuplicates(db, index));
  const dup = proposals.find((p) => p.members.some((m) => m.id === "W1"))!;
  const groups = appliedGroups(
    resolveIdentities(proposals, [{ groupKey: dup.key, kind: "duplicate", status: "confirmed", memberIds: dup.members.map((m) => m.id), note: "", decidedBy: "a@x.com", decidedAt: "2026-10-21" }]),
  );
  const result = runTiers({ db, index, profile: profile(), legacy: legacy(), identities: groups });
  const rows = asStored(tierRows(result));
  const built = fourTierClientList({ id: "11111111-2222-3333-4444-555555555555", rulesVersion: RULES_VERSION, ranAt: "2026-10-21" }, rows, firmsByRowKey(db.firms), "Seed");
  assert.ok(built.ok);
  assert.deepEqual(built.value.rows.map((r) => r.id).sort(), ["B1", "W1"]);
  const willow = built.value.rows.find((r) => r.id === "W1")!;
  // W1: Ann and Bo; W2 adds Cy, and its copy of Ann has the same email.
  assert.equal(willow.contact_count, 3);
  const shown = rows.find((r) => r.firmId === "W1")!;
  assert.deepEqual(reachablePeople(shown).map((p) => p.fid).sort(), ["W1", "W1", "W2"]);
  // Verification for the live run: each contact keeps the FirmID it is stored under.
  const live = result.live.get(result.outcomes.find((o) => o.firmId === "W1")!)!;
  assert.ok(live.ranked.some((c) => c.fid === "W2"));
});

test("contacts once each: same email, or the same name without an honorific and title", () => {
  const person = (name: string, email: string, title = "Partner") => ({ fid: "F1", key: email.toLowerCase(), name, title, role: "Decision maker", email, phone: "", city: "", country: "", score: 1, seq: "" });
  const people = [
    person("Mr John Smith", "john@fund.vc"),
    person("John Smith", "JOHN@fund.vc"),
    person("Ms Jane Roe", ""),
    person("Jane Roe", ""),
    person("Jane Roe", "", "Analyst"),
  ];
  assert.deepEqual(distinctPeople(people).map((p) => p.name), ["Mr John Smith", "Ms Jane Roe", "Jane Roe"]);
});
