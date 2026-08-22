// Greedy counter-diversity team suggester. See plans/pvp/design-doc.md
// section 3 for why this exists instead of naive top-3-by-score (three
// answers to the same matchup isn't a team) or a full synergy search
// (real complexity, unclear payoff for a v1).
export interface TeamCandidate {
  id: string;
  score: number;
  counters: readonly string[];
}

/**
 * Builds a team of `size` by picking the highest-scoring candidate first,
 * then repeatedly picking the highest-scoring remaining candidate whose
 * counters overlap the least with everyone already picked. O(size * n) —
 * not exhaustive search over all combinations, just one reasonable team.
 */
export function suggestTeam(pool: readonly TeamCandidate[], size = 3): TeamCandidate[] {
  const sorted = [...pool].sort((a, b) => b.score - a.score);
  if (sorted.length === 0) return [];

  const team: TeamCandidate[] = [sorted[0]!];
  const usedCounters = new Set(sorted[0]!.counters);
  const remaining = sorted.slice(1);

  while (team.length < size && remaining.length > 0) {
    let bestIndex = 0;
    let bestOverlap = Infinity;
    for (let i = 0; i < remaining.length; i++) {
      const overlap = remaining[i]!.counters.filter((c) => usedCounters.has(c)).length;
      if (overlap < bestOverlap) {
        bestOverlap = overlap;
        bestIndex = i;
      }
    }
    const [picked] = remaining.splice(bestIndex, 1);
    team.push(picked!);
    picked!.counters.forEach((c) => usedCounters.add(c));
  }

  return team;
}
