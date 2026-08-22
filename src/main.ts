import "./style.css";
import { leagueById, rankIvs, type RankResult } from "./calc/rank";
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
};

let pokemonList: PokemonEntry[] = [];
let selected: PokemonEntry | null = null;
const steppers: Record<"atk" | "def" | "hp", IvStepperHandle> = {} as never;

function currentIvs() {
  return { atk: steppers.atk.get(), def: steppers.def.get(), hp: steppers.hp.get() };
}

// Percentage tiers are a simple, commonly used heuristic for "how good is
// this stat product relative to the best possible" — not a game mechanic.
function tierFor(percentage: number): { label: string; tier: "great" | "good" | "ok" } {
  if (percentage >= 98) return { label: "Great", tier: "great" };
  if (percentage >= 90) return { label: "Good", tier: "good" };
  return { label: "Fair", tier: "ok" };
}

function renderResult(result: RankResult) {
  els.result.hidden = false;
  els.emptyState.hidden = true;

  els.rankNum.textContent = `#${result.rank.toLocaleString()}`;
  els.level.textContent = String(result.level);
  els.cp.textContent = result.cp.toLocaleString();
  els.sp.textContent = Math.round(result.statProduct).toLocaleString();
  els.pct.textContent = `${result.percentage.toFixed(1)}%`;
  els.barFill.style.width = `${result.percentage}%`;

  const { label, tier } = tierFor(result.percentage);
  els.tier.textContent = label;
  els.tier.dataset.tier = tier;
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

function recompute() {
  if (!selected) {
    els.result.hidden = true;
    els.emptyState.hidden = false;
    return;
  }
  const league = leagueById(els.leagueSelect.value);
  const levelCap = els.bestBuddy.checked ? 51 : 50;
  const result = rankIvs(selected, currentIvs(), league, levelCap);
  renderResult(result);
  updateUrl();
}

function selectPokemon(entry: PokemonEntry) {
  selected = entry;
  recompute();
}

// IV steppers
(["atk", "def", "hp"] as const).forEach((stat) => {
  const container = document.querySelector<HTMLElement>(`.iv-stepper[data-iv="${stat}"]`)!;
  steppers[stat] = createIvStepper(container, recompute);
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
    recompute();
  });
}

// League + Best Buddy
els.leagueSelect.addEventListener("change", recompute);
els.bestBuddy.addEventListener("change", recompute);
els.form.addEventListener("submit", (e) => e.preventDefault());

// Pokemon combobox
createCombobox({
  input: els.pokemonInput,
  list: els.pokemonList,
  getOptions: () => pokemonList.map((p) => ({ id: p.id, label: p.name, sublabel: `#${p.dex}` })),
  onSelect: (option) => {
    const entry = pokemonList.find((p) => p.id === option.id);
    if (entry) selectPokemon(entry);
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
  const pokemonParam = params.get("p");
  if (pokemonParam) {
    const entry = pokemonList.find((p) => p.id === pokemonParam);
    if (entry) {
      els.pokemonInput.value = entry.name;
      selectPokemon(entry);
    }
  }
});
