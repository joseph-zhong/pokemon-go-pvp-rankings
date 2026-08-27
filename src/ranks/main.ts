import "../shared/base.css";
import "./ranks.css";
import { MIN_LEVEL } from "../calc/cpm";
import { bestLevelForCap, calcCp, evolutionExceedsCap, findCombo, LEAGUES, rankAllIvs, type Ivs, type League, type RankedCombo } from "../calc/rank";
import { loadMoves, loadMovesets, type MoveInfo, type MovesetsBySpecies } from "../data/moves";
import { loadPokemon, type PokemonEntry } from "../data/pokemon";
import { createCombobox } from "../ui/combobox";
import { createIvStepper, type IvStepperHandle } from "../ui/ivStepper";

const els = {
  form: document.getElementById("form") as HTMLFormElement,
  pokemonInput: document.getElementById("pokemon-input") as HTMLInputElement,
  pokemonList: document.getElementById("pokemon-listbox") as HTMLUListElement,
  evoPrevBtn: document.getElementById("evo-prev-btn") as HTMLButtonElement,
  evoNextBtn: document.getElementById("evo-next-btn") as HTMLButtonElement,
  bestBuddy: document.getElementById("best-buddy") as HTMLInputElement,
  evolutionResults: document.getElementById("evolution-results") as HTMLElement,
  emptyState: document.getElementById("empty-state") as HTMLElement,
  movesCard: document.getElementById("moves-card") as HTMLElement,
  movesLeagueToggle: document.querySelectorAll<HTMLButtonElement>(".league-toggle-btn"),
  movesLeagueNote: document.getElementById("moves-league-note") as HTMLElement,
  movesFast: document.getElementById("moves-fast") as HTMLElement,
  movesCharged: document.getElementById("moves-charged") as HTMLElement,
};

interface StageCardHandle {
  root: HTMLElement;
  rankEls: Map<string, HTMLElement>;
  slider: SliderHandle;
}

interface SliderHandle {
  /** Whose CP the readout below the track reflects — always this stage's own species. */
  entry: PokemonEntry;
  /** Whose base stats position the Great/Ultra marks. If this stage has a next evolution, that's the evolved species — "will evolving cross the cap" is the actionable question for a pre-evolution, and its own crossing point is usually never reached anyway. A final stage marks its own crossing. */
  markTarget: PokemonEntry;
  input: HTMLInputElement;
  readout: HTMLElement;
  greatMark: HTMLElement;
  ultraMark: HTMLElement;
}

/** Builds one evolution stage's result card (header, league ranks, level/CP slider) and appends it to #evolution-results. Every stage gets a slider now, not just the current one — the whole point is seeing the evolve-boundary from a pre-evolution's own card. */
function createStageCard(entry: PokemonEntry, isCurrent: boolean, levelCap: number): StageCardHandle {
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

  const { element: sliderEl, handle: slider } = buildLevelSlider(entry, levelCap);
  root.appendChild(sliderEl);

  els.evolutionResults.appendChild(root);

  return { root, rankEls, slider };
}

/** CP-by-level slider for one stage, with Great/Ultra cap crossings marked on the track — lets you see exactly where evolving (or powering up) would cross a cap, instead of just being told yes/no. */
function buildLevelSlider(entry: PokemonEntry, levelCap: number): { element: HTMLElement; handle: SliderHandle } {
  const evolvedId = entry.evolutions?.[0];
  const markTarget = (evolvedId && pokemonById.get(evolvedId)) || entry;
  const marksAreForEvolution = markTarget !== entry;

  const wrap = document.createElement("div");
  wrap.className = "level-cp-slider";

  const track = document.createElement("div");
  track.className = "level-cp-track";

  const greatMark = document.createElement("div");
  greatMark.className = "level-cp-mark";
  const greatLabel = document.createElement("span");
  greatLabel.className = "level-cp-mark-label";
  greatLabel.textContent = marksAreForEvolution ? "→ Great" : "Great";
  greatMark.appendChild(greatLabel);

  const ultraMark = document.createElement("div");
  ultraMark.className = "level-cp-mark";
  const ultraLabel = document.createElement("span");
  ultraLabel.className = "level-cp-mark-label";
  ultraLabel.textContent = marksAreForEvolution ? "→ Ultra" : "Ultra";
  ultraMark.appendChild(ultraLabel);

  const input = document.createElement("input");
  input.type = "range";
  input.className = "level-cp-range";
  input.min = String(MIN_LEVEL);
  input.max = String(levelCap);
  input.step = "0.5";
  input.value = String(levelCap); // start fully powered up — drag down to find where CP crosses each cap
  input.setAttribute("aria-label", `${entry.name} level`);
  if (marksAreForEvolution) input.title = `Marks show where ${markTarget.name}'s CP crosses each cap, if evolved at this level.`;

  track.append(greatMark, ultraMark, input);
  wrap.appendChild(track);

  const readout = document.createElement("p");
  readout.className = "level-cp-readout";
  wrap.appendChild(readout);

  const handle: SliderHandle = { entry, markTarget, input, readout, greatMark, ultraMark };
  input.addEventListener("input", () => updateSliderReadout(handle));

  return { element: wrap, handle };
}

