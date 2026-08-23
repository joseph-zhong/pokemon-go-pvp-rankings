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

Live at `/pvp/`. `src/calc/team.ts` (`suggestTeam`, tested against a synthetic pool with known overlapping counters), `src/data/teams.ts` (`loadLeagues`/`loadTeamPool`, per-league lazy-loaded and cached), `src/ui/combobox.ts` extended with `disabledReason` (keyboard nav skips disabled entries; verified in Chromium that "not eligible" species render dimmed in the Scroll Cup search results rather than being hidden). 11 leagues discovered as of this writing (3 standard + 8 currently-active cups) — that count will drift over time by design, not a bug.
