/** How many dishes get the "Best seller" tag. */
export const BEST_SELLER_COUNT = 5;

/**
 * Ids of the `limit` most-ordered dishes, highest sold_count first (ties by
 * name, so the pick is stable). Dishes that have never sold are never tagged.
 * Callers pass only the dishes guests can see, so hidden dishes don't take a slot.
 */
export function bestSellerIds(
  dishes: { id: string; name: string; sold_count: number }[],
  limit = BEST_SELLER_COUNT,
): Set<string> {
  return new Set(
    dishes
      .filter((d) => d.sold_count > 0)
      .sort((a, b) => b.sold_count - a.sold_count || a.name.localeCompare(b.name))
      .slice(0, limit)
      .map((d) => d.id),
  );
}