function updateSliderReadout(slider: SliderHandle) {
  const level = Number(slider.input.value);
  const cp = calcCp(slider.entry, currentIvs(), level);
  slider.readout.innerHTML = "";
  slider.readout.append("Level ", el("strong", String(level)), " · CP ", el("strong", cp.toLocaleString()));
}

function el(tag: string, text: string): HTMLElement {
  const node = document.createElement(tag);
  node.textContent = text;
  return node;
}

/** Repositions a slider's Great/Ultra marks for the current IVs/level cap (against `markTarget`'s base stats — see SliderHandle) and refreshes the live readout. Doesn't touch the slider's dragged position — only where it started (a fresh species/Best Buddy toggle) resets that, in onStructuralChange. */
function updateSlider(slider: SliderHandle, ivs: Ivs, levelCap: number) {
  const { markTarget, greatMark, ultraMark } = slider;

  const positionMark = (markEl: HTMLElement, cap: number) => {
    const crossLevel = bestLevelForCap(markTarget, ivs, cap, levelCap);
    const neverExceeds = calcCp(markTarget, ivs, levelCap) <= cap;
    markEl.hidden = neverExceeds;
    if (!neverExceeds) {
      const percent = ((crossLevel - MIN_LEVEL) / (levelCap - MIN_LEVEL)) * 100;
      markEl.style.left = `${percent}%`;
    }
  };
  positionMark(greatMark, 1500);
  positionMark(ultraMark, 2500);

  updateSliderReadout(slider);
}

let pokemonList: PokemonEntry[] = [];
let pokemonById = new Map<string, PokemonEntry>();
let moves: Record<string, MoveInfo> = {};
let movesets: MovesetsBySpecies = {};
let selected: PokemonEntry | null = null;
// The whole evolution family the entered species belongs to (base form
// through every evolution), in display order — not just what's forward of
// `selected`, so navigating to a later stage never hides earlier ones.
let chain: PokemonEntry[] = [];
// One result card per entry in `chain`, same order.
let stageCards: StageCardHandle[] = [];
// The full 4096-combo ranking per league, per stage entry, for the current
// species/level cap. Only rebuilt on "structural" changes (species, best
// buddy) — never on an IV edit, which just looks a combo up in it.
let rankingsByStage: Record<string, Record<string, RankedCombo[]>> = {};
const steppers: Record<"atk" | "def" | "hp", IvStepperHandle> = {} as never;

// Which league's moves to show — null means "whichever (stage, league) pair
// ranks best across the whole evolution line" (the original behavior).
// Persisted per-browser since it's a personal preference (some players only
// ever care about Master League, say), not something worth putting in the
// shareable URL — the URL already identifies the Pokemon/IVs being shared,
// not which move column the sharer happened to be looking at.
const MOVES_LEAGUE_PREF_KEY = "ranks-moves-league";
let movesLeagueOverride: string | null = localStorage.getItem(MOVES_LEAGUE_PREF_KEY);

function currentIvs() {
  return { atk: steppers.atk.get(), def: steppers.def.get(), hp: steppers.hp.get() };
}

