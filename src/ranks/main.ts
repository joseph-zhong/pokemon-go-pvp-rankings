import "../shared/base.css";
import "./ranks.css";
import { findCombo, firstRankBelow, leagueById, rankAllIvs, type League, type RankedCombo } from "../calc/rank";
import { loadMoves, loadMovesets, type MoveInfo, type MovesetsBySpecies } from "../data/moves";
import { loadPokemon, type PokemonEntry } from "../data/pokemon";
import { createCombobox } from "../ui/combobox";
import { createIvStepper, type IvStepperHandle } from "../ui/ivStepper";

const els = {
  form: document.getElementById("form") as HTMLFormElement,
  pokemonInput: document.getElementById("pokemon-input") as HTMLInputElement,
  pokemonList: document.getElementById("pokemon-listbox") as HTMLUListElement,
  leagueChecks: document.querySelectorAll<HTMLInputElement>(".league-check"),
  bestBuddy: document.getElementById("best-buddy") as HTMLInputElement,
  results: document.getElementById("results") as HTMLElement,
  leagueBlockTemplate: document.getElementById("league-block-template") as HTMLTemplateElement,
  emptyState: document.getElementById("empty-state") as HTMLElement,
};

let pokemonList: PokemonEntry[] = [];
let pokemonById = new Map<string, PokemonEntry>();
let moves: Record<string, MoveInfo> = {};
let movesets: MovesetsBySpecies = {};
let selected: PokemonEntry | null = null;
// All members of the currently selected species' evolution line (root to
// every descendant), in root-first order. A single-stage species is just
// [selected]. See design-doc.md section 12 — most searches for one stage
// of a line are really about how the whole line ranks.
let family: PokemonEntry[] = [];
const steppers: Record<"atk" | "def" | "hp", IvStepperHandle> = {} as never;

// The full 4096-combo ranking for every (active league, family member) pair
// at the current species/league-set/level cap. Only rebuilt on "structural"
// changes (species, active leagues, best buddy) — never on an IV edit, row
// click, or slider drag, which just look a combo up in it.
let rankingsByLeague = new Map<string, Map<string, RankedCombo[]>>();

interface LeagueBlockRefs {
  leagueId: string;
  root: HTMLElement;
  familyStrip: HTMLElement;
  rankNum: HTMLElement;
  tier: HTMLElement;
  rankBar: HTMLElement;
  rankSlider: HTMLInputElement;
  level: HTMLElement;
  cp: HTMLElement;
  sp: HTMLElement;
  pct: HTMLElement;
  movesBlock: HTMLElement;
  movesFast: HTMLElement;
  movesCharged: HTMLElement;
  rankingsBody: HTMLElement;
}

let leagueBlocks: LeagueBlockRefs[] = [];

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

// The rank axis is logarithmic, not linear: rank is linear 1-4096, but the
// interesting differences are almost entirely in the top few hundred (see
// design-doc.md section 2 — most of the 4096 combos cluster within a few
// percent of each other). A linear slider gives the top 10 under a pixel
// of drag range; log space spends most of the bar's resolution near #1 and
// compresses the long, mostly-uninteresting tail near #4096.
const SLIDER_RESOLUTION = 1000;

/** Slider position 0 (worst) to 1 (best), log-scaled — the fraction both the thumb and the gauge colors are placed at. */
function sliderPositionForRank(rank: number, total: number): number {
  if (total <= 1) return 1;
  const clamped = Math.min(Math.max(rank, 1), total);
  return 1 - Math.log(clamped) / Math.log(total);
}

