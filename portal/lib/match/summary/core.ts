// The matching summary and the Competitive Landscape Overview: clean tables,
// one per step, built from what each step confirmed. Pure module: the server
// loads the inputs; the page, the client page and the Excel export all show
// the same model. Only what people care about: no dates, no "confirmed by",
// no buttons, no process notes.

import { DRY_STEP_LABEL, type DryStep } from "../dry/core.ts";
import { KIND_LABEL, type Investor } from "../landscape/investors.ts";
import { countryFromHq, type Competitor } from "../landscape/core.ts";
import type { CheckRow } from "../landscape/check.ts";
import type { RosterCounts } from "../roster/core.ts";
import { TIER_LABEL, waterfall, type PlanFund, type PlanInputs, type Planned } from "../plan/core.ts";

export type Cell = string | number | { text: string; href: string };
/** filter: the table can be filtered by this column (a cell may hold several values, ", " between). */
export type Column = { key: string; label: string; align?: "right"; filter?: boolean };
export type Detail = { label: string; value: Cell | Cell[] };
export type SummaryTable = {
  title?: string;
  columns: Column[];
  /** One short line per item. */
  rows: Record<string, Cell>[];
  /** Per row (same order): everything about it, shown when the row is clicked. */
  details?: Detail[][];
  /** What a row is, for the details' heading ("Competitor"). */
  item?: string;
  /** Bold last row (a total). */
  total?: Record<string, Cell>;
  /** A long list: shown with a search box (by the first column) and the column filters. */
  search?: boolean;
};
export type SummaryStep = {
  key: string;
  /** The button: "Step 1", "Step 2A". */
  button: string;
  /** Shown under the buttons once picked: "Dry Match Short List". */
  title: string;
  headline: { value: number; label: string } | null;
  /** One short line that matters (e.g. the campaign setup). */
  line?: string;
  tables: SummaryTable[];
};
export type Summary = {
  kind: "matching" | "landscape" | "peers";
  title: string;
  clientName: string;
  steps: SummaryStep[];
};

const n = (v: number) => v.toLocaleString("en-US");
/** A deduction, accountant style: (16). */
export const minus = (v: number) => `(${n(v)})`;

export type SavedDryStep = { step: DryStep; chosenLabels: string[]; before: number; removed: number; left: number };

export type MatchingInputs = {
  clientName: string;
  dry: { totalFunds: number; steps: SavedDryStep[]; fundCount: number };
  /** Null when Step 2 was skipped (no funded competitors). */
  landscape: { competitors: Competitor[]; investors: Investor[] } | null;
  rows: CheckRow[];
  /** Step 3, Companies Like You. Null when skipped (or before Step 3 existed). */
  like?: { companies: Competitor[]; investors: Investor[]; rows: CheckRow[] } | null;
  roster: RosterCounts;
  plan: { inputs: PlanInputs; capacityContacts: number; planned: Planned[]; funds: PlanFund[] };
};

function stepOne(dry: MatchingInputs["dry"]): SummaryStep {
  return {
    key: "step1",
    button: "Step 1",
    title: "Dry Match Short List",
    headline: { value: dry.fundCount, label: "Funds on the short list" },
    tables: [
      {
        columns: [
          { key: "step", label: "Filter" },
          { key: "chosen", label: "Chosen" },
          { key: "removed", label: "Removed", align: "right" },
          { key: "left", label: "Left", align: "right" },
        ],
        rows: [
          { step: "All funds", chosen: "", removed: "", left: n(dry.totalFunds) },
          ...dry.steps.map((s) => ({ step: DRY_STEP_LABEL[s.step], chosen: s.chosenLabels.join(", "), removed: minus(s.removed), left: n(s.left) })),
        ],
        total: { step: "Dry Match Short List", chosen: "", removed: "", left: n(dry.fundCount) },
      },
    ],
  };
}

/** The HQ country only ("New York, NY, USA" → United States). */
function country(c: Competitor) {
  return c.geography || countryFromHq(c.hq);
}

function round(c: Competitor) {
  return [c.funding.lastRound, c.funding.lastRoundDate].filter(Boolean).join(", ");
}

const comparable = (key: string) => key === "step3a" || key === "comparables" || key === "peers";

