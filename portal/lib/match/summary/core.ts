// The matching summary and the Competitive Landscape Overview: clean tables,
// one per step, built from what each step confirmed. Pure module: the server
// loads the inputs; the page, the client page and the Excel export all show
// the same model. Only what people care about: no dates, no "confirmed by",
// no buttons, no process notes.

import { DRY_STEP_LABEL, type DryStep } from "../dry/core.ts";
import { KIND_LABEL, type Investor } from "../landscape/investors.ts";
import type { Competitor } from "../landscape/core.ts";
import type { CheckRow } from "../landscape/check.ts";
import type { RosterCounts } from "../roster/core.ts";
import { TIER_LABEL, waterfall, type PlanFund, type PlanInputs, type Planned } from "../plan/core.ts";

export type Cell = string | number | { text: string; href: string };
export type Column = { key: string; label: string; align?: "right" };
export type SummaryTable = {
  title?: string;
  columns: Column[];
  rows: Record<string, Cell>[];
  /** Bold last row (a total). */
  total?: Record<string, Cell>;
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
  kind: "matching" | "landscape";
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

function round(c: Competitor) {
  return [c.funding.lastRound, c.funding.lastRoundDate].filter(Boolean).join(", ");
}

function competitorsStep(competitors: Competitor[], key: string, button: string, title: string, withSources: boolean): SummaryStep {
  return {
    key,
    button,
    title,
    headline: { value: competitors.length, label: competitors.length === 1 ? "Funded competitor" : "Funded competitors" },
    tables: [
      {
        columns: [
          { key: "name", label: "Competitor" },
          { key: "what", label: "What it does" },
          { key: "hq", label: "HQ" },
          { key: "round", label: "Latest round" },
          { key: "raised", label: "Total raised" },
          { key: "investors", label: "Investors named" },
          ...(withSources ? [{ key: "source", label: "Source" }] : []),
        ],
        rows: competitors.map((c) => ({
          name: c.website ? { text: c.name, href: c.website } : c.name,
          what: c.oneLiner,
          hq: c.hq,
          round: round(c),
          raised: c.funding.totalRaised,
          investors: c.funding.investors.join(", "),
          ...(withSources ? { source: c.newsUrl ? { text: c.newsTitle || "Article", href: c.newsUrl } : "" } : {}),
        })),
      },
    ],
  };
}

function backedText(i: Investor) {
  return i.backed.map((b) => [b.competitor, b.round, b.lead ? "led" : ""].filter(Boolean).join(" · ")).join("; ");
}

function investorsStep(investors: Investor[]): SummaryStep {
  const sorted = [...investors].sort((a, b) => b.backed.length - a.backed.length || a.name.localeCompare(b.name));
  return {
    key: "step2b",
    button: "Step 2B",
    title: "Investors in the Competitors",
    headline: { value: investors.length, label: "Investors found" },
    tables: [
      {
        columns: [
          { key: "name", label: "Investor" },
          { key: "kind", label: "Type" },
          { key: "backed", label: "Backed (round)" },
        ],
        rows: sorted.map((i) => ({ name: i.website ? { text: i.name, href: i.website } : i.name, kind: KIND_LABEL[i.kind], backed: backedText(i) })),
      },
    ],
  };
}

function checkStep(rows: CheckRow[]): SummaryStep {
  const count = (f: (r: CheckRow) => boolean) => rows.filter(f).length;
  const inList = count((r) => r.bucket === "in_list");
  const back = count((r) => r.bucket === "not_in_list" && r.action === "bring_back");
  const out = count((r) => r.bucket === "not_in_list" && r.action !== "bring_back");
  const added = count((r) => r.bucket === "added");
  const funds = count((r) => r.bucket === "missing_fund");
  const angels = count((r) => r.bucket === "missing_angel");
  const open = count((r) => r.bucket === "confirm");
  const line = (result: string, value: number) => ({ result, investors: n(value) });
  return {
    key: "step2c",
    button: "Step 2C",
    title: "Checked Against the Database",
    headline: { value: inList + back, label: "Competitor investors used in the match" },
    tables: [
      {
        columns: [
          { key: "result", label: "Result" },
          { key: "investors", label: "Investors", align: "right" },
        ],
        rows: [
          line("Already on the short list", inList),
          line("In the database, brought back", back),
          line("In the database, left out", out),
          line("Not in the database: added (Step 2D)", added),
          line("Not in the database: funds, not added", funds),
          line("Not in the database: angels, not added", angels),
          ...(open ? [line("Unresolved", open)] : []),
        ],
        total: line("All competitor investors", rows.length),
      },
    ],
  };
}

function addedStep(rows: CheckRow[]): SummaryStep {
  const added = rows.filter((r) => r.bucket === "added" && r.added && r.added.status !== "rejected");
  return {
    key: "step2d",
    button: "Step 2D",
    title: "Added to the Database",
    headline: { value: added.length, label: "Investors added" },
    tables: [
      {
        columns: [
          { key: "name", label: "Investor" },
          { key: "kind", label: "Type" },
          { key: "backed", label: "Backed" },
          { key: "contacts", label: "Contacts", align: "right" },
        ],
        rows: added.map((r) => ({
          name: r.added!.website ? { text: r.investor.name, href: r.added!.website } : r.investor.name,
          kind: KIND_LABEL[r.investor.kind],
          backed: r.investor.backed.map((b) => b.competitor).join(", "),
          contacts: n(r.added!.contacts),
        })),
      },
    ],
  };
}

function rosterStep(c: RosterCounts): SummaryStep {
  const line = (source: string, investors: string) => ({ source, investors });
  return {
    key: "step3",
    button: "Step 3",
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
          line("Brought back (Step 2C)", `+${n(c.broughtBack)}`),
          line("Added (Step 2D)", `+${n(c.added)}`),
          line("Excluded by the client", minus(c.excluded)),
        ],
        total: line("The Final Roster", n(c.total)),
      },
      {
        columns: [
          { key: "what", label: "Of which" },
          { key: "investors", label: "Investors", align: "right" },
        ],
        rows: [{ what: "Backed a competitor", investors: n(c.backed) }],
      },
    ],
  };
}

