# Team Builder — Design Doc

Status: draft v1 · 2026-08-22 · lives at `/pvp/`, see [`plans/ranks/design-doc.md`](../ranks/design-doc.md) for the rank checker this builds alongside.

## 0. What this is

Suggest a team of 3 for Great League, Ultra League, Master League, or whatever cup is currently rotating (e.g. Scroll Cup) — built from PvPoke's own battle-sim output, the same data source `/ranks/` already pulls its move recommendations from. Manual override via search, with ineligible/duplicate picks visibly disabled rather than silently hidden.

## 1. Leagues vs. cups — and not hardcoding "current meta"

Great/Ultra/Master (CP 1500/2500/no cap) are permanent. Cups (Scroll, the Devon cups, Battle Frontier rotations, ...) come and go every few weeks — hardcoding "scroll" anywhere in this codebase means it's wrong again in a month.

PvPoke's `gamemaster.json` already flags which formats are currently live:

```
formats: [{ cup: "scroll", title: "Scroll Cup", cp: 1500, showFormat: true, ... }, ...]
```

**Decision:** at fetch time, enumerate whatever formats have `showFormat: true` and no `hideRankings`, and use their `title`/`cup`/`cp` directly as league options — same daily-refresh mechanism as everything else (`update-data.yml`), so "meta" always matches whatever's actually live without a code change. The 3 constant leagues stay hardcoded (they never change); rotating cups are discovered, not named in code.

## 2. Eligibility: reuse the ranking file, don't reimplement cup rules

Cup legality in `gamemaster.json` is an `include`/`exclude` filter tree (by type, tag, or species id — e.g. Bastille Cup allows Bug/Dragon/Poison/Steel/Water, excludes Mega/Shadow, with specific overrides). Reimplementing that filter engine client-side would be real work and an easy place to drift out of sync with PvPoke's own rules.

**Decision:** don't. Every cup's `rankings/<cup>/overall/rankings-<cp>.json` is already the output of applying that filter — a species appears in the file *because* it's legal. "Is this Pokemon eligible for this cup" becomes "does it have an entry in this cup's rankings file," exactly the same pattern `/ranks/` already uses for "does this species have a moveset recommendation" (see ranks design doc §13). One data shape, reused for a second purpose.

## 3. The auto-suggest algorithm

Top-3-by-rating would technically be "a team," but three answers to the same question isn't a *team* — GBL punishes redundant counters as much as low individual ratings. The minimum bar for this feature to be worth building over a plain leaderboard is basic counter diversity.

**Decision: greedy, not exhaustive.** Each cup's rankings entry already includes a `counters` list (its worst matchups). Building the suggested 3:

1. Pick the #1-rated eligible Pokemon for slot 1.
2. For slot 2, take the highest-rated remaining Pokemon whose `counters` list overlaps the least with slot 1's `counters`.
3. For slot 3, same, scored against the *combined* counters of slots 1 and 2.

This is O(n) per slot against an already-sorted, already-small (~100-300 species) per-cup list — not a real synergy optimizer (it won't catch second-order interactions, and it's still a heuristic, not search over all C(n,3) combinations), but it's a large step up from "top 3 by rating" for roughly the same amount of code, and it's honest about being a heuristic rather than pretending to be optimal.

**Explicitly out of scope for v1:** full combinatorial team synergy search, shield-usage simulation, opponent-team prediction. Flag as future work if the greedy version turns out to feel wrong in practice.

## 4. Manual override: toggle a shortlist, generate 3 alternatives

