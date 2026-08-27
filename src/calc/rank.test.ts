import { describe, expect, it } from "vitest";
import { cpmForLevel } from "./cpm";
import {
  bestLevelForCap,
  calcCp,
  evolutionExceedsCap,
  findCombo,
  firstRankBelow,
  leagueById,
  rankAllIvs,
  rankTableRows,
} from "./rank";

// Reference values below were computed with an independent Python
// implementation of the same formulas against real base stats pulled from
// public/data/pokemon.min.json (see design-doc.md section 2), not copied
// from any UI. Azumarill 0/15/15 as the Great League rank-1 IV spread is
// also widely documented community knowledge, which independently confirms
// the cross-check.
const AZUMARILL = { atk: 112, def: 152, hp: 225 };
const REGISTEEL = { atk: 143, def: 285, hp: 190 };
const BULBASAUR = { atk: 118, def: 111, hp: 128 };
const CHANSEY = { atk: 60, def: 128, hp: 487 };
const BLISSEY = { atk: 129, def: 169, hp: 496 };
const MAGIKARP = { atk: 29, def: 85, hp: 85 };
const GYARADOS = { atk: 237, def: 186, hp: 216 };
const LARVITAR = { atk: 115, def: 93, hp: 137 };
const PUPITAR = { atk: 155, def: 133, hp: 172 };
const TYRANITAR = { atk: 251, def: 207, hp: 225 };

describe("cpmForLevel", () => {
  it("matches known reference CPMs", () => {
    expect(cpmForLevel(1)).toBeCloseTo(0.094, 3);
    expect(cpmForLevel(40)).toBeCloseTo(0.7903, 4);
    expect(cpmForLevel(50)).toBeCloseTo(0.8403, 4);
  });

  it("rejects levels outside the supported range", () => {
    expect(() => cpmForLevel(0.5)).toThrow();
    expect(() => cpmForLevel(51.5)).toThrow();
  });
});

describe("bestLevelForCap", () => {
  it("walks up to the highest level that still fits the CP cap", () => {
    const level = bestLevelForCap(BULBASAUR, { atk: 0, def: 0, hp: 0 }, 1500);
    expect(level).toBe(51);
    expect(calcCp(BULBASAUR, { atk: 0, def: 0, hp: 0 }, level)).toBe(1005);
  });

  it("returns the level cap directly when there is no CP cap", () => {
    expect(bestLevelForCap(AZUMARILL, { atk: 15, def: 15, hp: 15 }, null)).toBe(51);
  });
});

describe("rankAllIvs / findCombo", () => {
  it("ranks Azumarill 0/15/15 as #1 in Great League", () => {
    const all = rankAllIvs(AZUMARILL, leagueById("great"));
    expect(all).toHaveLength(4096);
    const combo = findCombo(all, { atk: 0, def: 15, hp: 15 });
    expect(combo.rank).toBe(1);
    expect(combo.percentage).toBeCloseTo(100, 5);
    expect(combo.level).toBe(45.5);
    expect(combo.cp).toBe(1499);
    // Rank #1 must also be the first (best) entry in the sorted array.
    expect(all[0]).toBe(combo);
  });

  it("ranks Azumarill 15/15/15 far lower in Great League (low-attack bulk beats max IVs under a CP cap)", () => {
    const all = rankAllIvs(AZUMARILL, leagueById("great"));
    const combo = findCombo(all, { atk: 15, def: 15, hp: 15 });
    expect(combo.rank).toBe(2558);
    expect(combo.percentage).toBeCloseTo(93.732, 2);
  });

  it("ranks Registeel 0/15/15 near the top in Ultra League", () => {
    const all = rankAllIvs(REGISTEEL, leagueById("ultra"));
    const combo = findCombo(all, { atk: 0, def: 15, hp: 15 });
    expect(combo.rank).toBe(26);
    expect(combo.cp).toBe(2489);
  });

  it("always ranks 15/15/15 as #1 in Master League, since there's no CP cap to trade off against", () => {
    const all = rankAllIvs(AZUMARILL, leagueById("master"));
    const combo = findCombo(all, { atk: 15, def: 15, hp: 15 });
    expect(combo.rank).toBe(1);
    expect(combo.level).toBe(51);
  });

  it("keeps ranks contiguous from 1 to 4096 in sorted order", () => {
    const all = rankAllIvs(AZUMARILL, leagueById("great"));
    all.forEach((combo, i) => expect(combo.rank).toBe(i + 1));
  });
});

