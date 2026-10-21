/** Which exclusion lines match a fund, using the same name/domain rules as the matcher. */

type NamedFirm = { name: string; web: string };

function normalize(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .replace(/\/.*$/, "");
}

/** The exclusion lines the matcher actually applies, in the order they were written. */
export function exclusionEntries(text: string) {
  return text
    .split(/[\n,;]+/)
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 1);
}

function matchesFirm(entry: string, firm: NamedFirm) {
  const key = normalize(entry);
  if (key.length <= 1) return false;
  const name = firm.name.trim().toLowerCase();
  const domain = normalize(firm.web);
  return key === name || (domain !== "" && key === domain) || (key.length > 3 && name.includes(key));
}

/** Exclusion lines that hit no fund, so the match run ignored them. */
export function unmatchedExclusionEntries(text: string, firms: NamedFirm[]) {
  const missed: string[] = [];
  const seen = new Set<string>();
  for (const entry of exclusionEntries(text)) {
    if (seen.has(entry)) continue;
    seen.add(entry);
    if (!firms.some((firm) => matchesFirm(entry, firm))) missed.push(entry);
  }
  return missed;
}
