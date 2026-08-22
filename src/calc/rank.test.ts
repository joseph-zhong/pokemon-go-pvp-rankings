import { describe, expect, it } from "vitest";
import { cpmForLevel } from "./cpm";
import { bestLevelForCap, calcCp, leagueById, rankIvs } from "./rank";

// Reference values below were computed with an independent Python
// implementation of the same formulas against real base stats pulled from
// public/data/pokemon.min.json (see design-doc.md section 2), not copied
// from any UI. Azumarill 0/15/15 as the Great League rank-1 IV spread is
// also widely documented community knowledge, which independently confirms
// the cross-check.
const AZUMARILL = { atk: 112, def: 152, hp: 225 };
const REGISTEEL = { atk: 143, def: 285, hp: 190 };
const BULBASAUR = { atk: 118, def: 111, hp: 128 };

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

describe("rankIvs", () => {
  it("ranks Azumarill 0/15/15 as #1 in Great League", () => {
    const result = rankIvs(AZUMARILL, { atk: 0, def: 15, hp: 15 }, leagueById("great"));
    expect(result.rank).toBe(1);
    expect(result.total).toBe(4096);
    expect(result.percentage).toBeCloseTo(100, 5);
    expect(result.level).toBe(45.5);
    expect(result.cp).toBe(1499);
  });

  it("ranks Azumarill 15/15/15 far lower in Great League (low-attack bulk beats max IVs under a CP cap)", () => {
    const result = rankIvs(AZUMARILL, { atk: 15, def: 15, hp: 15 }, leagueById("great"));
    expect(result.rank).toBe(2558);
    expect(result.percentage).toBeCloseTo(93.732, 2);
  });

  it("ranks Registeel 0/15/15 near the top in Ultra League", () => {
    const result = rankIvs(REGISTEEL, { atk: 0, def: 15, hp: 15 }, leagueById("ultra"));
    expect(result.rank).toBe(26);
    expect(result.cp).toBe(2489);
  });

  it("always ranks 15/15/15 as #1 in Master League, since there's no CP cap to trade off against", () => {
    const result = rankIvs(AZUMARILL, { atk: 15, def: 15, hp: 15 }, leagueById("master"));
    expect(result.rank).toBe(1);
    expect(result.level).toBe(51);
  });
});
