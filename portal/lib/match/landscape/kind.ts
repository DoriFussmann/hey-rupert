// The two enrichment layers that share the Step 2 machinery: the funded
// direct competitors (Step 2) and the companies like you (Step 3: funded
// comparable companies, plus strategics and leads the founder names). Pure.

export type LandscapeKind = "competitors" | "comparables";

export const LANDSCAPE_KINDS: LandscapeKind[] = ["competitors", "comparables"];

export function asLandscapeKind(value: unknown): LandscapeKind {
  return value === "comparables" ? "comparables" : "competitors";
}

/** The words the screens use for each layer. */
export const KIND_TEXT: Record<
  LandscapeKind,
  {
    step: "2" | "3";
    title: string;
    company: string;
    companies: string;
    Companies: string;
    /** 2A / 3A heading. */
    listTitle: string;
    find: string;
    why: string;
    add: string;
    none: string;
    intro: string;
    skipped: string;
    investorsTitle: string;
    backed: string;
  }
> = {
  competitors: {
    step: "2",
    title: "Competitive Landscape Enrichment",
    company: "competitor",
    companies: "competitors",
    Companies: "Competitors",
    listTitle: "Funded competitors",
    find: "Show Competitors",
    why: "Why it's a direct competitor",
    add: "Add competitor",
    none: "No funded direct competitors found.",
    intro: "funded direct competitors, most relevant first. Check each website and funding article, then confirm. None found? Confirm the empty list to skip Step 2.",
    skipped: "No funded competitors were confirmed, so Steps 2B to 2D are skipped.",
    investorsTitle: "Investors in the competitors",
    backed: "Backed a competitor",
  },
  comparables: {
    step: "3",
    title: "Companies Like You",
    company: "comparable company",
    companies: "comparable companies",
    Companies: "Comparable companies",
    listTitle: "Comparable companies",
    find: "Find Comparable Companies",
    why: "Why investors see it as the same bet",
    add: "Add company",
    none: "No funded comparable companies found.",
    intro:
      "funded companies that aren't direct competitors but that investors see as the same bet (adjacent products, the same buyer, the same workflow), the founder's own suggestions first. Confirm the empty list to skip Step 3.",
    skipped: "No comparable companies were confirmed, so Steps 3B to 3D are skipped.",
    investorsTitle: "Investors in comparable companies, and investors the client named",
    backed: "Backed a comparable",
  },
};