export function planStep(plan: MatchingInputs["plan"]): SummaryStep {
  const { inputs, planned, funds } = plan;
  const w = waterfall(funds, plan.capacityContacts, inputs.contactsPerFund);
  const byId = new Map(funds.map((f) => [f.firmId, f]));
  const months = `${inputs.months} ${inputs.months === 1 ? "month" : "months"}`;
  return {
    key: "step4",
    button: "Step 4",
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
        columns: [
          { key: "i", label: "#", align: "right" },
          { key: "tier", label: "Tier" },
          { key: "name", label: "Investor" },
          { key: "backed", label: "Backed a competitor" },
          { key: "contacts", label: "Contacts", align: "right" },
        ],
        rows: planned.map((p, i) => {
          const f = byId.get(p.firmId);
          return {
            i: i + 1,
            tier: TIER_LABEL[p.tier],
            name: f?.website ? { text: f.name, href: f.website } : f?.name ?? p.firmId,
            backed: f?.backed.join(", ") ?? "",
            contacts: p.slots,
          };
        }),
      },
    ],
  };
}

export function matchingSummary(input: MatchingInputs): Summary {
  const steps: SummaryStep[] = [stepOne(input.dry)];
  if (input.landscape) {
    steps.push(
      competitorsStep(input.landscape.competitors, "step2a", "Step 2A", "Funded Competitors", false),
      investorsStep(input.landscape.investors),
      checkStep(input.rows),
      addedStep(input.rows),
    );
  }
  steps.push(rosterStep(input.roster), planStep(input.plan));
  return { kind: "matching", title: "Matching Summary", clientName: input.clientName, steps };
}

/**
 * The Competitive Landscape Overview, a bonus for the client: the funded
 * competitors, and the investors behind them, with whether each is on the
 * client's outreach list (the Final Outreach Roster).
 */
export function landscapeSummary(input: {
  clientName: string;
  competitors: Competitor[];
  investors: Investor[];
  rows: CheckRow[];
  /** Fund Database ids on the Final Outreach Roster. */
  outreach: Set<string>;
}): Summary {
  const firmOf = new Map(input.rows.map((r) => [r.investor.id, r.firmId ?? r.added?.firmId ?? null]));
  const sorted = [...input.investors].sort((a, b) => b.backed.length - a.backed.length || a.name.localeCompare(b.name));
  const onList = sorted.filter((i) => {
    const id = firmOf.get(i.id);
    return id ? input.outreach.has(id) : false;
  }).length;
  return {
    kind: "landscape",
    title: "Competitive Landscape Overview",
    clientName: input.clientName,
    steps: [
      competitorsStep(input.competitors, "competitors", "Competitors", "Funded Competitors", true),
      {
        key: "investors",
        button: "Their Investors",
        title: "Who Backed Your Competitors",
        headline: { value: input.investors.length, label: `Investors, ${n(onList)} on your outreach list` },
        tables: [
          {
            columns: [
              { key: "name", label: "Investor" },
              { key: "kind", label: "Type" },
              { key: "backed", label: "Backed (round)" },
              { key: "outreach", label: "On your outreach list" },
            ],
            rows: sorted.map((i) => {
              const id = firmOf.get(i.id);
              return {
                name: i.website ? { text: i.name, href: i.website } : i.name,
                kind: KIND_LABEL[i.kind],
                backed: backedText(i),
                outreach: id && input.outreach.has(id) ? "Yes" : "No",
              };
            }),
          },
        ],
      },
    ],
  };
}


/** A cell as plain text (for the export). */
export function cellText(cell: Cell | undefined): string {
  if (cell === undefined || cell === null) return "";
  return typeof cell === "object" ? cell.text : String(cell);
}
