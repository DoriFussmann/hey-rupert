// Look-alike funds (preview). The competitors' investors found in the Fund
// Database are funds that actually back companies like this client. Their
// stated sectors make a profile; every fund in the Step 1 shortlist is scored
// by how much it resembles that profile. Pure module; ranks only, changes
// nothing.
//
// Score: cosine similarity between the fund's sectors (each 1) and the
// profile (each sector weighted by the share of seed funds listing it). A
// fund listing many sectors is diluted (the cosine divides by the square root
// of how many it lists), so a broad generalist doesn't win by listing everything.

export type SectorFund = { id: string; name: string; sectors: string[] };

export type ProfileEntry = { sector: string; share: number };

export type LookAlike = {
  id: string;
  name: string;
  score: number;
  /** The profile's sectors this fund lists, strongest first. */
  shares: string[];
  sectorCount: number;
};

/** Each sector's share of the seed funds that list it, most common first. */
export function sectorProfile(seeds: SectorFund[]): ProfileEntry[] {
  if (!seeds.length) return [];
  const counts = new Map<string, number>();
  for (const seed of seeds) for (const s of Array.from(new Set(seed.sectors))) counts.set(s, (counts.get(s) ?? 0) + 1);
  return Array.from(counts.entries())
    .map(([sector, count]) => ({ sector, share: count / seeds.length }))
    .sort((a, b) => b.share - a.share || a.sector.localeCompare(b.sector));
}

export function lookAlikeScore(sectors: string[], profile: ProfileEntry[]): { score: number; shares: string[] } {
  const unique = Array.from(new Set(sectors));
  if (!unique.length || !profile.length) return { score: 0, shares: [] };
  const weight = new Map(profile.map((p) => [p.sector, p.share]));
  const norm = Math.sqrt(profile.reduce((sum, p) => sum + p.share * p.share, 0));
  const hit = unique.filter((s) => weight.has(s));
  const dot = hit.reduce((sum, s) => sum + (weight.get(s) ?? 0), 0);
  const score = norm ? dot / (Math.sqrt(unique.length) * norm) : 0;
  return { score: Math.round(score * 1000) / 1000, shares: hit.sort((a, b) => (weight.get(b) ?? 0) - (weight.get(a) ?? 0) || a.localeCompare(b)) };
}

/** The shortlist's funds most like the seed funds (seeds themselves left out), best first. */
export function lookAlikes(seeds: SectorFund[], candidates: SectorFund[], top = 25): { profile: ProfileEntry[]; funds: LookAlike[] } {
  const profile = sectorProfile(seeds);
  const seedIds = new Set(seeds.map((s) => s.id));
  const funds = candidates
    .filter((c) => !seedIds.has(c.id))
    .map((c) => ({ id: c.id, name: c.name, sectorCount: new Set(c.sectors).size, ...lookAlikeScore(c.sectors, profile) }))
    .filter((c) => c.score > 0)
    .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name))
    .slice(0, top);
  return { profile, funds };
}
