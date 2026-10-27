// The sending order: a proportional mix of tiers in every stretch. Pure module.

/**
 * Orders items so every stretch of the list holds the tiers in proportion
 * (e.g. 10 Core among 340 funds: about one Core in every 34). Within a tier
 * the original order is kept. Stride scheduling: each item's place is its
 * position within its tier spread evenly over the whole list.
 */
export function interleaveByTier<T extends { tier: number }>(items: T[]): T[] {
  const byTier = new Map<number, T[]>();
  for (const item of items) byTier.set(item.tier, [...(byTier.get(item.tier) ?? []), item]);
  const placed: { item: T; at: number; tier: number }[] = [];
  byTier.forEach((list, tier) => list.forEach((item, index) => placed.push({ item, at: (index + 0.5) / list.length, tier })));
  return placed.sort((a, b) => a.at - b.at || a.tier - b.tier).map((p) => p.item);
}
