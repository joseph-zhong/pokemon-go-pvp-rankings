import "../shared/base.css";
import "./ranks.css";
import { findCombo, LEAGUES, rankAllIvs, type League, type RankedCombo } from "../calc/rank";
import { loadMoves, loadMovesets, type MoveInfo, type MovesetsBySpecies } from "../data/moves";
import { loadPokemon, type PokemonEntry } from "../data/pokemon";
import { createCombobox } from "../ui/combobox";
import { createIvStepper, type IvStepperHandle } from "../ui/ivStepper";

const els = {
  form: document.getElementById("form") as HTMLFormElement,
  pokemonInput: document.getElementById("pokemon-input") as HTMLInputElement,
  pokemonList: document.getElementById("pokemon-listbox") as HTMLUListElement,
  bestBuddy: document.getElementById("best-buddy") as HTMLInputElement,
  evolutionResults: document.getElementById("evolution-results") as HTMLElement,
  emptyState: document.getElementById("empty-state") as HTMLElement,
  movesCard: document.getElementById("moves-card") as HTMLElement,
  movesLeagueNote: document.getElementById("moves-league-note") as HTMLElement,
  movesFast: document.getElementById("moves-fast") as HTMLElement,
  movesCharged: document.getElementById("moves-charged") as HTMLElement,
};

interface StageCardHandle {
  root: HTMLElement;
  rankEls: Map<string, HTMLElement>;
}

/** Builds one evolution stage's result card (header, league ranks) and appends it to #evolution-results. */
function createStageCard(entry: PokemonEntry, isCurrent: boolean): StageCardHandle {
  const root = document.createElement("section");
  root.className = isCurrent ? "card evo-stage-card evo-stage-current" : "card evo-stage-card";
  root.dataset.type = entry.type;

  const header = document.createElement(isCurrent ? "div" : "button");
  header.className = "evo-stage-header";
  if (!isCurrent) {
    (header as HTMLButtonElement).type = "button";
    header.addEventListener("click", () => chooseSpecies(entry));
  }
  const name = document.createElement("span");
  name.className = "evo-stage-name";
  name.textContent = entry.name;
  header.appendChild(name);
  const dex = document.createElement("span");
  dex.className = "evo-stage-dex";
  dex.textContent = `#${entry.dex}`;
  header.appendChild(dex);
  root.appendChild(header);

  const rankList = document.createElement("dl");
  rankList.className = "league-rank-list";
  const rankEls = new Map<string, HTMLElement>();
  for (const league of LEAGUES) {
    const row = document.createElement("div");
    row.className = "league-rank-row";
    const dt = document.createElement("dt");
    dt.textContent = league.label;
    const dd = document.createElement("dd");
    dd.className = "league-rank-value";
    dd.textContent = "—";
    row.append(dt, dd);
    rankList.appendChild(row);
    rankEls.set(league.id, dd);
  }
  root.appendChild(rankList);

  els.evolutionResults.appendChild(root);

  return { root, rankEls };
}

let pokemonList: PokemonEntry[] = [];
let pokemonById = new Map<string, PokemonEntry>();
let moves: Record<string, MoveInfo> = {};
let movesets: MovesetsBySpecies = {};
let selected: PokemonEntry | null = null;
// The entered species plus everything it can still evolve into, in display order.
let chain: PokemonEntry[] = [];
// One result card per entry in `chain`, same order.
let stageCards: StageCardHandle[] = [];
// The full 4096-combo ranking per league, per stage entry, for the current
// species/level cap. Only rebuilt on "structural" changes (species, best
// buddy) — never on an IV edit, which just looks a combo up in it.
let rankingsByStage: Record<string, Record<string, RankedCombo[]>> = {};
const steppers: Record<"atk" | "def" | "hp", IvStepperHandle> = {} as never;

function currentIvs() {
  return { atk: steppers.atk.get(), def: steppers.def.get(), hp: steppers.hp.get() };
}

function render() {
  if (!selected) return;

  els.evolutionResults.hidden = false;
  els.emptyState.hidden = true;

  const ivs = currentIvs();
  let bestEntry: PokemonEntry | null = null;
  let bestLeague: League | null = null;
  let bestRank = Infinity;

  chain.forEach((entry, i) => {
    const card = stageCards[i]!;
    const rankingsByLeague = rankingsByStage[entry.id]!;

    for (const league of LEAGUES) {
      const target = findCombo(rankingsByLeague[league.id]!, ivs);
      card.rankEls.get(league.id)!.textContent = `#${target.rank.toLocaleString()} / 4096`;

      if (target.rank < bestRank) {
        bestRank = target.rank;
        bestEntry = entry;
        bestLeague = league;
      }
    }
  });

  // The single best (stage, league) rank across the whole evolution line —
  // shown once, not once per stage.
  if (bestEntry && bestLeague) renderMoves(bestEntry, bestLeague);

  updateUrl();
}

function updateUrl() {
  if (!selected) return;
  const ivs = currentIvs();
  const params = new URLSearchParams({
    p: selected.id,
    iv: `${ivs.atk}-${ivs.def}-${ivs.hp}`,
  });
  if (els.bestBuddy.checked) params.set("bb", "1");
  history.replaceState(null, "", `?${params.toString()}`);
}

function moveLabel(moveId: string): string {
  const info = moves[moveId];
  if (!info) return moveId;
  return `${info.name} (${info.type.charAt(0).toUpperCase()}${info.type.slice(1)})`;
}

