// Pulls the upstream game data we depend on and slims it down to just what
// the rank checker needs: species id/name/dex and base stats.
//
// Source: pvpoke/pvpoke (MIT licensed) — the de facto community source of
// truth for Pokemon GO PvP data. See design-doc.md section 3 for why.
import { writeFile } from "node:fs/promises";

const GAMEMASTER_URL =
  "https://raw.githubusercontent.com/pvpoke/pvpoke/master/src/data/gamemaster.json";
const OUT_PATH = new URL("../public/data/pokemon.min.json", import.meta.url);

const res = await fetch(GAMEMASTER_URL);
if (!res.ok) {
  throw new Error(`Failed to fetch gamemaster.json: ${res.status} ${res.statusText}`);
}
const gamemaster = await res.json();

const pokemon = gamemaster.pokemon
  .filter((p) => p.released && p.baseStats)
  .map((p) => ({
    id: p.speciesId,
    name: p.speciesName,
    dex: p.dex,
    atk: p.baseStats.atk,
    def: p.baseStats.def,
    hp: p.baseStats.hp,
    // Direct previous/next evolution stage(s), straight from PvPoke's family
    // graph — lets the UI offer "Evolves from/into" links. See
    // design-doc.md section 12 for why this needs no extra data source.
    ...(p.family?.parent ? { parent: p.family.parent } : {}),
    ...(p.family?.evolutions?.length ? { evolutions: p.family.evolutions } : {}),
  }))
  .sort((a, b) => a.dex - b.dex || a.id.localeCompare(b.id));

await writeFile(OUT_PATH, JSON.stringify(pokemon), "utf8");
console.log(`Wrote ${pokemon.length} Pokemon to ${OUT_PATH.pathname}`);
