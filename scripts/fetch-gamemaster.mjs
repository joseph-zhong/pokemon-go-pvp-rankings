// Pulls the upstream game data we depend on and slims it down to just what
// the app needs: species base stats/evolutions, a move name/type dictionary,
// and per-league recommended movesets.
//
// Source: pvpoke/pvpoke (MIT licensed) — the de facto community source of
// truth for Pokemon GO PvP data, and (for movesets) the output of their
// battle simulator rather than something we compute ourselves. See
// design-doc.md sections 3 and 13 for why.
import { mkdir, writeFile } from "node:fs/promises";

const RAW_BASE = "https://raw.githubusercontent.com/pvpoke/pvpoke/master/src/data";
const GAMEMASTER_URL = `${RAW_BASE}/gamemaster.json`;
const LEAGUES = [
  { key: "great", title: "Great League", cp: 1500 },
  { key: "ultra", title: "Ultra League", cp: 2500 },
  { key: "master", title: "Master League", cp: 10000 },
];

async function fetchJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to fetch ${url}: ${res.status} ${res.statusText}`);
  return res.json();
}

const [gamemaster, ...rankingsByLeague] = await Promise.all([
  fetchJson(GAMEMASTER_URL),
  ...LEAGUES.map((league) => fetchJson(`${RAW_BASE}/rankings/all/overall/rankings-${league.cp}.json`)),
]);

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

const moves = Object.fromEntries(gamemaster.moves.map((m) => [m.moveId, { name: m.name, type: m.type }]));

// speciesId -> { great?, ultra?, master?: { fast, charged, altFast?, altCharged? } }
// `moveset` is PvPoke's top pick (1 fast + 1-2 charged); the next-ranked
// entries in moves.fastMoves/chargedMoves (sorted by simulated usage) become
// the "alternative" suggestions. Species PvPoke never simulated just don't
// get an entry — the UI hides the section rather than guessing.
// moves.fastMoves/chargedMoves are NOT pre-sorted by usage in the source
// data (only `moveset`, PvPoke's own top pick, is authoritative as-is) —
// sort by `uses` ourselves before picking an alternate from what's left.
function topByUsage(candidates, exclude) {
  return [...candidates]
    .sort((a, b) => b.uses - a.uses)
    .find((m) => !exclude.includes(m.moveId))?.moveId;
}

const movesets = {};
LEAGUES.forEach((league, i) => {
  for (const entry of rankingsByLeague[i]) {
    if (!entry.moveset || entry.moveset.length === 0) continue;
    const [fast, ...charged] = entry.moveset;
    const leagueEntry = { fast, charged };
    const altFast = topByUsage(entry.moves?.fastMoves ?? [], [fast]);
    const altCharged = topByUsage(entry.moves?.chargedMoves ?? [], charged);
    if (altFast) leagueEntry.altFast = altFast;
    if (altCharged) leagueEntry.altCharged = altCharged;
    (movesets[entry.speciesId] ??= {})[league.key] = leagueEntry;
  }
});

// Team builder (/pvp/) data: the 3 standard leagues plus whatever cups are
// currently rotating, discovered from gamemaster.json rather than named in
// code — see plans/pvp/design-doc.md section 1. "custom" isn't a real
// fetchable cup (no static rankings file), so it's excluded.
const discoveredCups = [];
const seenKeys = new Set(LEAGUES.map((l) => l.key));
for (const format of gamemaster.formats) {
  if (!format.showFormat || format.hideRankings || !format.cup) continue;
  if (format.cup === "custom" || format.cup === "all" || seenKeys.has(format.cup)) continue;
  seenKeys.add(format.cup);
  discoveredCups.push({ key: format.cup, title: format.title, cup: format.cup, cp: format.cp });
}

const teamLeagues = [...LEAGUES.map((l) => ({ ...l, cup: "all" })), ...discoveredCups];

// Reuse the "all"-cup rankings already fetched above for the 3 standard
// leagues instead of re-fetching identical data; only discovered cups need
// a fresh request. A cup occasionally missing its rankings file shouldn't
// take down the whole script.
const cupRankings = await Promise.all(
  discoveredCups.map(async (c) => {
    try {
      return await fetchJson(`${RAW_BASE}/rankings/${c.cup}/overall/rankings-${c.cp}.json`);
    } catch (err) {
      console.warn(`Skipping cup ${c.key}: ${err.message}`);
      return null;
    }
  }),
);

const outDir = new URL("../public/data/", import.meta.url);
await mkdir(new URL("teams/", outDir), { recursive: true });

const leaguesCatalog = [];
for (let i = 0; i < teamLeagues.length; i++) {
  const league = teamLeagues[i];
  const rankings = i < LEAGUES.length ? rankingsByLeague[i] : cupRankings[i - LEAGUES.length];
  if (!rankings) continue;

  const team = {};
  for (const entry of rankings) {
    team[entry.speciesId] = {
      score: entry.score,
      counters: (entry.counters ?? []).map((c) => c.opponent),
    };
  }
  await writeFile(new URL(`teams/${league.key}.min.json`, outDir), JSON.stringify(team), "utf8");
  leaguesCatalog.push({ key: league.key, title: league.title, cp: league.cp });
}

await writeFile(new URL("pokemon.min.json", outDir), JSON.stringify(pokemon), "utf8");
await writeFile(new URL("moves.min.json", outDir), JSON.stringify(moves), "utf8");
await writeFile(new URL("movesets.min.json", outDir), JSON.stringify(movesets), "utf8");
await writeFile(new URL("leagues.min.json", outDir), JSON.stringify(leaguesCatalog), "utf8");

console.log(
  `Wrote ${pokemon.length} Pokemon, ${Object.keys(moves).length} moves, ${Object.keys(movesets).length} movesets, ${leaguesCatalog.length} team leagues`,
);
