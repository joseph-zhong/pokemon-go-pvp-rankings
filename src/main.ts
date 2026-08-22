import "./style.css";
import { findCombo, firstRankBelow, leagueById, rankAllIvs, type RankedCombo } from "./calc/rank";
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
  rankBar: document.getElementById("rank-bar") as HTMLElement,
  level: document.getElementById("result-level") as HTMLElement,
  cp: document.getElementById("result-cp") as HTMLElement,
  sp: document.getElementById("result-sp") as HTMLElement,
  pct: document.getElementById("result-pct") as HTMLElement,
  rankSlider: document.getElementById("rank-slider") as HTMLInputElement,
  rankingsBody: document.getElementById("rankings-body") as HTMLElement,
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

// Percentage/rank tiers are a simple, commonly used heuristic for "how good
// is this stat product relative to the best possible" — not a game mechanic.
type Tier = "fair" | "good" | "great" | "top";

const TOP_TIER_RANK = 10;

function tierFor(combo: RankedCombo): { label: string; tier: Tier } {
  if (combo.rank <= TOP_TIER_RANK) return { label: "Top 10", tier: "top" };
  if (combo.percentage >= 98) return { label: "Great", tier: "great" };
  if (combo.percentage >= 90) return { label: "Good", tier: "good" };
  return { label: "Fair", tier: "fair" };
}

const TIER_COLOR_VAR: Record<Tier, string> = {
  fair: "var(--tier-fair)",
  good: "var(--tier-good)",
  great: "var(--tier-great)",
  top: "var(--tier-top)",
};

/** Fraction along the rank axis, 0 (worst) to 1 (best) — the same coordinate the native range slider uses. */
function rankFraction(rank: number, total: number): number {
  return total <= 1 ? 1 : (total - rank) / (total - 1);
}

function clampPercent(x: number): number {
  return Math.max(0, Math.min(100, x));
}

/**
 * A static 4-color gauge background for the rank bar. The % thresholds
 * (98/90) land at a different rank for every species — a low-variance
 * species might never drop below 90% even at its worst IV combo — so the
 * color-stop positions are computed from the actual ranking, not fixed.
 */
function buildGaugeBackground(all: RankedCombo[]): string {
  const total = all.length;
  const goodStop = clampPercent(rankFraction(Math.min(firstRankBelow(all, 90), total), total) * 100);
  const greatStop = clampPercent(rankFraction(Math.min(firstRankBelow(all, 98), total), total) * 100);
  const topStop = clampPercent(rankFraction(Math.min(TOP_TIER_RANK + 1, total), total) * 100);

  return (
    `linear-gradient(to right,` +
    `var(--tier-fair) 0%, var(--tier-fair) ${goodStop}%,` +
    `var(--tier-good) ${goodStop}%, var(--tier-good) ${greatStop}%,` +
    `var(--tier-great) ${greatStop}%, var(--tier-great) ${topStop}%,` +
    `var(--tier-top) ${topStop}%, var(--tier-top) 100%)`
  );
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

const TOP_N = 5;
const NEARBY_RADIUS = 5;

/**
 * Merges the Top 5 with an 11-row window centered on the query's rank
 * (+/-5), deduped, in rank order. A "gap" marker is inserted only when
 * there's an actual break between the two blocks — if the query is close
 * enough to #1 that the windows already touch, it reads as one continuous
 * list instead of two overlapping tables. See design-doc.md section 10.
 */
function buildRankRows(all: RankedCombo[], targetRank: number): (RankedCombo | "gap")[] {
  const total = all.length;
  const top = all.slice(0, TOP_N);
  const start = Math.max(0, targetRank - 1 - NEARBY_RADIUS);
  const end = Math.min(total, targetRank + NEARBY_RADIUS);
  const nearby = all.slice(start, end);

  const shown = new Set(top.map((c) => c.rank));
  const rest = nearby.filter((c) => !shown.has(c.rank));
  if (rest.length === 0) return top;

  const lastTopRank = top[top.length - 1]!.rank;
  const rows: (RankedCombo | "gap")[] = [...top];
  if (rest[0]!.rank > lastTopRank + 1) rows.push("gap");
  rows.push(...rest);
  return rows;
}

function renderRankRows(body: HTMLElement, rows: (RankedCombo | "gap")[], currentRank: number) {
  body.innerHTML = "";
  for (const row of rows) {
    if (row === "gap") {
      const tr = document.createElement("tr");
      tr.className = "gap-row";
      const td = document.createElement("td");
      td.colSpan = 5;
      td.textContent = "···";
      tr.appendChild(td);
      body.appendChild(tr);
    } else {
      body.appendChild(renderRow(row, row.rank === currentRank));
    }
  }
}

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

  const { label, tier } = tierFor(target);
  els.tier.textContent = label;
  els.tier.dataset.tier = tier;
  els.rankSlider.style.setProperty("--thumb-color", TIER_COLOR_VAR[tier]);

  els.rankSlider.max = String(total);
  els.rankSlider.value = String(target.rank);

  renderRankRows(els.rankingsBody, buildRankRows(currentRankings, target.rank), target.rank);

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
  els.rankBar.style.background = buildGaugeBackground(currentRankings);
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
