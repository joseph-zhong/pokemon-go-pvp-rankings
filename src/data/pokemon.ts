export interface PokemonEntry {
  id: string;
  name: string;
  dex: number;
  atk: number;
  def: number;
  hp: number;
  /** Primary type (e.g. "grass"), or "none" if unset upstream. */
  type: string;
  /** Species id of the direct previous evolution stage, if any. */
  parent?: string;
  /** Species ids of the direct next evolution stage(s), if any. */
  evolutions?: string[];
}

let cache: Promise<PokemonEntry[]> | null = null;

/** Fetches the slim Pokemon dataset once and caches the in-flight/resolved promise. */
export function loadPokemon(): Promise<PokemonEntry[]> {
  if (!cache) {
    cache = fetch("/data/pokemon.min.json").then((res) => {
      if (!res.ok) throw new Error(`Failed to load Pokemon data: ${res.status}`);
      return res.json() as Promise<PokemonEntry[]>;
    });
  }
  return cache;
}
