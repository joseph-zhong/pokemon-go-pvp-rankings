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

export interface RankResult {
  level: number;
  cp: number;
  statProduct: number;
  bestStatProduct: number;
  percentage: number; // 0-100, this combo's stat product relative to the league's best
  rank: number; // 1-indexed, 1 is best
  total: number; // always 4096 (16^3)
}

/**
 * Ranks one IV combination against all 4096 possible combinations for a
 * given species and league. Mirrors PvPoke's ranking method (see
 * design-doc.md section 2): for every combo, find the highest level under
 * the CP cap, sort by stat product (Atk * Def * HP) descending.
 *
 * We intentionally don't restrict the IV floor for legendaries/shadows the
 * way PvPoke's "best IV to catch" tool does — this checker ranks whatever
 * IVs a Pokemon actually has, against the full 0-15 range, which is what
 * every "rank X / 4096" display (including the one this project mirrors)
 * shows to players.
 */
export function rankIvs(base: BaseStats, ivs: Ivs, league: League, levelCap = MAX_LEVEL): RankResult {
  const combos: { ivs: Ivs; statProduct: number }[] = [];

  for (let hp = 15; hp >= 0; hp--) {
    for (let def = 15; def >= 0; def--) {
      for (let atk = 15; atk >= 0; atk--) {
        const comboIvs: Ivs = { atk, def, hp };
        const level = bestLevelForCap(base, comboIvs, league.cpCap, levelCap);
        combos.push({ ivs: comboIvs, statProduct: statProduct(base, comboIvs, level) });
      }
    }
  }

  // Stable sort preserves generation order (hp desc, def desc, atk desc) on
  // ties, matching PvPoke's behavior.
  combos.sort((a, b) => b.statProduct - a.statProduct);

  const bestStatProduct = combos[0]!.statProduct;
  const rank = combos.findIndex((c) => c.ivs.atk === ivs.atk && c.ivs.def === ivs.def && c.ivs.hp === ivs.hp) + 1;
  const level = bestLevelForCap(base, ivs, league.cpCap, levelCap);
  const sp = statProduct(base, ivs, level);

  return {
    level,
    cp: calcCp(base, ivs, level),
    statProduct: sp,
    bestStatProduct,
    percentage: (sp / bestStatProduct) * 100,
    rank,
    total: combos.length,
  };
}
