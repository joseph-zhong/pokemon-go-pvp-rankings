export interface MoveInfo {
  name: string;
  type: string;
}

export interface LeagueMoveset {
  fast: string;
  charged: string[];
  altFast?: string;
  altCharged?: string;
}

export type MovesetsBySpecies = Record<string, Partial<Record<"great" | "ultra" | "master", LeagueMoveset>>>;

let movesCache: Promise<Record<string, MoveInfo>> | null = null;
let movesetsCache: Promise<MovesetsBySpecies> | null = null;

export function loadMoves(): Promise<Record<string, MoveInfo>> {
  if (!movesCache) {
    movesCache = fetch("/data/moves.min.json").then((res) => {
      if (!res.ok) throw new Error(`Failed to load moves data: ${res.status}`);
      return res.json();
    });
  }
  return movesCache;
}

/** Species PvPoke never simulated (truly unviable) just have no entry — treat as "no recommendation" rather than guessing. */
export function loadMovesets(): Promise<MovesetsBySpecies> {
  if (!movesetsCache) {
    movesetsCache = fetch("/data/movesets.min.json").then((res) => {
      if (!res.ok) throw new Error(`Failed to load movesets data: ${res.status}`);
      return res.json();
    });
  }
  return movesetsCache;
}
