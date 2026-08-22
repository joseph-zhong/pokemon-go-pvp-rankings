import "./style.css";
import { findCombo, leagueById, rankAllIvs, type RankedCombo } from "./calc/rank";
import { loadPokemon, type PokemonEntry } from "./data/pokemon";
import { createCombobox } from "./ui/combobox";
import { createIvStepper, type IvStepperHandle } from "./ui/ivStepper";

const els = {
  form: document.getElementById("form") as HTMLFormElement,
  pokemonInput: document.getElementById("pokemon-input") as HTMLInputElement,
  pokemonList: document.getElementById("pokemon-listbox") as HTMLUListElement,
  leagueSelect: document.getElementById("league-select") as HTMLSelectElement,
  bestBuddy: document.getElementById("best-buddy") as HTMLInputElement,
  result: document.getElementById("result") as HTMLElement,
  emptyState: document.getElementById("empty-state") as HTMLElement,
  rankNum: document.getElementById("result-rank-num") as HTMLElement,
  tier: document.getElementById("result-tier") as HTMLElement,
  barFill: document.getElementById("result-bar-fill") as HTMLElement,
  level: document.getElementById("result-level") as HTMLElement,
  cp: document.getElementById("result-cp") as HTMLElement,
  sp: document.getElementById("result-sp") as HTMLElement,
  pct: document.getElementById("result-pct") as HTMLElement,
  rankSlider: document.getElementById("rank-slider") as HTMLInputElement,
  exploreRankLabel: document.getElementById("explore-rank-label") as HTMLElement,
  top5Body: document.getElementById("top5-body") as HTMLElement,
  nearbyBody: document.getElementById("nearby-body") as HTMLElement,
  evolutionLinks: document.getElementById("evolution-links") as HTMLElement,
};

let pokemonList: PokemonEntry[] = [];
let pokemonById = new Map<string, PokemonEntry>();
let selected: PokemonEntry | null = null;
// The full 4096-combo ranking for the current species/league/level cap. Only
// rebuilt on "structural" changes (species, league, best buddy) — never on
// an IV edit, row click, or slider drag, which just look a combo up in it.
let currentRankings: RankedCombo[] = [];
const steppers: Record<"atk" | "def" | "hp", IvStepperHandle> = {} as never;

function currentIvs() {
  return { atk: steppers.atk.get(), def: steppers.def.get(), hp: steppers.hp.get() };
}

function applyCombo(combo: RankedCombo) {
  steppers.atk.set(combo.ivs.atk);
  steppers.def.set(combo.ivs.def);
  steppers.hp.set(combo.ivs.hp);
  onQueryChange();
}

// Percentage tiers are a simple, commonly used heuristic for "how good is
// this stat product relative to the best possible" — not a game mechanic.
function tierFor(percentage: number): { label: string; tier: "great" | "good" | "ok" } {
  if (percentage >= 98) return { label: "Great", tier: "great" };
  if (percentage >= 90) return { label: "Good", tier: "good" };
  return { label: "Fair", tier: "ok" };
}

function ivsLabel(ivs: { atk: number; def: number; hp: number }): string {
  return `${ivs.atk}/${ivs.def}/${ivs.hp}`;
}

function renderRow(combo: RankedCombo, isCurrent: boolean): HTMLTableRowElement {
  const tr = document.createElement("tr");
  if (isCurrent) tr.className = "current-row";
  tr.tabIndex = 0;
  const cells = [`#${combo.rank}`, ivsLabel(combo.ivs), String(combo.level), combo.cp.toLocaleString(), `${combo.percentage.toFixed(1)}%`];
  for (const text of cells) {
    const td = document.createElement("td");
    td.textContent = text;
    tr.appendChild(td);
  }
  tr.addEventListener("click", () => applyCombo(combo));
  tr.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      applyCombo(combo);
    }
  });
  return tr;
}

function renderTable(body: HTMLElement, combos: RankedCombo[], currentRank: number) {
  body.innerHTML = "";
  for (const combo of combos) {
    body.appendChild(renderRow(combo, combo.rank === currentRank));
  }
}

const NEARBY_RADIUS = 5;

