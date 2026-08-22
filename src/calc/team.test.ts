import { describe, expect, it } from "vitest";
import { suggestTeam, type TeamCandidate } from "./team";

describe("suggestTeam", () => {
  it("returns an empty team for an empty pool", () => {
    expect(suggestTeam([])).toEqual([]);
  });

  it("returns everything available when the pool is smaller than the requested size", () => {
    const pool: TeamCandidate[] = [{ id: "a", score: 100, counters: [] }];
    expect(suggestTeam(pool, 3)).toEqual(pool);
  });

  it("always picks the highest-scoring candidate first", () => {
    const pool: TeamCandidate[] = [
      { id: "low", score: 10, counters: [] },
      { id: "high", score: 90, counters: [] },
      { id: "mid", score: 50, counters: [] },
    ];
    expect(suggestTeam(pool, 3)[0]!.id).toBe("high");
  });

  it("prefers a lower-scoring, non-overlapping pick over a higher-scoring one that shares all the same counters", () => {
    const pool: TeamCandidate[] = [
      { id: "a", score: 100, counters: ["x", "y", "z"] },
      { id: "b", score: 90, counters: ["x", "y", "z"] }, // same counters as a — redundant
      { id: "c", score: 80, counters: ["q", "r", "s"] }, // no overlap with a — genuinely diversifies
    ];
    const team = suggestTeam(pool, 3).map((c) => c.id);
    // a first (highest score), c second (diversifies away from a's counters
    // despite b's higher score), b last (only one left).
    expect(team).toEqual(["a", "c", "b"]);
  });

  it("breaks overlap ties by score, since candidates are scanned in score order", () => {
    const pool: TeamCandidate[] = [
      { id: "a", score: 100, counters: ["x"] },
      { id: "b", score: 90, counters: ["y"] }, // ties with c on overlap (both 0 vs a's counters)
      { id: "c", score: 80, counters: ["y"] },
    ];
    const team = suggestTeam(pool, 2).map((c) => c.id);
    expect(team).toEqual(["a", "b"]);
  });

  it("defaults to a team of 3", () => {
    const pool: TeamCandidate[] = Array.from({ length: 5 }, (_, i) => ({
      id: `p${i}`,
      score: 100 - i,
      counters: [],
    }));
    expect(suggestTeam(pool)).toHaveLength(3);
  });
});
