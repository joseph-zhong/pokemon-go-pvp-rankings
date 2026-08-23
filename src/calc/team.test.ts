import { describe, expect, it } from "vitest";
import { analyzeTeamThreats, suggestTeam, suggestTeams, type TeamCandidate } from "./team";

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

describe("suggestTeams", () => {
  it("seeds each alternative from a different overall rank, not leftovers from the previous team", () => {
    const pool: TeamCandidate[] = Array.from({ length: 6 }, (_, i) => ({
      id: `p${i}`,
      score: 100 - i, // p0 best, p5 worst
      counters: [],
    }));
    const teams = suggestTeams(pool, 3, 3);
    expect(teams).toHaveLength(3);
    expect(teams[0]![0]!.id).toBe("p0");
    expect(teams[1]![0]!.id).toBe("p1");
    expect(teams[2]![0]!.id).toBe("p2");
  });

  it("lets a strong candidate appear in more than one alternative — these are different starting points, not a partition", () => {
    // b is the ideal diversifying partner for both a and c (no overlap with
    // either), so it's expected to show up filling out both team 1 and 2.
    const pool: TeamCandidate[] = [
      { id: "a", score: 100, counters: ["x"] },
      { id: "c", score: 90, counters: ["x"] },
      { id: "b", score: 80, counters: ["y"] },
      { id: "d", score: 70, counters: ["y"] },
    ];
    const teams = suggestTeams(pool, 2, 2);
    expect(teams[0]!.map((t) => t.id)).toEqual(["a", "b"]);
    expect(teams[1]!.map((t) => t.id)).toEqual(["c", "b"]);
  });

  it("returns fewer teams than requested when the pool is too small, without crashing", () => {
    const pool: TeamCandidate[] = [{ id: "a", score: 100, counters: [] }];
    expect(suggestTeams(pool, 3, 3)).toHaveLength(1);
  });

  it("returns no teams for an empty pool", () => {
    expect(suggestTeams([], 3, 3)).toEqual([]);
  });
});

describe("analyzeTeamThreats", () => {
  it("ranks an opponent that counters two members above one that only counters one", () => {
    const team: TeamCandidate[] = [
      { id: "a", score: 100, counters: ["shared", "onlyA"] },
      { id: "b", score: 90, counters: ["shared", "onlyB"] },
      { id: "c", score: 80, counters: ["onlyC"] },
    ];
    const threats = analyzeTeamThreats(team);
    expect(threats[0]).toEqual({ opponentId: "shared", beatsCount: 2, beats: ["a", "b"] });
    // The single-member threats can come in either order but must both be present at count 1.
    expect(threats.slice(1).every((t) => t.beatsCount === 1)).toBe(true);
    expect(threats.map((t) => t.opponentId)).toContain("onlyA");
    expect(threats.map((t) => t.opponentId)).toContain("onlyB");
    expect(threats.map((t) => t.opponentId)).toContain("onlyC");
  });

  it("returns no shared threats when no opponent counters more than one member", () => {
    const team: TeamCandidate[] = [
      { id: "a", score: 100, counters: ["x"] },
      { id: "b", score: 90, counters: ["y"] },
    ];
    const threats = analyzeTeamThreats(team);
    expect(threats.every((t) => t.beatsCount === 1)).toBe(true);
  });

  it("returns nothing for a team with no listed counters", () => {
    const team: TeamCandidate[] = [{ id: "a", score: 100, counters: [] }];
    expect(analyzeTeamThreats(team)).toEqual([]);
  });
});