function competitorsStep(competitors: Competitor[], key: string, button: string, title: string, withSources: boolean): SummaryStep {
  return {
    key,
    button,
    title,
    headline: {
      value: competitors.length,
      label: comparable(key) ? (competitors.length === 1 ? "Comparable company" : "Comparable companies") : competitors.length === 1 ? "Funded competitor" : "Funded competitors",
    },
    tables: [
      {
        item: comparable(key) ? "Company" : "Competitor",
        columns: [
          { key: "name", label: comparable(key) ? "Company" : "Competitor" },
          { key: "hq", label: "HQ" },
          { key: "round", label: "Latest round" },
        ],
        rows: competitors.map((c) => ({ name: c.name, hq: country(c), round: round(c) })),
        details: competitors.map((c) => [
          { label: "What it does", value: c.oneLiner },
          { label: "Website", value: c.website ? { text: c.website.replace(/^https?:\/\//, "").replace(/\/$/, ""), href: c.website } : "" },
          { label: "HQ", value: country(c) },
          { label: "Latest round", value: round(c) },
          { label: "Investors named", value: c.funding.investors },
          ...(withSources && !comparable(key) ? [] : [{ label: comparable(key) ? "Why investors see it as the same bet" : "Why a direct competitor", value: c.why }]),
          { label: "Source", value: c.newsUrl ? { text: c.newsTitle || "Article", href: c.newsUrl } : "" },
        ]),
      },
    ],
  };
}

function backingLine(b: Investor["backed"][number]) {
  return [b.competitor, b.round, b.lead ? "led" : ""].filter(Boolean).join(" · ");
}

/** One line: the first competitor it backed, and how many more. */
function backedShort(names: string[]) {
  const unique = Array.from(new Set(names));
  if (!unique.length) return "";
  return unique.length === 1 ? unique[0] : `${unique[0]} +${unique.length - 1}`;
}

function backingDetails(i: Investor): Cell[] {
  return i.backed.map((b) => (b.sourceUrl ? { text: backingLine(b), href: b.sourceUrl } : backingLine(b)));
}

/** How an investor is tied to the client, as filterable tags. */
function connection(f: { backed?: string[]; comparables?: string[]; clientNamed?: boolean }) {
  return [
    ...(f.backed?.length ? ["Backed a competitor"] : []),
    ...(f.comparables?.length ? ["Backed a company like you"] : []),
    ...(f.clientNamed ? ["Named by you"] : []),
  ].join(", ");
}

/** Every investor on the Final Roster, best placed first, with whether it is in the plan. */
function rosterList(plan: MatchingInputs["plan"]): SummaryTable {
  const inPlan = new Set(plan.planned.map((p) => p.firmId));
  const order: Record<string, number> = { core: 0, sphere: 1, tier3: 2, tier4: 3, outside: 4, none: 5 };
  const funds = [...plan.funds].sort(
    (a, b) =>
      Number(inPlan.has(b.firmId)) - Number(inPlan.has(a.firmId)) ||
      (order[a.tier] ?? 9) - (order[b.tier] ?? 9) ||
      a.name.localeCompare(b.name),
  );
  return {
    title: "Everyone on the Final Roster",
    item: "Investor",
    search: true,
    columns: [
      { key: "name", label: "Investor" },
      { key: "type", label: "Type", filter: true },
      { key: "tier", label: "Tier", filter: true },
      { key: "connection", label: "Connection", filter: true },
      { key: "contacts", label: "Contacts", align: "right" },
      { key: "plan", label: "In the plan", filter: true },
    ],
    rows: funds.map((f) => ({
      name: f.name,
      type: f.type ?? "",
      tier: TIER_LABEL[f.tier],
      connection: connection(f),
      contacts: f.contacts,
      plan: inPlan.has(f.firmId) ? "Yes" : "No",
    })),
    details: funds.map((f) => [
      { label: "Type", value: f.type ?? "" },
      { label: "Website", value: f.website ? { text: f.website.replace(/^https?:\/\//, "").replace(/\/$/, ""), href: f.website } : "" },
      { label: "Tier", value: TIER_LABEL[f.tier] },
      { label: "Matched on", value: f.hit },
      { label: "Backed a competitor", value: f.backed },
      { label: "Backed a comparable company", value: f.comparables ?? [] },
      { label: "Named by you", value: f.clientNamed ? "Yes" : "" },
      { label: "Contacts found", value: n(f.contacts) },
      { label: "In the plan", value: inPlan.has(f.firmId) ? "Yes" : "No" },
    ]),
  };
}

function rosterStep(c: RosterCounts, plan?: MatchingInputs["plan"]): SummaryStep {
  const line = (source: string, investors: string) => ({ source, investors });
  return {
    key: "step4",
    button: "Step 4",
    title: "The Final Roster",
    headline: { value: c.total, label: "Investors on the Final Roster" },
    tables: [
      {
        columns: [
          { key: "source", label: "Source" },
          { key: "investors", label: "Investors", align: "right" },
        ],
        rows: [
          line("Dry Match Short List", n(c.dry)),
          line("Brought back (Steps 2, 3)", `+${n(c.broughtBack)}`),
          line("Added to the database (Steps 2, 3)", `+${n(c.added)}`),
          line("Excluded by the client", minus(c.excluded)),
        ],
        total: line("The Final Roster", n(c.total)),
      },
      {
        columns: [
          { key: "what", label: "Of which" },
          { key: "investors", label: "Investors", align: "right" },
        ],
        rows: [
          { what: "Backed a competitor", investors: n(c.backed) },
          ...(c.comparables !== undefined ? [{ what: "Backed a comparable company", investors: n(c.comparables) }] : []),
          ...(c.clientNamed ? [{ what: "Named by you", investors: n(c.clientNamed) }] : []),
        ],
      },
      ...(plan ? [rosterList(plan)] : []),
    ],
  };
}

export function planStep(plan: MatchingInputs["plan"]): SummaryStep {
  const { inputs, planned, funds } = plan;
  const w = waterfall(funds, plan.capacityContacts, inputs.contactsPerFund);
  const byId = new Map(funds.map((f) => [f.firmId, f]));
  const months = `${inputs.months} ${inputs.months === 1 ? "month" : "months"}`;
  return {
    key: "step5",
    button: "Step 5",
    title: "The Plan",
    headline: { value: w.plannedContacts, label: `Contacts at ${n(w.plannedFunds)} funds` },
    line: `${inputs.inboxes} ${inputs.inboxes === 1 ? "inbox" : "inboxes"} · ${months} · ${1 + inputs.followUps} emails per contact · up to ${inputs.contactsPerFund} contacts per fund`,
    tables: [
      {
        columns: [
          { key: "tier", label: "Tier" },
          { key: "funds", label: "Approachable funds", align: "right" },
          { key: "contacts", label: "# of contacts", align: "right" },
          { key: "planFunds", label: "Funds in plan", align: "right" },
          { key: "planContacts", label: "# of contacts", align: "right" },
        ],
        rows: w.rows.map((r) => ({ tier: TIER_LABEL[r.tier], funds: n(r.funds), contacts: n(r.contacts), planFunds: n(r.plannedFunds), planContacts: n(r.plannedContacts) })),
        total: {
          tier: "The Final Outreach Roster",
          funds: n(w.rows.reduce((s, r) => s + r.funds, 0)),
          contacts: n(w.rows.reduce((s, r) => s + r.contacts, 0)),
          planFunds: n(w.plannedFunds),
          planContacts: n(w.plannedContacts),
        },
      },
      {
        title: "The Final Outreach Roster",
        search: true,
        columns: [
          { key: "i", label: "#", align: "right" },
          { key: "name", label: "Investor" },
          { key: "type", label: "Type", filter: true },
          { key: "tier", label: "Tier", filter: true },
          { key: "connection", label: "Connection", filter: true },
          { key: "contacts", label: "Contacts", align: "right" },
        ],
        item: "Fund",
        rows: planned.map((p, i) => {
          const f = byId.get(p.firmId);
          return { i: i + 1, name: f?.name ?? p.firmId, type: f?.type ?? "", tier: TIER_LABEL[p.tier], connection: f ? connection(f) : "", contacts: p.slots };
        }),
        details: planned.map((p) => {
          const f = byId.get(p.firmId);
          return [
            { label: "Tier", value: `${TIER_LABEL[p.tier]}, #${p.rank} in the tier` },
            { label: "Website", value: f?.website ? { text: f.website.replace(/^https?:\/\//, "").replace(/\/$/, ""), href: f.website } : "" },
            { label: "Matched on", value: f?.hit ?? [] },
            { label: "Backed a competitor", value: f?.backed ?? [] },
            { label: "At the client's stage", value: f?.sameStage ?? [] },
            { label: "Backed a comparable company", value: f?.comparables ?? [] },
            { label: "Named by you", value: f?.clientNamed ? "Yes" : "" },
            { label: "Look-alike score", value: f ? f.lookAlike.toFixed(2) : "" },
            { label: "Sub-sectors listed", value: f ? String(f.focus) : "" },
            { label: "Contacts in the plan", value: `${p.slots} of ${f?.contacts ?? p.slots} available` },
            { label: "Source", value: f?.source ?? "" },
          ];
        }),
      },
    ],
  };
}

/**
 * Step 2 or Step 3 as one step: the companies researched, the investors
 * behind them, and what they added to the client's list. The companies and
 * investors themselves are in the overviews (Competitive / Peers Landscape).
 */
function layerStep(companies: Competitor[], investors: Investor[], rows: CheckRow[], peers: boolean): SummaryStep {
  const count = (f: (r: CheckRow) => boolean) => rows.filter(f).length;
  const inList = count((r) => r.bucket === "in_list");
  const back = count((r) => r.bucket === "not_in_list" && r.action === "bring_back");
  const added = count((r) => r.bucket === "added" && !!r.added && r.added.status !== "rejected");
  const left = rows.length - inList - back - added;
  const named = investors.filter((i) => i.clientNamed).length;
  const line = (result: string, value: number) => ({ result, investors: n(value) });
  return {
    key: peers ? "step3" : "step2",
    button: peers ? "Step 3" : "Step 2",
    title: peers ? "Companies Like You" : "Competitive Landscape",
    headline: { value: back + added, label: peers ? "Investors added from companies like you" : "Investors added from your competitors" },
    line: `${n(inList)} more already on the short list, now tagged as having backed ${peers ? "a company like you" : "a competitor"}.`,
    tables: [
      {
        columns: [
          { key: "result", label: "Result" },
          { key: "investors", label: "#", align: "right" },
        ],
        rows: [
          line(peers ? "Companies like you researched" : "Funded competitors researched", companies.length),
          line(peers ? "Investors behind them" : "Investors behind them", investors.length - named),
          ...(named ? [line("Investors you named", named)] : []),
          line("Already on the short list", inList),
          line("Brought back from the database", back),
          line("New, added to the database", added),
          line("Left out (didn't fit, or couldn't be added)", left),
        ],
        total: line("Added to your list", back + added),
      },
    ],
  };
}

export function matchingSummary(input: MatchingInputs): Summary {
  const steps: SummaryStep[] = [stepOne(input.dry)];
  if (input.landscape) steps.push(layerStep(input.landscape.competitors, input.landscape.investors, input.rows, false));
  if (input.like) steps.push(layerStep(input.like.companies, input.like.investors, input.like.rows, true));
  steps.push(rosterStep(input.roster, input.plan), planStep(input.plan));
  return { kind: "matching", title: "Matching Summary", clientName: input.clientName, steps };
}

type OverviewInput = {
  clientName: string;
  companies: Competitor[];
  investors: Investor[];
  rows: CheckRow[];
  /** Fund Database ids on the Final Outreach Roster. */
  outreach: Set<string>;
};

/** The investors tab of an overview: who backed the companies, and whether each is on the outreach list. */
function overviewInvestors(input: OverviewInput, title: string): SummaryStep {
  const firmOf = new Map(input.rows.map((r) => [r.investor.id, r.firmId ?? r.added?.firmId ?? null]));
  const sorted = [...input.investors].sort((a, b) => b.backed.length - a.backed.length || a.name.localeCompare(b.name));
  const listed = (i: Investor) => {
    const id = firmOf.get(i.id);
    return id ? input.outreach.has(id) : false;
  };
  const onList = sorted.filter(listed).length;
  return {
    key: "investors",
    button: "Their Investors",
    title,
    headline: { value: input.investors.length, label: `Investors, ${n(onList)} on your outreach list` },
    tables: [
      {
        item: "Investor",
        columns: [
          { key: "name", label: "Investor" },
          { key: "kind", label: "Type" },
          { key: "backed", label: "Backed" },
          { key: "outreach", label: "On your outreach list" },
        ],
        rows: sorted.map((i) => ({ name: i.name, kind: KIND_LABEL[i.kind], backed: backedShort(i.backed.map((b) => b.competitor)), outreach: listed(i) ? "Yes" : "No" })),
        details: sorted.map((i) => [
          { label: "Type", value: KIND_LABEL[i.kind] },
          { label: "Website", value: i.website ? { text: i.website.replace(/^https?:\/\//, "").replace(/\/$/, ""), href: i.website } : "" },
          { label: "Backed (round)", value: backingDetails(i) },
          { label: "On your outreach list", value: listed(i) ? "Yes" : "No" },
        ]),
      },
    ],
  };
}

/**
 * The Competitive Landscape Overview, a bonus for the client: the funded
 * competitors, and the investors behind them, with whether each is on the
 * client's outreach list (the Final Outreach Roster).
 */
export function landscapeSummary(input: OverviewInput): Summary {
  return {
    kind: "landscape",
    title: "Competitive Landscape Overview",
    clientName: input.clientName,
    steps: [
      competitorsStep(input.companies, "competitors", "Competitors", "Funded Competitors", true),
      overviewInvestors(input, "Who Backed Your Competitors"),
    ],
  };
}

/**
 * The Peers Landscape Overview: Step 3's companies like the client (same
 * bet, not rivals), and the investors behind them.
 */
export function peersSummary(input: OverviewInput): Summary {
  return {
    kind: "peers",
    title: "Peers Landscape Overview",
    clientName: input.clientName,
    steps: [
      competitorsStep(input.companies, "peers", "Peer Companies", "Companies Investors See as the Same Bet", true),
      overviewInvestors(input, "Who Backed Your Peers"),
    ],
  };
}


/** A cell as plain text (for the export). */
export function cellText(cell: Cell | undefined): string {
  if (cell === undefined || cell === null) return "";
  return typeof cell === "object" ? cell.text : String(cell);
}