function render() {
  if (!selected || currentRankings.length === 0) return;

  const target = findCombo(currentRankings, currentIvs());
  const total = currentRankings.length;

  els.result.hidden = false;
  els.emptyState.hidden = true;

  els.rankNum.textContent = `#${target.rank.toLocaleString()}`;
  els.level.textContent = String(target.level);
  els.cp.textContent = target.cp.toLocaleString();
  els.sp.textContent = Math.round(target.statProduct).toLocaleString();
  els.pct.textContent = `${target.percentage.toFixed(1)}%`;
  els.barFill.style.width = `${target.percentage}%`;

  const { label, tier } = tierFor(target.percentage);
  els.tier.textContent = label;
  els.tier.dataset.tier = tier;

  els.rankSlider.max = String(total);
  els.rankSlider.value = String(target.rank);
  els.exploreRankLabel.textContent = `#${target.rank.toLocaleString()} / ${total.toLocaleString()}`;

  renderTable(els.top5Body, currentRankings.slice(0, 5), target.rank);

  const start = Math.max(0, target.rank - 1 - NEARBY_RADIUS);
  const end = Math.min(total, target.rank + NEARBY_RADIUS);
  renderTable(els.nearbyBody, currentRankings.slice(start, end), target.rank);

  updateUrl();
}

function updateUrl() {
  if (!selected) return;
  const ivs = currentIvs();
  const params = new URLSearchParams({
    p: selected.id,
    l: els.leagueSelect.value,
    iv: `${ivs.atk}-${ivs.def}-${ivs.hp}`,
  });
  if (els.bestBuddy.checked) params.set("bb", "1");
  history.replaceState(null, "", `?${params.toString()}`);
}

/** Recompute the full ranking table — call only when species/league/level-cap change. */
function onStructuralChange() {
  if (!selected) {
    els.result.hidden = true;
    els.emptyState.hidden = false;
    return;
  }
  const league = leagueById(els.leagueSelect.value);
  const levelCap = els.bestBuddy.checked ? 51 : 50;
  currentRankings = rankAllIvs(selected, league, levelCap);
  render();
}

/** Re-render against the existing ranking table — call on IV edits, row clicks, slider drags. */
function onQueryChange() {
  if (!selected) return;
  render();
}

function evoGroup(label: string, entries: PokemonEntry[]): HTMLElement {
  const wrap = document.createElement("span");
  wrap.className = "evo-group";

  const labelEl = document.createElement("span");
  labelEl.className = "evo-label";
  labelEl.textContent = label;
  wrap.appendChild(labelEl);

  for (const entry of entries) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "evo-chip";
    btn.textContent = entry.name;
    btn.addEventListener("click", () => chooseSpecies(entry));
    wrap.appendChild(btn);
  }
  return wrap;
}

// "Evolves from/into" chips — same IVs, different base stats, one click.
// See design-doc.md section 12: most searches for a pre-evolution are
// really about how it ranks once evolved.
function renderEvolutionLinks(entry: PokemonEntry) {
  els.evolutionLinks.innerHTML = "";

  const parent = entry.parent ? pokemonById.get(entry.parent) : undefined;
  if (parent) els.evolutionLinks.appendChild(evoGroup("Evolves from", [parent]));

  const evolutions = (entry.evolutions ?? []).map((id) => pokemonById.get(id)).filter((p): p is PokemonEntry => !!p);
  if (evolutions.length > 0) els.evolutionLinks.appendChild(evoGroup("Evolves into", evolutions));

  els.evolutionLinks.hidden = els.evolutionLinks.children.length === 0;
}

function selectPokemon(entry: PokemonEntry) {
  selected = entry;
  renderEvolutionLinks(entry);
  onStructuralChange();
}

/** Sets the search box and selects a species — used by the combobox, URL restore, and evolution chips alike. */
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

// League + Best Buddy change the CP cap / level cap, so they need a full
// re-rank, not just a lookup.
els.leagueSelect.addEventListener("change", onStructuralChange);
els.bestBuddy.addEventListener("change", onStructuralChange);
els.form.addEventListener("submit", (e) => e.preventDefault());

// Rank explorer slider: dragging it is just another way to pick a combo,
// same as typing IVs or clicking a table row — it sets the real query state.
els.rankSlider.addEventListener("input", () => {
  const combo = currentRankings[Number(els.rankSlider.value) - 1];
  if (combo) applyCombo(combo);
});

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
if (params.has("l")) els.leagueSelect.value = params.get("l")!;
if (params.get("bb") === "1") els.bestBuddy.checked = true;
const ivParam = params.get("iv");
if (ivParam) {
  const [atk, def, hp] = ivParam.split("-").map(Number);
  if (atk !== undefined) steppers.atk.set(atk);
  if (def !== undefined) steppers.def.set(def);
  if (hp !== undefined) steppers.hp.set(hp);
}

loadPokemon().then((data) => {
  pokemonList = data;
  pokemonById = new Map(data.map((p) => [p.id, p]));
  const pokemonParam = params.get("p");
  if (pokemonParam) {
    const entry = pokemonById.get(pokemonParam);
    if (entry) chooseSpecies(entry);
  }
});
