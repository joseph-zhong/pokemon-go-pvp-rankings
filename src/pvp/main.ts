import "../shared/base.css";
import "./pvp.css";
import { suggestTeam, type TeamCandidate } from "../calc/team";
import { loadPokemon, type PokemonEntry } from "../data/pokemon";
import { loadLeagues, loadTeamPool, type LeagueInfo, type TeamPool } from "../data/teams";
import { createCombobox, type ComboboxHandle } from "../ui/combobox";

const SLOT_COUNT = 3;

const els = {
  form: document.getElementById("form") as HTMLFormElement,
  leagueSelect: document.getElementById("league-select") as HTMLSelectElement,
  result: document.getElementById("result") as HTMLElement,
  emptyState: document.getElementById("empty-state") as HTMLElement,
  regenerateBtn: document.getElementById("regenerate-btn") as HTMLButtonElement,
};

const slotEls = Array.from({ length: SLOT_COUNT }, (_, i) => ({
  input: document.getElementById(`slot-${i}-input`) as HTMLInputElement,
  list: document.getElementById(`slot-${i}-listbox`) as HTMLUListElement,
  info: document.getElementById(`slot-${i}-info`) as HTMLElement,
}));

let pokemonList: PokemonEntry[] = [];
let pokemonById = new Map<string, PokemonEntry>();
let leagues: LeagueInfo[] = [];
let pool: TeamPool = {};
let slots: (string | null)[] = Array(SLOT_COUNT).fill(null);
const comboboxes: ComboboxHandle[] = [];

function renderSlot(i: number) {
  const id = slots[i];
  const info = slotEls[i]!.info;
  const entry = id ? pokemonById.get(id) : undefined;
  const data = id ? pool[id] : undefined;
  info.innerHTML = "";
  if (!entry || !data) return;

  const score = document.createElement("span");
  score.className = "score";
  score.textContent = `Score ${data.score.toFixed(1)}`;
  info.appendChild(score);

  if (data.counters.length > 0) {
    const counterNames = data.counters
      .slice(0, 3)
      .map((counterId) => pokemonById.get(counterId)?.name ?? counterId)
      .join(", ");
    info.appendChild(document.createTextNode(` · weak to: ${counterNames}`));
  }
}

function renderAllSlots() {
  for (let i = 0; i < SLOT_COUNT; i++) renderSlot(i);
}

function setSlot(i: number, id: string) {
  slots[i] = id;
  const entry = pokemonById.get(id);
  if (entry) comboboxes[i]?.setDisplayValue(entry.name);
  renderAllSlots();
}

// Suggests a fresh team from this league's pool (§3 of the design doc:
// greedy counter-diversity), overwriting any manual picks — "Regenerate"
// is a new starting point, not a merge with what's already there.
async function onLeagueChange() {
  const leagueKey = els.leagueSelect.value;
  if (!leagueKey) return;

  els.result.hidden = true;
  els.emptyState.hidden = false;
  els.emptyState.textContent = "Loading…";

  pool = await loadTeamPool(leagueKey);
  const candidates: TeamCandidate[] = Object.entries(pool).map(([id, data]) => ({
    id,
    score: data.score,
    counters: data.counters,
  }));
  const suggested = suggestTeam(candidates, SLOT_COUNT);

  slots = Array(SLOT_COUNT).fill(null);
  suggested.forEach((candidate, i) => {
    slots[i] = candidate.id;
    const entry = pokemonById.get(candidate.id);
    if (entry) comboboxes[i]?.setDisplayValue(entry.name);
  });

  els.result.hidden = suggested.length === 0;
  els.emptyState.hidden = suggested.length > 0;
  if (suggested.length === 0) els.emptyState.textContent = "No ranked Pokemon found for this league.";

  renderAllSlots();
}

function populateLeagueSelect() {
  els.leagueSelect.innerHTML = "";
  for (const league of leagues) {
    const option = document.createElement("option");
    option.value = league.key;
    option.textContent = league.title;
    els.leagueSelect.appendChild(option);
  }
}

els.leagueSelect.addEventListener("change", onLeagueChange);
els.regenerateBtn.addEventListener("click", onLeagueChange);
els.form.addEventListener("submit", (e) => e.preventDefault());

// Ineligible-for-this-league and already-on-team options stay in the
// search results, disabled rather than hidden — see
// plans/pvp/design-doc.md section 4 for why (cup rules aren't obvious;
// a species silently missing from search reads as a bug).
for (let i = 0; i < SLOT_COUNT; i++) {
  comboboxes.push(
    createCombobox({
      input: slotEls[i]!.input,
      list: slotEls[i]!.list,
      getOptions: () =>
        pokemonList.map((p) => {
          const eligible = pool[p.id];
          const usedElsewhere = slots.some((s, idx) => idx !== i && s === p.id);
          return {
            id: p.id,
            label: p.name,
            sublabel: `#${p.dex}`,
            disabledReason: !eligible ? "not eligible" : usedElsewhere ? "already on team" : undefined,
          };
        }),
      onSelect: (option) => setSlot(i, option.id),
    }),
  );
}

Promise.all([loadPokemon(), loadLeagues()]).then(([pokemonData, leaguesData]) => {
  pokemonList = pokemonData;
  pokemonById = new Map(pokemonData.map((p) => [p.id, p]));
  leagues = leaguesData;
  populateLeagueSelect();
  onLeagueChange();
});
