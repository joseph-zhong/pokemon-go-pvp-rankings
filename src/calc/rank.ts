// Pure IV-ranking math. No DOM, no fetch — safe to unit test in isolation
// and safe to run on every keystroke (a full 4096-combo rank takes well
// under a millisecond).
import { cpmForLevel, MAX_LEVEL, MIN_LEVEL } from "./cpm";

export interface BaseStats {
  atk: number;
  def: number;
  hp: number;
}

export interface Ivs {
  atk: number;
  def: number;
  hp: number;
}

export interface League {
  id: string;
  label: string;
  /** CP cap for this league, or null for no cap (Master League). */
  cpCap: number | null;
}

export const LEAGUES: readonly League[] = [
  { id: "great", label: "Great League", cpCap: 1500 },
  { id: "ultra", label: "Ultra League", cpCap: 2500 },
  { id: "master", label: "Master League", cpCap: null },
];

export function leagueById(id: string): League {
  const league = LEAGUES.find((l) => l.id === id);
  if (!league) throw new Error(`Unknown league: ${id}`);
  return league;
}

function statsAtLevel(base: BaseStats, ivs: Ivs, level: number) {
  const cpm = cpmForLevel(level);
  return {
    atk: (base.atk + ivs.atk) * cpm,
    def: (base.def + ivs.def) * cpm,
    hp: Math.max(Math.floor((base.hp + ivs.hp) * cpm), 10),
  };
}

export function calcCp(base: BaseStats, ivs: Ivs, level: number): number {
  const cpm = cpmForLevel(level);
  const cp = Math.floor(
    ((base.atk + ivs.atk) * Math.sqrt(base.def + ivs.def) * Math.sqrt(base.hp + ivs.hp) * cpm * cpm) / 10,
  );
  return Math.max(cp, 10);
}

/** Highest level at or under `levelCap` whose CP does not exceed `cpCap`. */
export function bestLevelForCap(base: BaseStats, ivs: Ivs, cpCap: number | null, levelCap = MAX_LEVEL): number {
  if (cpCap === null) return levelCap;

  let best = MIN_LEVEL;
  for (let level = MIN_LEVEL; level <= levelCap + 1e-9; level += 0.5) {
    if (calcCp(base, ivs, level) > cpCap) break;
    best = level;
  }
  return best;
}

export function statProduct(base: BaseStats, ivs: Ivs, level: number): number {
  const stats = statsAtLevel(base, ivs, level);
  return stats.atk * stats.def * stats.hp;
}

export interface RankedCombo {
  ivs: Ivs;
  level: number;
  cp: number;
  statProduct: number;
  percentage: number; // 0-100, this combo's stat product relative to the league's best
  rank: number; // 1-indexed, 1 is best
}

/**
 * Ranks all 4096 possible IV combinations for a given species and league.
 * Mirrors PvPoke's ranking method (see design-doc.md section 2): for every
 * combo, find the highest level under the CP cap, sort by stat product
 * (Atk * Def * HP) descending.
 *
 * We intentionally don't restrict the IV floor for legendaries/shadows the
 * way PvPoke's "best IV to catch" tool does — this checker ranks whatever
 * IVs a Pokemon actually has, against the full 0-15 range, which is what
 * every "rank X / 4096" display (including the one this project mirrors)
 * shows to players.
 *
 * This only needs recomputing when species, league, or level cap changes —
 * the result is the single source of truth for a query's own rank, the
 * top-5 list, the nearby-ranks list, and the rank explorer slider (see
 * design-doc.md section 10-11), all without redoing the 4096-combo sort.
 */
export function rankAllIvs(base: BaseStats, league: League, levelCap = MAX_LEVEL): RankedCombo[] {
  const combos: RankedCombo[] = [];

  for (let hp = 15; hp >= 0; hp--) {
    for (let def = 15; def >= 0; def--) {
      for (let atk = 15; atk >= 0; atk--) {
        const ivs: Ivs = { atk, def, hp };
        const level = bestLevelForCap(base, ivs, league.cpCap, levelCap);
        combos.push({
          ivs,
          level,
          cp: calcCp(base, ivs, level),
          statProduct: statProduct(base, ivs, level),
          percentage: 0, // filled in below, once we know the best
          rank: 0,
        });
      }
    }
  }

  // Stable sort preserves generation order (hp desc, def desc, atk desc) on
  // ties, matching PvPoke's behavior.
  combos.sort((a, b) => b.statProduct - a.statProduct);

  const best = combos[0]!.statProduct;
  combos.forEach((combo, i) => {
    combo.rank = i + 1;
    combo.percentage = (combo.statProduct / best) * 100;
  });

  return combos;
}

/**
 * Rank of the first combo (in this already rank-sorted array) whose
 * percentage drops below `threshold`. Used to find where a tier boundary
 * (e.g. "Great" starts at 98%) actually falls for this specific species —
 * that rank varies a lot species to species, so it can't be a fixed
 * position on the rank axis. Returns `all.length + 1` if every combo is at
 * or above the threshold (no combo falls below it).
 */
export function firstRankBelow(all: readonly RankedCombo[], threshold: number): number {
  let lo = 0;
  let hi = all.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (all[mid]!.percentage < threshold) hi = mid;
    else lo = mid + 1;
  }
  return lo + 1;
}

export function findCombo(all: readonly RankedCombo[], ivs: Ivs): RankedCombo {
  const combo = all.find((c) => c.ivs.atk === ivs.atk && c.ivs.def === ivs.def && c.ivs.hp === ivs.hp);
  if (!combo) throw new Error(`No combo found for IVs ${ivs.atk}/${ivs.def}/${ivs.hp}`);
  return combo;
}
