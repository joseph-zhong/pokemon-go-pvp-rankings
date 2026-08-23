import "../shared/base.css";
import "./pvp.css";
import { suggestTeams, type TeamCandidate } from "../calc/team";
import { loadPokemon, type PokemonEntry } from "../data/pokemon";
import { loadLeagues, loadTeamPool, type LeagueInfo, type TeamPool } from "../data/teams";

const TEAM_SIZE = 3;
const ALTERNATIVES = 3;
// How many top-scoring Pokemon are offered as toggleable chips. This is a
// shortlist, not the full eligible pool (which can run 100s-1000s deep) —
// nobody realistically wants to exclude the 400th-ranked species, and a
// shortlist keeps the toggle UI scannable instead of an overwhelming wall.
const POOL_SHORTLIST_SIZE = 24;

const els = {
  form: document.getElementById("form") as HTMLFormElement,
  leagueSelect: document.getElementById("league-select") as HTMLSelectElement,
  poolSection: document.getElementById("pool-section") as HTMLElement,
  poolList: document.getElementById("pool-list") as HTMLElement,
  result: document.getElementById("result") as HTMLElement,
  teamsList: document.getElementById("teams-list") as HTMLElement,
  emptyState: document.getElementById("empty-state") as HTMLElement,
};

let pokemonById = new Map<string, PokemonEntry>();
let leagues: LeagueInfo[] = [];
let pool: TeamPool = {};
let shortlist: TeamCandidate[] = [];
let excluded = new Set<string>();

function speciesName(id: string): string {
  return pokemonById.get(id)?.name ?? id;
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
      renderTeams();
    });
    els.poolList.appendChild(btn);
  }
}

function renderTeams() {
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
      const scoreSpan = document.createElement("span");
      scoreSpan.className = "score";
      scoreSpan.textContent = `Score ${member.score.toFixed(1)}`;
      meta.appendChild(scoreSpan);
      if (member.counters.length > 0) {
        const counterNames = member.counters.slice(0, 3).map(speciesName).join(", ");
        meta.appendChild(document.createTextNode(` · weak to: ${counterNames}`));
      }
      row.appendChild(meta);

      members.appendChild(row);
    }
    card.appendChild(members);
    els.teamsList.appendChild(card);
  });

  els.result.hidden = teams.length === 0;
}

async function onLeagueChange() {
  const leagueKey = els.leagueSelect.value;
  if (!leagueKey) return;

  els.poolSection.hidden = true;
  els.result.hidden = true;
  els.emptyState.hidden = false;
  els.emptyState.textContent = "Loading…";

  pool = await loadTeamPool(leagueKey);
  shortlist = Object.entries(pool)
    .map(([id, data]) => ({ id, score: data.score, counters: data.counters }))
    .sort((a, b) => b.score - a.score)
    .slice(0, POOL_SHORTLIST_SIZE);
  excluded = new Set();

  const hasData = shortlist.length > 0;
  els.poolSection.hidden = !hasData;
  els.emptyState.hidden = hasData;
  if (!hasData) els.emptyState.textContent = "No ranked Pokemon found for this league.";

  renderPool();
  renderTeams();
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

Promise.all([loadPokemon(), loadLeagues()]).then(([pokemonData, leaguesData]) => {
  pokemonById = new Map(pokemonData.map((p) => [p.id, p]));
  leagues = leaguesData;
  populateLeagueSelect();
  onLeagueChange();
});