// Moves depend only on species + league (not IVs or Best Buddy — moveset
// choice doesn't change with level), computed straight from PvPoke's own
// battle-sim output rather than something we simulate. See design-doc.md
// section 13. Shown once, at the top, for whichever (stage, league) pair
// ranks best across the whole evolution line. Species PvPoke never
// simulated just hide the block.
function renderMoves(entry: PokemonEntry, league: League) {
  const moveset = movesets[entry.id]?.[league.id as "great" | "ultra" | "master"];
  if (!moveset) {
    els.movesCard.hidden = true;
    return;
  }
  els.movesCard.hidden = false;
  els.movesLeagueNote.textContent = `(${entry.name} · ${league.label})`;
  els.movesFast.textContent = moveLabel(moveset.fast);
  els.movesCharged.textContent = moveset.charged.map(moveLabel).join(", ");
}

/**
 * Breadth-first walk forward through `evolutions` only (never `parent`) —
 * the entered species plus everything it can still evolve into. Branching
 * lines (e.g. Eevee) fan out into multiple entries at the same depth rather
 * than picking one path.
 */
function forwardEvolutionChain(entry: PokemonEntry): PokemonEntry[] {
  const seen = new Set([entry.id]);
  const result = [entry];
  let frontier = [entry];
  while (frontier.length > 0) {
    const next: PokemonEntry[] = [];
    for (const node of frontier) {
      for (const id of node.evolutions ?? []) {
        if (seen.has(id)) continue;
        const child = pokemonById.get(id);
        if (!child) continue;
        seen.add(id);
        result.push(child);
        next.push(child);
      }
    }
    frontier = next;
  }
  return result;
}

/** Recompute the ranking table for every league, for every stage in the evolution line — call only when species/best-buddy change. */
function onStructuralChange() {
  if (!selected) {
    els.movesCard.hidden = true;
    els.evolutionResults.hidden = true;
    els.emptyState.hidden = false;
    return;
  }

  chain = forwardEvolutionChain(selected);
  els.evolutionResults.innerHTML = "";
  stageCards = chain.map((entry) => createStageCard(entry, entry.id === selected!.id));

  const levelCap = els.bestBuddy.checked ? 51 : 50;
  rankingsByStage = Object.fromEntries(
    chain.map((entry) => [entry.id, Object.fromEntries(LEAGUES.map((league) => [league.id, rankAllIvs(entry, league, levelCap)]))]),
  );

  render();
}

/** Re-render against the existing ranking tables — call on IV edits. */
function onQueryChange() {
  if (!selected) return;
  render();
}

function selectPokemon(entry: PokemonEntry) {
  selected = entry;
  onStructuralChange();
}

/** Sets the search box and selects a species — used by the combobox, URL restore, and stage card headers alike. */
function chooseSpecies(entry: PokemonEntry) {
  els.pokemonInput.value = entry.name;
  selectPokemon(entry);
}

// IV steppers
(["atk", "def", "hp"] as const).forEach((stat) => {
  const container = document.querySelector<HTMLElement>(`.iv-stepper[data-iv="${stat}"]`)!;
  steppers[stat] = createIvStepper(container, onQueryChange);
});

// Paste support: "12/14/15"-style strings (from screenshots / IV scanners)
// pasted into any IV field fill all three at once.
const IV_PASTE_PATTERN = /^\s*(\d{1,2})\s*[/\-, ]\s*(\d{1,2})\s*[/\-, ]\s*(\d{1,2})\s*$/;
for (const stat of ["atk", "def", "hp"] as const) {
  steppers[stat].input.addEventListener("paste", (e) => {
    const text = e.clipboardData?.getData("text") ?? "";
    const match = text.match(IV_PASTE_PATTERN);
    if (!match) return;
    e.preventDefault();
    const [, atk, def, hp] = match;
    steppers.atk.set(Number(atk));
    steppers.def.set(Number(def));
    steppers.hp.set(Number(hp));
    onQueryChange();
  });
}

// Best Buddy changes the level cap, so it needs a full re-rank, not just a lookup.
els.bestBuddy.addEventListener("change", onStructuralChange);
els.form.addEventListener("submit", (e) => e.preventDefault());

// Pokemon combobox
createCombobox({
  input: els.pokemonInput,
  list: els.pokemonList,
  getOptions: () => pokemonList.map((p) => ({ id: p.id, label: p.name, sublabel: `#${p.dex}` })),
  onSelect: (option) => {
    const entry = pokemonById.get(option.id);
    if (entry) chooseSpecies(entry);
  },
});

// Restore state from the URL (shareable/bookmarkable links), then load data.
const params = new URLSearchParams(location.search);
if (params.get("bb") === "1") els.bestBuddy.checked = true;
const ivParam = params.get("iv");
if (ivParam) {
  const [atk, def, hp] = ivParam.split("-").map(Number);
  if (atk !== undefined) steppers.atk.set(atk);
  if (def !== undefined) steppers.def.set(def);
  if (hp !== undefined) steppers.hp.set(hp);
}

Promise.all([loadPokemon(), loadMoves(), loadMovesets()]).then(([pokemonData, movesData, movesetsData]) => {
  pokemonList = pokemonData;
  pokemonById = new Map(pokemonData.map((p) => [p.id, p]));
  moves = movesData;
  movesets = movesetsData;
  const pokemonParam = params.get("p");
  if (pokemonParam) {
    const entry = pokemonById.get(pokemonParam);
    if (entry) chooseSpecies(entry);
  }
});
