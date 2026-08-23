import "../shared/base.css";
import "./pvp.css";
import { analyzeTeamThreats, suggestTeams, type TeamCandidate } from "../calc/team";
import { loadPokemon, type PokemonEntry } from "../data/pokemon";
import { loadLeagues, loadTeamPool, type LeagueInfo, type TeamPool } from "../data/teams";
import { createCombobox, type ComboboxHandle } from "../ui/combobox";

const TEAM_SIZE = 3;
const ALTERNATIVES = 3;
// How many top-scoring Pokemon are offered as toggleable chips. This is a
// shortlist, not the full eligible pool (which can run 100s-1000s deep) —
// nobody realistically wants to exclude the 400th-ranked species, and a
// shortlist keeps the toggle UI scannable instead of an overwhelming wall.
// Manual team search (below) isn't limited to this shortlist — it searches
// the full eligible pool, since that's the point of building your own.
const POOL_SHORTLIST_SIZE = 24;

const els = {
  form: document.getElementById("form") as HTMLFormElement,
  leagueSelect: document.getElementById("league-select") as HTMLSelectElement,
  poolSection: document.getElementById("pool-section") as HTMLElement,
  poolList: document.getElementById("pool-list") as HTMLElement,
  result: document.getElementById("result") as HTMLElement,
  teamsList: document.getElementById("teams-list") as HTMLElement,
  myTeamSection: document.getElementById("my-team-section") as HTMLElement,
  myTeamThreats: document.getElementById("my-team-threats") as HTMLElement,
  emptyState: document.getElementById("empty-state") as HTMLElement,
};

const myTeamSlotEls = Array.from({ length: TEAM_SIZE }, (_, i) => ({
  input: document.getElementById(`my-slot-${i}-input`) as HTMLInputElement,
  list: document.getElementById(`my-slot-${i}-listbox`) as HTMLUListElement,
  info: document.getElementById(`my-slot-${i}-info`) as HTMLElement,
}));

let pokemonList: PokemonEntry[] = [];
let pokemonById = new Map<string, PokemonEntry>();
let leagues: LeagueInfo[] = [];
let pool: TeamPool = {};
let shortlist: TeamCandidate[] = [];
let excluded = new Set<string>();
let myTeam: (string | null)[] = Array(TEAM_SIZE).fill(null);
const myTeamComboboxes: ComboboxHandle[] = [];

function speciesName(id: string): string {
  return pokemonById.get(id)?.name ?? id;
}

function candidateFor(id: string): TeamCandidate | undefined {
  const data = pool[id];
  return data ? { id, score: data.score, counters: data.counters } : undefined;
}

function renderMemberInfo(el: HTMLElement, member: TeamCandidate) {
  el.innerHTML = "";
  const score = document.createElement("span");
  score.className = "score";
  score.textContent = `Score ${member.score.toFixed(1)}`;
  el.appendChild(score);
  if (member.counters.length > 0) {
    const counterNames = member.counters.slice(0, 3).map(speciesName).join(", ");
    el.appendChild(document.createTextNode(` · weak to: ${counterNames}`));
  }
}

// A member's own "weak to" list is one matchup at a time. A team's real
// structural weakness is an opponent that counters more than one member at
// once — a single answer the other player can lean on repeatedly. Pure
// aggregation over data already on hand (see analyzeTeamThreats), so this
// costs nothing extra to compute for every team shown on the page.
function renderThreats(el: HTMLElement, team: TeamCandidate[]) {
  el.innerHTML = "";
  if (team.length === 0) return;

  const label = document.createElement("span");
  label.className = "label";
  label.textContent = "Struggles against: ";
  el.appendChild(label);

  const shared = analyzeTeamThreats(team).filter((t) => t.beatsCount > 1);
  if (shared.length === 0) {
    const safe = document.createElement("span");
    safe.className = "safe";
    safe.textContent = "nothing beats more than one of your picks.";
    el.appendChild(safe);
    return;
  }

  shared.slice(0, 4).forEach((threat, i) => {
    if (i > 0) el.appendChild(document.createTextNode(", "));
    const name = document.createElement("span");
    name.className = "threat-name";
    name.textContent = speciesName(threat.opponentId);
    el.appendChild(name);
    const count = document.createElement("span");
    count.className = "threat-count";
    count.textContent = ` (${threat.beatsCount}/${team.length})`;
    el.appendChild(count);
  });
}