/** Inverse of sliderPositionForRank — what rank a dragged slider position corresponds to. */
function rankForSliderPosition(position: number, total: number): number {
  const rank = Math.round(total ** (1 - position));
  return Math.min(total, Math.max(1, rank));
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
  const goodStop = clampPercent(sliderPositionForRank(Math.min(firstRankBelow(all, 90), total), total) * 100);
  const greatStop = clampPercent(sliderPositionForRank(Math.min(firstRankBelow(all, 98), total), total) * 100);
  const topStop = clampPercent(sliderPositionForRank(Math.min(TOP_TIER_RANK + 1, total), total) * 100);

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

function moveLabel(moveId: string): string {
  const info = moves[moveId];
  if (!info) return moveId;
  return `${info.name} (${info.type.charAt(0).toUpperCase()}${info.type.slice(1)})`;
}

function renderMoveField(el: HTMLElement, primaryLabel: string, altMoveId: string | undefined) {
  el.textContent = primaryLabel;
  if (altMoveId) {
    const alt = document.createElement("span");
    alt.className = "alt";
    alt.textContent = ` · alt: ${moveLabel(altMoveId)}`;
    el.appendChild(alt);
  }
}

// Moves depend only on species + league (not IVs or Best Buddy — moveset
// choice doesn't change with level), computed straight from PvPoke's own
// battle-sim output rather than something we simulate. See design-doc.md
// section 13. Species PvPoke never simulated just hide the block.
function renderMoves(block: LeagueBlockRefs, entry: PokemonEntry) {
  const moveset = movesets[entry.id]?.[block.leagueId as "great" | "ultra" | "master"];
  if (!moveset) {
    block.movesBlock.hidden = true;
    return;
  }
  block.movesBlock.hidden = false;
  renderMoveField(block.movesFast, moveLabel(moveset.fast), moveset.altFast);
  renderMoveField(block.movesCharged, moveset.charged.map(moveLabel).join(", "), moveset.altCharged);
}

/** Walks to the root of the evolution line, then collects every descendant (root-first). Handles branching lines (e.g. Eevee) as a flat, deduped list. */
function familyOf(entry: PokemonEntry): PokemonEntry[] {
  let root = entry;
  while (root.parent) {
    const parent = pokemonById.get(root.parent);
    if (!parent) break;
    root = parent;
  }

  const seen = new Set<string>();
  const result: PokemonEntry[] = [];
  const queue: PokemonEntry[] = [root];
  while (queue.length > 0) {
    const cur = queue.shift()!;
    if (seen.has(cur.id)) continue;
    seen.add(cur.id);
    result.push(cur);
    for (const evoId of cur.evolutions ?? []) {
      const evo = pokemonById.get(evoId);
      if (evo) queue.push(evo);
    }
  }
  return result;
}

/** One clickable chip per evolution-line member, showing that member's current rank in this league. Clicking switches the selected species without recomputing anything (already cached). */
function renderFamilyStrip(block: LeagueBlockRefs) {
  if (family.length <= 1) {
    block.familyStrip.hidden = true;
    return;
  }
  block.familyStrip.hidden = false;
  block.familyStrip.innerHTML = "";

  const combosBySpecies = rankingsByLeague.get(block.leagueId)!;
  for (const member of family) {
    const combos = combosBySpecies.get(member.id);
    if (!combos) continue;
    const combo = findCombo(combos, currentIvs());

    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "evo-chip";
    if (selected && member.id === selected.id) btn.classList.add("evo-chip-current");
    btn.textContent = `${member.name} #${combo.rank}`;
    btn.addEventListener("click", () => selectFamilyMember(member));
    block.familyStrip.appendChild(btn);
  }
}

function renderLeagueBlock(block: LeagueBlockRefs) {
  const combos = rankingsByLeague.get(block.leagueId)!.get(selected!.id)!;
  const target = findCombo(combos, currentIvs());
  const total = combos.length;

  // Gauge background and recommended moves depend only on species + league
  // (not IVs), but "species" can change without a structural rebuild when
  // the user clicks a different stage in the family strip — so they're
  // refreshed here rather than only once at structural-change time.
  block.rankBar.style.background = buildGaugeBackground(combos);
  renderMoves(block, selected!);

  block.rankNum.textContent = `#${target.rank.toLocaleString()}`;
  block.level.textContent = String(target.level);
  block.cp.textContent = target.cp.toLocaleString();
  block.sp.textContent = Math.round(target.statProduct).toLocaleString();
  block.pct.textContent = `${target.percentage.toFixed(1)}%`;

  const { label, tier } = tierFor(target);
  block.tier.textContent = label;
  block.tier.dataset.tier = tier;
  block.rankSlider.style.setProperty("--thumb-color", TIER_COLOR_VAR[tier]);

  block.rankSlider.value = String(Math.round(sliderPositionForRank(target.rank, total) * SLIDER_RESOLUTION));

  renderFamilyStrip(block);
  renderRankRows(block.rankingsBody, buildRankRows(combos, target.rank), target.rank);
}

function render() {
  if (!selected || leagueBlocks.length === 0) return;

  els.results.hidden = false;
  els.emptyState.hidden = true;

  for (const block of leagueBlocks) renderLeagueBlock(block);

  updateUrl();
}

function activeLeagueIds(): string[] {
  return Array.from(els.leagueChecks)
    .filter((cb) => cb.checked)
    .map((cb) => cb.value);
}

/** Never let the user uncheck every league — falls back to re-checking the box that was just unchecked. */
function ensureAtLeastOneLeagueChecked(fallback: HTMLInputElement) {
  if (activeLeagueIds().length === 0) fallback.checked = true;
}

function updateUrl() {
  if (!selected) return;
  const ivs = currentIvs();
  const params = new URLSearchParams({
    p: selected.id,
    l: activeLeagueIds().join(","),
    iv: `${ivs.atk}-${ivs.def}-${ivs.hp}`,
  });
  if (els.bestBuddy.checked) params.set("bb", "1");
  history.replaceState(null, "", `?${params.toString()}`);
}

function buildLeagueBlock(league: League): LeagueBlockRefs {
  const fragment = els.leagueBlockTemplate.content.cloneNode(true) as DocumentFragment;
  const root = fragment.querySelector(".league-block") as HTMLElement;
  root.querySelector(".league-block-title")!.textContent = league.label;

  const block: LeagueBlockRefs = {
    leagueId: league.id,
    root,
    familyStrip: root.querySelector(".family-strip") as HTMLElement,
    rankNum: root.querySelector(".result-rank-num") as HTMLElement,
    tier: root.querySelector(".tier-badge") as HTMLElement,
    rankBar: root.querySelector(".rank-bar") as HTMLElement,
    rankSlider: root.querySelector(".rank-bar-slider") as HTMLInputElement,
    level: root.querySelector(".result-level") as HTMLElement,
    cp: root.querySelector(".result-cp") as HTMLElement,
    sp: root.querySelector(".result-sp") as HTMLElement,
    pct: root.querySelector(".result-pct") as HTMLElement,
    movesBlock: root.querySelector(".moves-block") as HTMLElement,
    movesFast: root.querySelector(".moves-fast") as HTMLElement,
    movesCharged: root.querySelector(".moves-charged") as HTMLElement,
    rankingsBody: root.querySelector(".rankings-body") as HTMLElement,
  };

  // Rank explorer slider: dragging it is just another way to pick a combo,
  // same as typing IVs or clicking a table row — it sets the real query state.
  block.rankSlider.addEventListener("input", () => {
    const position = Number(block.rankSlider.value) / SLIDER_RESOLUTION;
    const combos = rankingsByLeague.get(block.leagueId)!.get(selected!.id)!;
    const rank = rankForSliderPosition(position, combos.length);
    const combo = combos[rank - 1];
    if (combo) applyCombo(combo);
  });

  els.results.appendChild(root);
  return block;
}

function selectFamilyMember(entry: PokemonEntry) {
  selected = entry;
  els.pokemonInput.value = entry.name;
  render();
}

/** Recompute every active league's full ranking table for the whole evolution line — call only when species/leagues/level-cap change. */
function onStructuralChange() {
  if (!selected) {
    els.results.hidden = true;
    els.emptyState.hidden = false;
    return;
  }

  family = familyOf(selected);
  const levelCap = els.bestBuddy.checked ? 51 : 50;
  const leagueIds = activeLeagueIds();

  rankingsByLeague = new Map();
  for (const leagueId of leagueIds) {
    const league = leagueById(leagueId);
    const perSpecies = new Map<string, RankedCombo[]>();
    for (const member of family) perSpecies.set(member.id, rankAllIvs(member, league, levelCap));
    rankingsByLeague.set(leagueId, perSpecies);
  }

  els.results.innerHTML = "";
  leagueBlocks = leagueIds.map((id) => buildLeagueBlock(leagueById(id)));

  render();
}

/** Re-render against the existing ranking tables — call on IV edits, row clicks, slider drags. */
function onQueryChange() {
  if (!selected) return;
  render();
}

function selectPokemon(entry: PokemonEntry) {
  selected = entry;
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

// Leagues + Best Buddy change the CP cap / level cap, so they need a full
// re-rank, not just a lookup.
els.leagueChecks.forEach((cb) => {
  cb.addEventListener("change", () => {
    ensureAtLeastOneLeagueChecked(cb);
    onStructuralChange();
  });
});
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
const leagueParam = params.get("l");
if (leagueParam) {
  const ids = new Set(leagueParam.split(",").filter(Boolean));
  els.leagueChecks.forEach((cb) => {
    cb.checked = ids.has(cb.value);
  });
  ensureAtLeastOneLeagueChecked(els.leagueChecks[0]!);
}
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