function render() {
  if (!selected) return;

  els.evolutionResults.hidden = false;
  els.emptyState.hidden = true;

  const ivs = currentIvs();
  const levelCap = els.bestBuddy.checked ? 51 : 50;
  let bestEntry: PokemonEntry | null = null;
  let bestLeague: League | null = null;
  let bestRank = Infinity;

  chain.forEach((entry, i) => {
    const card = stageCards[i]!;
    const rankingsByLeague = rankingsByStage[entry.id]!;

    for (const league of LEAGUES) {
      const target = findCombo(rankingsByLeague[league.id]!, ivs);
      const dd = card.rankEls.get(league.id)!;
      dd.textContent = `#${target.rank.toLocaleString()} / 4096`;

      // Dim (don't hide, don't add separate warning text) a league's rank
      // when evolving into this stage — from its immediate parent, at the
      // parent's own optimal level — would exceed that league's cap.
      // Master League has no cap, so it's never dimmed.
      const impossibleAfterEvolve =
        i > 0 && league.cpCap !== null && evolutionExceedsCap(chain[i - 1]!, entry, ivs, league.cpCap);
      dd.classList.toggle("league-rank-value-dim", impossibleAfterEvolve);

      const isMovesCandidate = movesLeagueOverride === null || movesLeagueOverride === league.id;
      if (isMovesCandidate && target.rank < bestRank) {
        bestRank = target.rank;
        bestEntry = entry;
        bestLeague = league;
      }
    }

    updateSlider(card.slider, ivs, levelCap);
  });

  for (const btn of els.movesLeagueToggle) {
    btn.setAttribute("aria-pressed", String((btn.dataset.league || null) === movesLeagueOverride));
  }

  // The single best (stage, league) rank across the whole evolution line
  // (or within the chosen league, if the toggle overrides "best") — shown
  // once, not once per stage.
  if (bestEntry && bestLeague) renderMoves(bestEntry, bestLeague);
  else els.movesCard.hidden = true;

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
// ranks best — across the whole evolution line by default, or within a
// single league if the toggle above overrides that. Species PvPoke never
// simulated just hide the block.
function renderMoves(entry: PokemonEntry, league: League) {
  const moveset = movesets[entry.id]?.[league.id as "great" | "ultra" | "master"];
  if (!moveset) {
    els.movesCard.hidden = true;
    return;
  }
  els.movesCard.hidden = false;
  els.movesLeagueNote.textContent = `Showing: ${entry.name} · ${league.label}`;
  els.movesFast.textContent = moveLabel(moveset.fast);
  els.movesCharged.textContent = moveset.charged.map(moveLabel).join(", ");
}

/**
 * Breadth-first walk forward through `evolutions` only, starting from
 * `root`. Branching lines (e.g. Eevee) fan out into multiple entries at the
 * same depth rather than picking one path.
 */
function forwardEvolutionChain(root: PokemonEntry): PokemonEntry[] {
  const seen = new Set([root.id]);
  const result = [root];
  let frontier = [root];
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

/**
 * The whole evolution family `entry` belongs to — every stage, base form
 * through final evolutions — regardless of which one `entry` itself is.
 * Walks back to the base (via `parent`) first, then forward from there.
 * Without this, navigating to Blissey (by search or by clicking a stage
 * card) would make Chansey vanish from the list entirely, since only
 * forward evolutions were ever shown from whichever stage was "current" —
 * losing the one card the evolve-boundary actually needs to be seen on.
 */
function fullEvolutionChain(entry: PokemonEntry): PokemonEntry[] {
  let root = entry;
  while (root.parent) {
    const parent = pokemonById.get(root.parent);
    if (!parent) break;
    root = parent;
  }
  return forwardEvolutionChain(root);
}

/** Recompute the ranking table for every league, for every stage in the evolution line — call only when species/best-buddy change. */
function onStructuralChange() {
  if (!selected) {
    els.movesCard.hidden = true;
    els.evolutionResults.hidden = true;
    els.emptyState.hidden = false;
    return;
  }

  chain = fullEvolutionChain(selected);
  const levelCap = els.bestBuddy.checked ? 51 : 50;

  els.evolutionResults.innerHTML = "";
  stageCards = chain.map((entry) => createStageCard(entry, entry.id === selected!.id, levelCap));

  rankingsByStage = Object.fromEntries(
    chain.map((entry) => [entry.id, Object.fromEntries(LEAGUES.map((league) => [league.id, rankAllIvs(entry, league, levelCap)]))]),
  );

  els.evoPrevBtn.disabled = !selected.parent;
  els.evoNextBtn.disabled = !(selected.evolutions && selected.evolutions.length > 0);

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

// Step one evolution stage at a time without retyping a search — same idea
// as the IV steppers' +/-. Branching lines (Eevee) step to the first
// listed evolution; picking a specific branch still works via that stage's
// card header. Buttons disable themselves (see onStructuralChange) rather
// than doing nothing, so there's no dead end at either end of a chain.
els.evoPrevBtn.addEventListener("click", () => {
  const parent = selected?.parent ? pokemonById.get(selected.parent) : undefined;
  if (parent) chooseSpecies(parent);
});
els.evoNextBtn.addEventListener("click", () => {
  const nextId = selected?.evolutions?.[0];
  const next = nextId ? pokemonById.get(nextId) : undefined;
  if (next) chooseSpecies(next);
});

// Moves league toggle: "Best" (empty data-league) clears the override back
// to whole-line auto-pick; a specific league scopes the auto-pick to just
// that league. Persisted as a personal preference — see the comment on
// movesLeagueOverride's declaration for why that's localStorage, not the URL.
for (const btn of els.movesLeagueToggle) {
  btn.addEventListener("click", () => {
    movesLeagueOverride = btn.dataset.league || null;
    if (movesLeagueOverride) localStorage.setItem(MOVES_LEAGUE_PREF_KEY, movesLeagueOverride);
    else localStorage.removeItem(MOVES_LEAGUE_PREF_KEY);
    render();
  });
}

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