function renderPool() {
  els.poolList.innerHTML = "";
  for (const candidate of shortlist) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "pool-chip";
    if (excluded.has(candidate.id)) btn.classList.add("pool-chip-excluded");
    btn.setAttribute("aria-pressed", String(!excluded.has(candidate.id)));

    const name = document.createElement("span");
    name.textContent = speciesName(candidate.id);
    btn.appendChild(name);

    const score = document.createElement("span");
    score.className = "score";
    score.textContent = candidate.score.toFixed(1);
    btn.appendChild(score);

    btn.addEventListener("click", () => {
      if (excluded.has(candidate.id)) excluded.delete(candidate.id);
      else excluded.add(candidate.id);
      renderPool();
      renderSuggestedTeams();
    });
    els.poolList.appendChild(btn);
  }
}

function renderSuggestedTeams() {
  const available = shortlist.filter((c) => !excluded.has(c.id));
  const teams = suggestTeams(available, ALTERNATIVES, TEAM_SIZE);

  els.teamsList.innerHTML = "";
  teams.forEach((team, i) => {
    const card = document.createElement("div");
    card.className = "team-card";

    const heading = document.createElement("h3");
    heading.textContent = `Team ${i + 1}`;
    card.appendChild(heading);

    const members = document.createElement("div");
    members.className = "team-card-members";
    for (const member of team) {
      const row = document.createElement("div");
      row.className = "team-member";
      const name = document.createElement("span");
      name.className = "name";
      name.textContent = speciesName(member.id);
      row.appendChild(name);
      const meta = document.createElement("span");
      meta.className = "meta";
      row.appendChild(meta);
      renderMemberInfo(meta, member);
      members.appendChild(row);
    }
    card.appendChild(members);

    const threats = document.createElement("div");
    threats.className = "team-threats";
    renderThreats(threats, team);
    card.appendChild(threats);

    els.teamsList.appendChild(card);
  });

  els.result.hidden = teams.length === 0;
}

function renderMyTeam() {
  const team: TeamCandidate[] = [];
  myTeam.forEach((id, i) => {
    const candidate = id ? candidateFor(id) : undefined;
    if (candidate) {
      renderMemberInfo(myTeamSlotEls[i]!.info, candidate);
      team.push(candidate);
    } else {
      myTeamSlotEls[i]!.info.innerHTML = "";
    }
  });
  renderThreats(els.myTeamThreats, team);
}

function setMySlot(i: number, id: string) {
  myTeam[i] = id;
  const entry = pokemonById.get(id);
  if (entry) myTeamComboboxes[i]?.setDisplayValue(entry.name);
  renderMyTeam();
}

// Suggests a fresh set of teams from this league's pool (§3 of the design
// doc: greedy counter-diversity), overwriting any toggle exclusions and
// manual picks — switching leagues is a new starting point.
async function onLeagueChange() {
  const leagueKey = els.leagueSelect.value;
  if (!leagueKey) return;

  els.poolSection.hidden = true;
  els.result.hidden = true;
  els.myTeamSection.hidden = true;
  els.emptyState.hidden = false;
  els.emptyState.textContent = "Loading…";

  pool = await loadTeamPool(leagueKey);
  shortlist = Object.entries(pool)
    .map(([id, data]) => ({ id, score: data.score, counters: data.counters }))
    .sort((a, b) => b.score - a.score)
    .slice(0, POOL_SHORTLIST_SIZE);
  excluded = new Set();
  myTeam = Array(TEAM_SIZE).fill(null);
  myTeamComboboxes.forEach((cb) => cb.setDisplayValue(""));

  const hasData = shortlist.length > 0;
  els.poolSection.hidden = !hasData;
  els.result.hidden = !hasData;
  els.myTeamSection.hidden = !hasData;
  els.emptyState.hidden = hasData;
  if (!hasData) els.emptyState.textContent = "No ranked Pokemon found for this league.";

  renderPool();
  renderSuggestedTeams();
  renderMyTeam();
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
els.form.addEventListener("submit", (e) => e.preventDefault());

// Manual team search covers the full eligible pool, not just the top-24
// shortlist above — that's the point of building your own instead of
// picking from the suggestions. Ineligible/already-picked species stay
// visible, disabled with a reason, rather than being filtered out (see
// plans/pvp/design-doc.md section 4).
for (let i = 0; i < TEAM_SIZE; i++) {
  myTeamComboboxes.push(
    createCombobox({
      input: myTeamSlotEls[i]!.input,
      list: myTeamSlotEls[i]!.list,
      getOptions: () =>
        pokemonList.map((p) => {
          const eligible = pool[p.id];
          const usedElsewhere = myTeam.some((id, idx) => idx !== i && id === p.id);
          return {
            id: p.id,
            label: p.name,
            sublabel: `#${p.dex}`,
            disabledReason: !eligible ? "not eligible" : usedElsewhere ? "already on team" : undefined,
          };
        }),
      onSelect: (option) => setMySlot(i, option.id),
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
