export interface LeagueInfo {
  key: string;
  title: string;
  cp: number;
}

export interface TeamMemberData {
  score: number;
  counters: string[];
}

export type TeamPool = Record<string, TeamMemberData>;

let leaguesCache: Promise<LeagueInfo[]> | null = null;
const teamPoolCache = new Map<string, Promise<TeamPool>>();

export function loadLeagues(): Promise<LeagueInfo[]> {
  if (!leaguesCache) {
    leaguesCache = fetch("/data/leagues.min.json").then((res) => {
      if (!res.ok) throw new Error(`Failed to load leagues: ${res.status}`);
      return res.json();
    });
  }
  return leaguesCache;
}

/** A species with no entry for a given league isn't eligible for it (banned/wrong type/etc, whatever that league's rules are) — we don't reimplement those rules, we just trust presence in this pool. See plans/pvp/design-doc.md section 2. */
export function loadTeamPool(leagueKey: string): Promise<TeamPool> {
  let cached = teamPoolCache.get(leagueKey);
  if (!cached) {
    cached = fetch(`/data/teams/${leagueKey}.min.json`).then((res) => {
      if (!res.ok) throw new Error(`Failed to load team data for ${leagueKey}: ${res.status}`);
      return res.json();
    });
    teamPoolCache.set(leagueKey, cached);
  }
  return cached;
}