First cut of this section used the `/ranks/`-style search combobox with disabled options for ineligible/duplicate picks (dim, don't hide — see the earlier commit for that version). Revised after actually using it: three independent per-slot searches is a lot of typing for "I don't want to use my favorite," and it only ever produced one team, so there was nothing to compare against.

**Decision:** show a shortlist of the top ~24 highest-scoring eligible Pokemon as click-to-toggle chips (tap to exclude, tap again to re-include — no search needed for the common case of "everything except this one thing"), and generate **3** alternative teams from whatever's still available, not one. `suggestTeams()` in `src/calc/team.ts` seeds team N from the Nth-best-scoring available candidate (not leftovers from team N-1), then fills the rest the same greedy-diverse way as `suggestTeam()` — so the same strong candidate can legitimately anchor more than one alternative, since these are different starting points to pick between, not a partition of the pool. Regenerates automatically on every toggle; no separate "Generate" button to press.

The `disabledReason` extension added to `src/ui/combobox.ts` for the first cut was reverted (unused once the combobox left this page entirely) rather than left in as unused surface — see git history if a future page needs that pattern again, the shape was simple.

**Explicitly out of scope:** searching to add a specific low-ranked species not in the top-24 shortlist. Revisit if the shortlist ever feels too narrow in practice.

## 5. Data additions

New per-league-or-cup file, `public/data/teams/<key>.min.json` (`key` = `great`/`ultra`/`master`/the cup's slug): `Record<speciesId, { score: number; counters: string[] }>` — small (only eligible species, not all 1600) and reuses the fetch pattern from `movesets.min.json`. Uses `score` (PvPoke's own 0-100 rank score) rather than the raw `rating` field named in the original sketch above — `score` is what actually determines PvPoke's own ordering, `rating` is closer to an internal battle-sim Elo number.

Also new: `public/data/leagues.min.json`, the catalog from §1 (`{ key, title, cp }[]`) driving the league/cup `<select>`.

## 6. Status: implemented

Live at `/pvp/`. `src/calc/team.ts` (`suggestTeam`/`suggestTeams`, tested against synthetic pools with known overlapping counters), `src/data/teams.ts` (`loadLeagues`/`loadTeamPool`, per-league lazy-loaded and cached), `src/ui/combobox.ts` extended with `disabledReason` for the manual "My team" search (keyboard nav skips disabled entries; verified in Chromium that "not eligible"/"already on team" species render dimmed rather than being hidden). 11 leagues discovered as of this writing (3 standard + 8 currently-active cups) — that count will drift over time by design, not a bug.

## 7. Team-level threat feedback and a manual team

A member's own `counters` list only says "this loses to X" — it doesn't say whether X is a problem for the *team*, or just an unlucky matchup for one pick. The real structural weakness is an opponent that counters more than one member at once: a single answer the other player can lean on every game.

**Decision:** `analyzeTeamThreats(team)` in `src/calc/team.ts` aggregates every member's `counters` and surfaces opponents that beat 2+ of them, sorted worst-first — pure client-side aggregation over data already fetched, no new source, no simulation. Rendered as "Struggles against: X (2/3), Y (2/3)" under every team card, suggested or manual alike, or an explicit "nothing beats more than one of your picks" when there's nothing to flag (a genuinely good sign worth stating, not just an empty section).

Also added a **manual "My team" section** below the 3 suggestions: 3 search slots (the `disabledReason` combobox, same pattern as the first cut of §4, now genuinely used again) searching the *full* eligible pool rather than the top-24 shortlist, since picking your own team is precisely for reaching past the shortlist. Same member-info and threat-analysis rendering as the suggested teams, so all 4 teams on the page (3 suggested + manual) read consistently.

Also added a one-line **score legend** ("Score is PvPoke's 0-100 battle-sim rating...") — the raw number had no context otherwise.

## 8. Next: exhaustive search, role-aware teams, shareable state

Not started — planned here first since all three interact (role-aware scoring changes what the exhaustive search optimizes over; URL vs. local state is really "which piece of state is a shareable result vs. your private workspace").

### 8a. Exhaustive search over the shortlist

`suggestTeams()` today is a greedy heuristic seeded from N different starting points — reasonable when the pool was assumed too large to search exhaustively, but the shortlist actually shown to users is only ~24 candidates. C(24,3) = 2,024 possible teams. Evaluating all of them is trivial (sub-few-ms in JS) — there's no reason left to settle for a heuristic here.

**Decision:** replace the greedy fill with brute force over the shortlist. Needs one new thing the greedy version didn't: a single combined objective to rank 2,024 teams against, since "pick greedily to minimize overlap" doesn't produce a sortable score for a fixed team. Proposed:

```
objective(team) = averageScore(team) - PENALTY * sharedThreatWeight(team)
sharedThreatWeight(team) = sum over analyzeTeamThreats(team) of (beatsCount - 1), for beatsCount > 1
```

i.e. every "extra" member a shared threat counters beyond the first costs `PENALTY` points off the team's average score. Starting point: `PENALTY = 3` (a team with one double-threat loses ~3 points, roughly the gap between a top-5 and top-15 pick in most leagues) — call this out as a tunable constant with a comment, not a derived value; adjust after looking at real output, not in the abstract.

For the 3 "alternatives," sort all 2,024 teams by `objective` descending and greedily accept into the results list only teams sharing at most 1 member with every team already accepted — keeps the 3 shown teams genuinely different choices instead of near-duplicates of the global optimum, same goal §3's seed-diversity had, now applied as a filter over exhaustive results instead of a generation strategy.

### 8b. Role-aware teams (leads / switches / closers)

Real GBL team-building is role-based — a cheap neutral **lead**, a bulky **safe switch** that can eat a bad matchup, and a heavy **closer** held in reserve — not just "3 highest overall score." PvPoke's rankings already compute this: `rankings/<cup>/{leads,switches,closers,overall}/rankings-<cp>.json`, one JSON per role, same shape as the `overall` file `fetch-gamemaster.mjs` already pulls.

**Decision:** fetch all 4 role scenarios per league (not just `overall`) into `public/data/teams/<league>-<role>.min.json`. Two things to decide before implementing, not just default silently:

- **Data cost:** 11 leagues × 4 roles instead of × 1 — four times the file count, though each individual file stays small and per-league lazy-loading means a session only ever fetches the roles for leagues actually visited. Acceptable; call out in the PR body with real before/after byte counts, not an estimate.
- **How role feeds into team-building** — two options, pick one rather than both to avoid scope creep:
  (a) manual: each of the 3 "My team" slots gets a role label (Lead/Switch/Closer), and that slot's search ranks/sorts by that role's score instead of overall — the user explicitly builds a role-balanced team.
  (b) automatic: the suggester tries to fill one of each role per generated team, using each role's own score to pick within it.
  Recommendation: **(a) first** — it's the simpler change (a label + a different sort key per slot, no change to the suggestion algorithm), and it teaches the role concept explicitly rather than hiding it inside auto-generated picks. (b) can follow once (a) proves the data/UI is right.

### 8c. Persistence: URL for shareable results, localStorage for workspace

Two different questions were being asked as one: "make `/pvp/` shareable via URL" and "remember my shortlist exclusions between visits" are different kinds of state with different best homes.

**Decision — don't pick one mechanism for everything, split by what the state is for:**

- **URL query params** for the *result* someone would actually want to send a friend: league/cup + the manual team's 3 species ids (`?l=great&team=azumarill,registeel,skarmory`), mirroring `/ranks/`'s existing `?pokemon=...&league=...&ivs=...` pattern exactly. A manual team is a shareable artifact — "look what I built" — the same way a rank result is.
- **`localStorage`** for pool exclusions (which chips are toggled off). This is working-session state, not a result — nobody sends a friend a link to say "here's which 20 of the top 24 I didn't exclude." Persisting it locally means a returning user doesn't lose their exclusions on refresh, without bloating the URL with up to 24 excluded ids that would dwarf the actual shareable content.

This is the same split tools like Figma/Excalidraw use: URL identifies the shareable artifact, local storage holds your personal editing session on top of it. Concretely: `localStorage.setItem('pvp-excluded-' + leagueKey, JSON.stringify([...excluded]))`, namespaced per league key so switching leagues doesn't leak one league's exclusions into another's chip list.

**Explicitly not doing:** encoding exclusions in the URL, or persisting the manual team to localStorage instead of the URL. Keeping the split clean is more important than either mechanism being individually "more complete."
