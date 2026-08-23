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
 * Fills a team starting from `seed`, repeatedly picking the highest-scoring
 * remaining candidate whose counters overlap the least with everyone
 * already picked. O(size * n) — not exhaustive search over all
 * combinations, just one reasonable team from a fixed starting point.
 */
function fillTeamFrom(seed: TeamCandidate, sortedRemaining: readonly TeamCandidate[], size: number): TeamCandidate[] {
  const team: TeamCandidate[] = [seed];
  const usedCounters = new Set(seed.counters);
  const remaining = [...sortedRemaining];

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

/** One team: highest-scoring candidate first, then greedy-diverse fill. */
export function suggestTeam(pool: readonly TeamCandidate[], size = 3): TeamCandidate[] {
  const sorted = [...pool].sort((a, b) => b.score - a.score);
  if (sorted.length === 0) return [];
  return fillTeamFrom(sorted[0]!, sorted.slice(1), size);
}

/**
 * `alternatives` distinct teams, not `alternatives` near-duplicates: team N
 * is seeded from the Nth-best-scoring candidate overall (not whoever's left
 * over from team N-1), then filled the same greedy-diverse way. The same
 * strong candidate can legitimately appear in more than one alternative —
 * these are different starting points to choose between, not a partition
 * of the pool.
 */
export function suggestTeams(pool: readonly TeamCandidate[], alternatives = 3, size = 3): TeamCandidate[][] {
  const sorted = [...pool].sort((a, b) => b.score - a.score);
  const teams: TeamCandidate[][] = [];
  for (let seedIndex = 0; seedIndex < alternatives && seedIndex < sorted.length; seedIndex++) {
    const seed = sorted[seedIndex]!;
    const rest = sorted.filter((c) => c.id !== seed.id);
    teams.push(fillTeamFrom(seed, rest, size));
  }
  return teams;
}

export interface TeamThreat {
  /** Species id of the shared threat. */
  opponentId: string;
  /** How many of the team's members this one opponent counters. */
  beatsCount: number;
  /** Which team member ids it counters. */
  beats: string[];
}

/**
 * A single member's "weak to" list only tells you about that one matchup.
 * The structural weakness of a *team* is an opponent that counters more
 * than one member at once — that's a single answer your opponent can lean
 * on repeatedly, not just a bad individual matchup. Pure aggregation over
 * data already fetched (each member's `counters`), no new data or
 * simulation needed. Sorted worst-first (most members threatened).
 */
export function analyzeTeamThreats(team: readonly TeamCandidate[]): TeamThreat[] {
  const beatsByOpponent = new Map<string, string[]>();
  for (const member of team) {
    for (const opponentId of member.counters) {
      const beats = beatsByOpponent.get(opponentId) ?? [];
      beats.push(member.id);
      beatsByOpponent.set(opponentId, beats);
    }
  }
  return [...beatsByOpponent.entries()]
    .map(([opponentId, beats]) => ({ opponentId, beatsCount: beats.length, beats }))
    .sort((a, b) => b.beatsCount - a.beatsCount);
}
