// "Competitive Landscape & Deals": a short slide deck prepared for one client
// (the funded competitors, the peer companies, and which of their investors
// are on the client's outreach list). Curated, not generated: the deck is
// stored as data per client and shown only when one exists. Pure module: the
// shape, and a reader that keeps only what has that shape.

export type DeckPill = "mint" | "grey" | "orange";

/** A table cell: plain text, or text with a second line, a small tag, or drawn as a pill. */
export type DeckCell = string | { text: string; sub?: string; tag?: string; pill?: DeckPill; muted?: boolean };
/** width: percent of the table. strong: the column that matters (the round). */
export type DeckColumn = { key: string; label: string; width?: number; align?: "right"; strong?: boolean };
/** The band under the slide's content: one line worth remembering. */
export type DeckNote = { tone: "navy" | "mint"; label: string; text: string };

type SlideBase = {
  /** The toggle's label in the viewer ("Competitors"). */
  tab: string;
  eyebrow: string;
  title: string;
  subtitle?: string;
  note?: DeckNote;
  /** After the deck's name in the footer ("Rounds as publicly announced, checked Nov 12, 2026"). */
  footer?: string;
};

/** One row per company; the first column is the company (its `sub` is what it does). */
export type DeckTableSlide = SlideBase & { kind: "table"; columns: DeckColumn[]; rows: Record<string, DeckCell>[] };

export type DeckInvestor = { name: string; tone?: DeckPill };
export type DeckInvestorGroup = { title: string; tone: DeckPill; rows: { company: string; investors: DeckInvestor[] }[] };
/** Headline counts, then the investors named per company they backed. */
export type DeckInvestorsSlide = SlideBase & {
  kind: "investors";
  stats: { value: string; label: string; highlight?: boolean }[];
  groups: DeckInvestorGroup[];
  legend?: { tone: DeckPill; label: string }[];
};

export type DeckSlide = DeckTableSlide | DeckInvestorsSlide;
export type DealsDeck = { title: string; slides: DeckSlide[] };

export const DEALS_DECK_TITLE = "Competitive Landscape & Deals";
/** A slide is one 16:9 page: more than this does not fit. */
export const MAX_TABLE_ROWS = 10;
export const MAX_SLIDES = 6;

const PILLS: readonly string[] = ["mint", "grey", "orange"];
const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const text = (v: unknown) => (typeof v === "string" ? v.trim() : "");
const optional = (v: unknown) => text(v) || undefined;
const pill = (v: unknown): DeckPill | undefined => (typeof v === "string" && PILLS.includes(v) ? (v as DeckPill) : undefined);

function cell(v: unknown): DeckCell | null {
  if (typeof v === "string") return v;
  if (typeof v === "number") return String(v);
  if (!isRecord(v) || !text(v.text)) return null;
  return {
    text: text(v.text),
    ...(optional(v.sub) ? { sub: optional(v.sub) } : {}),
    ...(optional(v.tag) ? { tag: optional(v.tag) } : {}),
    ...(pill(v.pill) ? { pill: pill(v.pill) } : {}),
    ...(v.muted === true ? { muted: true } : {}),
  };
}

function note(v: unknown): DeckNote | undefined {
  if (!isRecord(v) || !text(v.label) || !text(v.text)) return undefined;
  return { tone: v.tone === "mint" ? "mint" : "navy", label: text(v.label), text: text(v.text) };
}

function base(v: Record<string, unknown>): SlideBase | null {
  if (!text(v.tab) || !text(v.title)) return null;
  return {
    tab: text(v.tab),
    eyebrow: text(v.eyebrow),
    title: text(v.title),
    ...(optional(v.subtitle) ? { subtitle: optional(v.subtitle) } : {}),
    ...(note(v.note) ? { note: note(v.note) } : {}),
    ...(optional(v.footer) ? { footer: optional(v.footer) } : {}),
  };
}

function tableSlide(v: Record<string, unknown>, b: SlideBase): DeckTableSlide | null {
  if (!Array.isArray(v.columns) || !Array.isArray(v.rows)) return null;
  const columns: DeckColumn[] = [];
  for (const c of v.columns) {
    if (!isRecord(c) || !text(c.key) || !text(c.label)) return null;
    columns.push({
      key: text(c.key),
      label: text(c.label),
      ...(typeof c.width === "number" && c.width > 0 && c.width <= 100 ? { width: c.width } : {}),
      ...(c.align === "right" ? { align: "right" as const } : {}),
      ...(c.strong === true ? { strong: true } : {}),
    });
  }
  if (!columns.length || v.rows.length === 0 || v.rows.length > MAX_TABLE_ROWS) return null;
  const rows: Record<string, DeckCell>[] = [];
  for (const r of v.rows) {
    if (!isRecord(r)) return null;
    const row: Record<string, DeckCell> = {};
    for (const c of columns) {
      const value = cell(r[c.key]);
      if (value !== null) row[c.key] = value;
    }
    // Every row names its company.
    if (row[columns[0].key] === undefined) return null;
    rows.push(row);
  }
  return { ...b, kind: "table", columns, rows };
}

function investorsSlide(v: Record<string, unknown>, b: SlideBase): DeckInvestorsSlide | null {
  if (!Array.isArray(v.groups) || !v.groups.length) return null;
  const stats = (Array.isArray(v.stats) ? v.stats : [])
    .filter(isRecord)
    .filter((s) => text(s.value) && text(s.label))
    .map((s) => ({ value: text(s.value), label: text(s.label), ...(s.highlight === true ? { highlight: true } : {}) }));
  const groups: DeckInvestorGroup[] = [];
  for (const g of v.groups) {
    if (!isRecord(g) || !text(g.title) || !Array.isArray(g.rows)) return null;
    const rows = [];
    for (const r of g.rows) {
      if (!isRecord(r) || !text(r.company) || !Array.isArray(r.investors)) return null;
      const investors = r.investors
        .filter(isRecord)
        .filter((i) => text(i.name))
        .map((i) => ({ name: text(i.name), ...(pill(i.tone) ? { tone: pill(i.tone) } : {}) }));
      if (!investors.length) return null;
      rows.push({ company: text(r.company), investors });
    }
    if (!rows.length) return null;
    groups.push({ title: text(g.title), tone: pill(g.tone) ?? "mint", rows });
  }
  const legend = (Array.isArray(v.legend) ? v.legend : [])
    .filter(isRecord)
    .filter((l) => pill(l.tone) && text(l.label))
    .map((l) => ({ tone: pill(l.tone) as DeckPill, label: text(l.label) }));
  return { ...b, kind: "investors", stats, groups, ...(legend.length ? { legend } : {}) };
}

/**
 * The stored deck, kept only when every slide has the deck shape. One bad
 * slide drops the whole deck: a client never sees half of one.
 */
export function asDealsDeck(value: unknown): DealsDeck | null {
  if (!isRecord(value) || !Array.isArray(value.slides)) return null;
  if (value.slides.length === 0 || value.slides.length > MAX_SLIDES) return null;
  const slides: DeckSlide[] = [];
  for (const raw of value.slides) {
    if (!isRecord(raw)) return null;
    const b = base(raw);
    if (!b) return null;
    const slide = raw.kind === "table" ? tableSlide(raw, b) : raw.kind === "investors" ? investorsSlide(raw, b) : null;
    if (!slide) return null;
    slides.push(slide);
  }
  return { title: text(value.title) || DEALS_DECK_TITLE, slides };
}

/** A cell as plain text. */
export function deckCellText(c: DeckCell | undefined): string {
  if (c === undefined) return "";
  return typeof c === "string" ? c : c.text;
}
