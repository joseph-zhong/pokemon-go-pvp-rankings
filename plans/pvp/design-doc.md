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

## 4. Manual override: dim, don't hide

Auto-suggestion is a starting point, not the whole feature — users pick their own 3 too, searching the same combobox `/ranks/` already has (`src/ui/combobox.ts`, now shared via the multi-page restructuring).

**Decision:** ineligible or already-picked species stay in the results, rendered disabled (reduced opacity, `aria-disabled`, not clickable) rather than filtered out of the list entirely. Reasoning: cup legality rules aren't obvious (why can't I add Talonflame to a Scroll Cup team?) — silently omitting a species from search results reads as a bug ("is search broken?"), while a visibly-disabled entry with a short reason ("not eligible this cup") teaches the rule instead of hiding it. Same treatment for a species already on the current team, so a duplicate pick is clearly not an option rather than mysteriously missing.

This extends the existing `createCombobox` component with an optional per-option disabled predicate + reason, rather than a new component — the search/filter/keyboard-nav logic is identical to `/ranks/`'s Pokemon search, only the render step differs.

## 5. Data additions

New per-league-or-cup file, `public/data/teams/<key>.min.json` (`key` = `great`/`ultra`/`master`/the cup's slug), each: `{ speciesId: { rating, counters: speciesId[] } }[]`, sorted by rating descending — small (only eligible species, not all 1600) and reuses the fetch pattern from `movesets.min.json`.

## 6. Next step

Not started. Once this direction is confirmed: extend `fetch-gamemaster.mjs` for §1/§2/§5, implement the greedy suggester (§3) as a pure function (testable the same way `rank.ts` is), then the `/pvp/` UI (league/cup selector, 3 team slots, the extended combobox from §4).