describe("firstRankBelow", () => {
  it("finds the first rank whose percentage drops below a threshold", () => {
    const all = rankAllIvs(AZUMARILL, leagueById("great"));
    const rank = firstRankBelow(all, 98);
    expect(findCombo(all, all[rank - 1]!.ivs).percentage).toBeLessThan(98);
    expect(findCombo(all, all[rank - 2]!.ivs).percentage).toBeGreaterThanOrEqual(98);
  });

  it("returns total+1 when every combo is at or above the threshold", () => {
    const all = rankAllIvs(AZUMARILL, leagueById("great"));
    expect(firstRankBelow(all, 0)).toBe(all.length + 1);
  });

  it("returns 1 when even the best combo is below the threshold", () => {
    const all = rankAllIvs(AZUMARILL, leagueById("great"));
    expect(firstRankBelow(all, 101)).toBe(1);
  });
});

describe("evolutionExceedsCap", () => {
  // Real, widely-known community advice this must match: Chansey and
  // Magikarp are the Great League picks precisely because their evolutions
  // (Blissey, Gyarados) blow past the cap if you evolve at the level that
  // was optimal for the pre-evolved form.
  const IVS = { atk: 15, def: 15, hp: 15 };

  it("flags Chansey -> Blissey as exceeding Great League", () => {
    expect(evolutionExceedsCap(CHANSEY, BLISSEY, IVS, 1500)).toBe(true);
  });

  it("flags Chansey -> Blissey as exceeding Ultra League too", () => {
    expect(evolutionExceedsCap(CHANSEY, BLISSEY, IVS, 2500)).toBe(true);
  });

  it("flags Magikarp -> Gyarados as exceeding Great League", () => {
    expect(evolutionExceedsCap(MAGIKARP, GYARADOS, IVS, 1500)).toBe(true);
  });

  it("flags Larvitar -> Pupitar as exceeding Great League", () => {
    expect(evolutionExceedsCap(LARVITAR, PUPITAR, IVS, 1500)).toBe(true);
  });

  it("flags Pupitar -> Tyranitar as exceeding Great League", () => {
    expect(evolutionExceedsCap(PUPITAR, TYRANITAR, IVS, 1500)).toBe(true);
  });

  it("does not flag evolving into the same base stats (nothing changes, cap can't be newly exceeded)", () => {
    expect(evolutionExceedsCap(AZUMARILL, AZUMARILL, IVS, 1500)).toBe(false);
  });
});

describe("rankTableRows", () => {
  // Only .rank matters here, so fake combos keep the expectations readable.
  const all = Array.from({ length: 4096 }, (_, i) => ({ rank: i + 1 }) as never);
  const ranks = (rows: ReturnType<typeof rankTableRows>) =>
    rows.map((row) => (row.kind === "gap" ? `gap:${row.skipped}` : `#${row.combo.rank}`));

  it("collapses to one contiguous block when the query is inside the top 5", () => {
    expect(ranks(rankTableRows(all, 3))).toEqual(["#1", "#2", "#3", "#4", "#5", "#6", "#7", "#8"]);
  });

  it("collapses when the window starts exactly where the top block ends", () => {
    // rank 11 -> window starts at #6, adjacent to the top 5: no gap.
    expect(ranks(rankTableRows(all, 11))).toEqual([
      "#1", "#2", "#3", "#4", "#5", "#6", "#7", "#8", "#9", "#10",
      "#11", "#12", "#13", "#14", "#15", "#16",
    ]);
  });

  it("inserts a single gap row once the window pulls away from the top", () => {
    expect(ranks(rankTableRows(all, 12))).toEqual([
      "#1", "#2", "#3", "#4", "#5", "gap:1",
      "#7", "#8", "#9", "#10", "#11", "#12", "#13", "#14", "#15", "#16", "#17",
    ]);
  });

  it("reports how many ranks the gap hides", () => {
    const rows = rankTableRows(all, 2000);
    expect(rows[5]).toEqual({ kind: "gap", skipped: 1989 });
    expect(ranks(rows).slice(6, 8)).toEqual(["#1995", "#1996"]);
  });

  it("never runs past the last rank", () => {
    const shown = ranks(rankTableRows(all, 4096));
    expect(shown[shown.length - 1]).toBe("#4096");
  });

  it("never shows the same rank twice", () => {
    for (const rank of [1, 5, 6, 10, 11, 12, 50, 4096]) {
      const shown = ranks(rankTableRows(all, rank));
      expect(new Set(shown).size).toBe(shown.length);
    }
  });
});
