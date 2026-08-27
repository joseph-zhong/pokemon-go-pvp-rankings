# Pokémon GO PvP Rank Checker — Design Doc

Status: draft v1 · 2026-08-21

## 0. At a glance

- 4,096 IV combinations per Pokémon (16 Attack × 16 Defense × 16 HP)
- 3 standard leagues: Great (CP 1500), Ultra (CP 2500), Master (no cap)
- Source of truth: [PvPoke's `gamemaster.json`](https://github.com/pvpoke/pvpoke) — MIT licensed, community-maintained
- The whole "rank checker" is a pure function that runs in <1ms client-side — no database, no backend, no ads needed
- Target hosting: Cloudflare Pages, $0/mo

## 1. The problem

stadiumgaming.gg's rank checker (and every clone like it) looks like a lookup-table product, but it isn't one. It's a small, deterministic calculation over a Pokémon's base stats. The reason these sites feel heavy is ads and bloat around the calculation, not the calculation itself. So the "clone, but performant" goal is really: **do the same 4,096-way sort, but in the browser, with no ad tech in the critical path.**

## 2. How the ranking is actually calculated

Every Pokémon's real-world stat at level `L` comes from three base stats (Attack, Defense, HP, fixed per species) and a **CP Multiplier** (CPM), a lookup table Niantic defines once per half-level from 1 to 51.

```
atk(IV_a, L) = (baseAtk + IV_a) * CPM(L)
def(IV_d, L) = (baseDef + IV_d) * CPM(L)
hp (IV_h, L) = floor((baseHP + IV_h) * CPM(L))

CP(L)  = floor( atk * sqrt(def) * sqrt(hp) / 10 )
statProduct(L) = atk * def * hp        # note: linear, no sqrt — this is what ranking sorts by
```

**The rank-checker algorithm**, for one Pokémon in one league:

```
for each of the 4096 (IV_a, IV_d, IV_h) combinations in 0..15:
    walk L down from 51.0 in 0.5 steps until CP(L) <= league cap
    record statProduct at that L
sort all 4096 results by statProduct descending
    (ties broken by: higher Attack stat, then higher HP stat, then higher CP, then higher HP IV)
rank = 1-indexed position of the combo you asked about
percentage = statProduct / statProduct(best combo) * 100
```

That's the entire "engine." No league is ever storing 4,096 rows per Pokémon anywhere — it's recomputed on demand, and it's cheap: 4,096 iterations of arithmetic is sub-millisecond in JS, even on a low-end phone.

**The counterintuitive part** (worth surfacing in the UI): Attack enters the CP formula linearly, but Defense and HP enter under a square root. So a *lower* Attack IV lets a Pokémon climb to a higher level before hitting the CP cap, and every stat benefits from that higher level's CPM. That's why "low attack, high bulk" IV spreads often outrank 15/15/15 in Great/Ultra League — and why Master League (no CP cap) is the one place 15/15/15 is simply best, since the level-cap trade-off disappears.

## 3. Source of truth — and how to keep it current

Base stats and move data ultimately come from Niantic's `GAME_MASTER` file, shipped inside the Pokémon GO client as a protobuf. Nobody sane parses that directly for a hobby project.

In practice, the entire PvP tool ecosystem (PvPoke, and everything downstream of it, likely including stadiumgaming.gg) treats **[pvpoke/pvpoke's `src/data/gamemaster.json`](https://github.com/pvpoke/pvpoke/blob/master/src/data/gamemaster.json)** as the de facto source of truth: it's MIT-licensed, scraped/maintained by an active community within hours to days of any game update, and already normalized into a sane JSON schema (species id, base stats, tags like `little`/`shadoweligible`, move lists, CP multiplier table).

**Recommendation:** don't re-derive this data ourselves. Pull PvPoke's `gamemaster.json` on a schedule, slim it down to only what a rank checker needs (species id, name, base stats, forms, release status — drop move data, which we don't need for pure IV ranking), and commit the slim file into this repo as a build input.

Update cadence, by what actually changes:

| What changes | How often | How we catch it |
|---|---|---|
| New Pokémon / forms released | Weekly-ish (during events) | Scheduled fetch diff |
| Base stat corrections (rare bugs) | A few times a year | Scheduled fetch diff |
| CP Multiplier table | Only when Niantic raises the level cap (has happened ~3 times ever) | Manual — flag in code, don't automate |
| League CP caps / cup rules | Rare, GBL season changes | Manual review, cheap to update |

A daily GitHub Action that fetches PvPoke's `gamemaster.json`, regenerates our slim data file, and opens (or auto-merges, since this is a low-risk data-only diff) a PR is enough. Cloudflare Pages redeploys automatically on merge.

## 4. Architecture

No backend, no database, no ad network — the whole thing is a static site plus one small JSON data file.

```
                    ┌────────────────────────┐
   GitHub Action    │  pvpoke/pvpoke          │
   (daily cron)  ───▶  gamemaster.json (MIT)  │
        │           └────────────────────────┘
        ▼
  scripts/fetch-gamemaster.ts
  (slims to {speciesId, name, baseStats, forms, tags})
        │
        ▼
  data/pokemon.min.json  ──▶ committed to repo ──▶ Cloudflare Pages build
                                                          │
                                                          ▼
                                              static HTML/JS, served from edge
                                              all ranking math runs in-browser
```

- **Frontend:** plain TypeScript + Vite. No React/Vue needed — the app is one form and one result panel; a framework adds bundle weight for no real benefit here. (Open to Preact if the UI grows a lot, but start minimal.)
- **Calc module:** pure functions, zero DOM dependency, fully unit-testable (`cpm.ts`, `rank.ts`).
- **Data file:** one JSON blob (~200–400KB gzipped for ~1,000+ species), fetched once, cached hard at the Cloudflare edge (`Cache-Control: immutable` + content-hashed filename).
- **Hosting:** Cloudflare Pages, static build, free tier is enough.

## 5. MVP scope

One page. Inputs:
- Pokémon search (typeahead over the local data file, no network call per keystroke)
- League selector: Great / Ultra / Master (+ optionally a "custom CP cap" field for special cups)
- Three IV inputs, 0–15 each: Attack, Defense, HP

Outputs, updated live on every input change (no submit button, no loading spinner — it's instant):
- Best level under the CP cap, resulting CP
- Stat product and percentage (relative to that Pokémon's best possible combo in that league)
- Rank out of 4,096
- Optional stretch: "best IV spread for this league" shown alongside for comparison

No accounts, no ads, no server-side anything.

## 6. IV input UX — dropdown vs. stepper vs. slider

| Pattern | Pros | Cons |
|---|---|---|
| `<select>` dropdown (0–15) | Familiar, native, accessible for free | Slowest — 2 taps + scroll through 16 items, per stat, ×3 |
| Slider | Fun, visual | Imprecise on touch, needs a visible numeric readout anyway, awkward to land exactly on an integer |
| Number input + stepper (spinner) | Fastest: type the digit directly, or click ▲▼, or arrow-key while focused; scales to 3 fields without excess taps | Needs explicit min/max/step + validation |

**Recommendation:** a plain `<input type="number" min="0" max="15" step="1" inputmode="numeric">` styled as a compact stepper, one per stat, tab order Attack → Defense → HP. This gets native keyboard support (arrow keys, typing), native mobile numeric keypad, and full accessibility for free — no custom widget to maintain. Reserve a real `<select>` only for the league picker, where there are just 3–4 options and no speed benefit to anything fancier.

Other UX details worth building in from day one since they're nearly free:
- **URL state:** encode `?pokemon=azumarill&league=great&ivs=0-15-14` in the query string. Makes results shareable/bookmarkable and gives back-button support, with zero backend.
- **Paste support:** let users paste `12/14/15`-style strings (common format from in-game screenshots and IV scanners) into any of the three fields and auto-split.
- **No debounce needed** — the computation is sub-millisecond, so update on every keystroke instead of adding artificial lag.

## 7. Proposed repo layout

```
pokemon-go-pvp-rankings/
  data/
    pokemon.min.json          # generated — slimmed gamemaster data
    cpm.json                  # generated — CP multiplier table
  scripts/
    fetch-gamemaster.ts       # pulls + slims PvPoke's gamemaster.json
  src/
    calc/
      cpm.ts
      rank.ts                 # pure functions, unit tested
      rank.test.ts
    ui/
      App.ts
      PokemonSelect.ts
      IvInputs.ts
      ResultPanel.ts
    main.ts
  index.html
  .github/workflows/update-data.yml   # daily cron → fetch → PR/auto-merge
  README.md                   # cites PvPoke (MIT) + Niantic disclaimer
```

## 8. Performance budget (vs. a typical ad-laden competitor)

| | Typical ad-supported rank checker | This project |
|---|---|---|
| Ad/tracker JS on critical path | Yes (often 1–3MB, blocks interaction) | None |
| Backend round-trip per lookup | Sometimes | Never — pure client-side math |
| Data payload | Varies | ~200–400KB gzip, once, cached at edge |
| Time to interactive | Often multiple seconds | Sub-second on a static edge-cached page |

*Measured in the shipped MVP: 5.6KB gzipped JS+CSS, 25KB gzipped data, one HTML request, zero third-party requests.*

## 9. License & attribution

PvPoke's repository is MIT licensed, so reusing `gamemaster.json` (and referencing their ranking approach) is allowed with attribution — keep their copyright notice in this repo's README/about section. All of this data ultimately originates from Niantic's game files, so it's worth a small "not affiliated with Niantic" disclaimer on the site itself, same as PvPoke carries.

## 10. Top 5 & nearby ranks

stadiumgaming.gg's rank checker shows a top-10 list alongside the single rank — useful context that a bare "#26 / 4096" doesn't give you. We can add this for free: `rankIvs` already builds and sorts the full 4096-combo array internally to find one rank, then throws the rest away. Exposing that array instead of discarding it costs nothing extra.

**API change:** replace the single-result `rankIvs` with `rankAllIvs(base, league, levelCap)`, returning all 4096 combos sorted and ranked (`{ ivs, level, cp, statProduct, percentage, rank }[]`). A `findCombo(all, ivs)` helper looks up one entry by IVs. This becomes the one source of truth for the query result, the top-5 list, the nearby list, and the rank slider below (§11) — computed once per species/league/level-cap, not once per feature.

- **Top 5:** `all.slice(0, 5)`.
- **Nearby:** a window centered on the query's rank — 5 ranks better and 5 ranks worse (11 rows including the query), clipped at the #1 / #4096 boundary. Labeled "Nearby ranks" so the exact window size doesn't need to be guessed by the reader.

Both lists are rendered as small tables (rank, IVs, level, CP, %), and each row is clickable — clicking loads those IVs into the form. That makes browsing the leaderboard double as a way to explore "what if I had these IVs instead."

## 11. Rank → IVs explorer (reverse lookup)

The flow so far is one-directional: type IVs, read off a rank. Sometimes the useful question is the other way around — "what IVs would land around rank #50?" Since `rankAllIvs` returns a rank-sorted array, that reverse lookup is just array indexing: `all[rank - 1]`. No new math, only a new way to read the same table.

**UI:** a labeled range slider from "Best (#1)" to "Worst (#4096)". Dragging it doesn't open a separate preview — it sets the actual IV fields to whatever combo sits at that rank, the same as typing IVs directly or clicking a Top-5/Nearby row would. One state, three ways to set it. That keeps the rank number, the top-5 list, and the nearby list always in sync with whatever's currently being explored, instead of introducing a second "preview" state to keep consistent with the real query.

**Performance:** dragging fires many events per second, but it never recomputes the 4096-combo ranking — that only happens when species, league, or level cap changes (§10's `rankAllIvs`). A drag tick is a single array index plus a re-render, comfortably sub-millisecond.

## 12. Evolution navigation

stadiumgaming.gg lets you search a pre-evolution (their example: Frillish) and jump straight to its evolution's ranking — useful because IVs carry over through evolution in Pokemon GO, and most pre-evolution stages are irrelevant to Great/Ultra/Master League (Little Cup, which explicitly wants the base stage, is the exception). Practically, most searches for a baby/basic-stage Pokemon are really "how will this rank once I evolve it," so the evolution should be one click away instead of a second search.

PvPoke's `gamemaster.json` already encodes this per entry — no new data source, no graph we have to build ourselves:

```json
// frillish
"family": { "id": "FAMILY_FRILLISH", "evolutions": ["jellicent"] }
// jellicent
"family": { "id": "FAMILY_FRILLISH", "parent": "frillish" }
```

`parent` is the direct previous stage (absent for a base form); `evolutions` is the list of direct next stages (a list, not a single value, so branching families like Eevee's eight eeveelutions fall out for free). Shadow and Mega variants don't leak into this: shadow chains are self-contained (`bulbasaur_shadow → ivysaur_shadow → venusaur_shadow`, never crossing into the normal chain), and Mega forms carry their pre-Mega species' `parent` rather than appearing inside anyone's `evolutions` list, so they never show up as a suggested evolution.

**Data change:** `scripts/fetch-gamemaster.mjs` additionally captures `parent` (species id or omitted) and `evolutions` (species id array or omitted) per entry — a few more bytes per row, no new fetch, no new source.

**UI:** below the Pokemon search box, show "Evolves from: X" / "Evolves into: Y" as clickable chips whenever they apply (hidden entirely for a Pokemon with neither, e.g. a fully-evolved solo species). Clicking a chip re-runs the same species lookup as picking it from the search box — same IVs, same league, new base stats — so hopping from Frillish to Jellicent is one click, not a second search.

## 13. Recommended moves

IVs and rank are only half of what stadiumgaming.gg/PvPoke show — the other half is "what moveset should this thing actually run in this league." That's a fundamentally different kind of computation than everything else in this doc: ranking IVs is closed-form math (§2), but ranking movesets requires simulating battles against a curated list of meta-relevant opponents and scoring win rates — there's no formula for it.

**Decision: don't build a battle simulator. Pull PvPoke's precomputed output instead.** Their `src/data/rankings/all/overall/rankings-<cp>.json` (MIT, same repo we already depend on) is the *result* of their simulator — for every ranked species, it already includes a `moveset` array (best fast move + best 1-2 charged moves) and usage-ranked `moves.fastMoves`/`moves.chargedMoves` lists (so the 2nd-ranked entry is a ready-made "alternative" suggestion). This keeps the project's whole shape intact: still zero backend, still "pull data, slim it, ship it statically," no new runtime complexity. The tradeoff is real and worth naming: this is *their* opinionated meta snapshot (which opponents they chose to simulate against, how they weight scores), not something we derive from first principles the way IV ranking is — same category of tradeoff as trusting their base stats, just one level more opinionated.

**Data change:** `scripts/fetch-gamemaster.mjs` additionally fetches `rankings-1500.json` / `-2500.json` / `-10000.json` (Great/Ultra/Master) and a move-name/type dictionary from `gamemaster.json`'s `moves` array, producing two new slim files: `moves.min.json` (`moveId → {name, type}`, ~349 entries) and `movesets.min.json` (`speciesId → { great?, ultra?, master?: { fast, charged: string[], altFast?, altCharged? } }`). Species PvPoke never simulated (truly unviable ones) simply have no entry — the UI hides the moves section rather than guessing.

**UI:** a "Recommended moves" block in the result panel, driven only by species + league (not IVs or Best Buddy, since moveset doesn't depend on level) — Fast move plus an alternative if one exists, Charged move(s) plus an alternative.

## 14. Next step

MVP is live (see the open PR). §10-13 are iteration on top of it; §13 (recommended moves) is next up for implementation.

> **Note (2026-08-26):** a collaborator's UI redesign (#8) since replaced the single-league-selector view §10-11 describe with a multi-league view — every evolution stage now shows Great/Ultra/Master rank simultaneously, no league picker. §10/§11's *reasoning* (why a full rank table, why a log-scale explorer) still holds, but the literal UI they describe no longer matches what's shipped. Not rewritten here — out of scope for §15 below, flagging so it's not mistaken for current.

## 15. Evolution CP-cap: dimmed rank + a level/CP slider, moves league toggle, click-to-clear, evolution step buttons

Several follow-ups once the app was actually being used for a bit. The evolution-cap feature went through two shapes — worth keeping both, since the second replaced the first for a real reason, not just taste.

**Evolution CP-cap, v1 (superseded): text warning.** Evolving never lowers level, and CP never lowers. So if a Pokemon is powered up to its own optimal level for a capped league and *then* evolved, the new form can end up over that cap — permanently, since there's no undoing an evolution. First cut: a red warning sentence on each stage card ("Evolving from Chansey exceeds the Great League cap"), driven by `evolutionExceedsCap(base, evolvedBase, ivs, cpCap)` in `rank.ts`. Verified against real community advice this needed to match: Chansey → Blissey and Magikarp → Gyarados both correctly flagged, matching exactly why Chansey and Magikarp (not their evolutions) are the Great League picks.

**Evolution CP-cap, v2 (shipped): dim the rank, add a level/CP slider.** Text only answers yes/no. Replaced it with two changes that show the actual picture instead of describing it:
- The specific league-rank number itself (e.g. Pupitar's "Great League #2,594") dims (`.league-rank-value-dim`) when evolving into that stage from its immediate parent, at the parent's own optimal level, would exceed that league's cap — same underlying `evolutionExceedsCap` check, no separate warning line, following the established dim-don't-hide pattern rather than adding new UI vocabulary.
- A single CP-by-level slider (level 1 → level cap, half-steps) on the *current* (searched) stage's card only — not one per stage, which turned out to be more UI than the question needed. Starts fully powered up; drag down and watch CP fall, with the Great (1500) and Ultra (2500) thresholds marked as fixed reference lines on the track (`bestLevelForCap` gives the exact level each line belongs at; a mark hides itself if this species never reaches that cap within the level range, rather than drawing a misleading line at the edge). This directly answers "at what level does this cross the cap," which the text version could only gesture at.

**Moves league toggle.** The redesigned page (§14's note) shows all 3 leagues at once and auto-picks whichever (stage, league) pair ranks best across the *entire* evolution line for the "Recommended moves" section — no way to pin it to a specific league. Some players only care about one league (Master-only players don't want to see a Great-League-optimized moveset just because some earlier evolution stage happens to rank higher there). Added a small 4-way toggle (Best / Great / Ultra / Master) that scopes the same best-pick logic to just the chosen league when set. Persisted via `localStorage` (`ranks-moves-league`) rather than the URL — this is a personal viewing preference, not part of what makes a shared link meaningful (the URL already identifies which Pokemon/IVs are being shared; it shouldn't also freeze which move column the original sharer happened to have open).

**Click-to-clear, cancel-on-blur.** The IV steppers already had this (a collaborator's #8): focus clears the field for fresh entry, blurring an empty field restores the previous value instead of snapping to 0. Extended the same pattern to `src/ui/combobox.ts` (the Pokemon search, shared by both `/ranks/` and `/pvp/`'s manual team slots) — clearing on both `focus` *and* `click`, since selecting an option leaves the input already focused (`select()` preventDefaults the option's mousedown so the browser never moves focus away), so a follow-up click into the still-focused field wouldn't otherwise fire a fresh focus event. Blurring without completing a new search restores the prior selection rather than leaving stale/empty text that doesn't match what's actually selected.

**Evolution step buttons.** Same idea as the IV steppers' +/-, applied to the evolution chain: `‹`/`›` buttons flanking the Pokemon search step to the direct previous/next stage (using each species' `parent`/`evolutions[0]`) without retyping a name or hunting for the right stage card. Buttons disable themselves at either end of a chain (no `parent`, or no `evolutions`) rather than doing nothing when clicked. Branching lines (Eevee) step to the first listed evolution on `›`; picking a *specific* branch still goes through that stage's card header, which the buttons don't replace.

## 16. Evolution CP-cap, v3: the chain stops collapsing, every stage gets its own boundary slider

v2 (§15) tied the level/CP slider to whichever stage was "current," and built the visible card list by walking *forward* from the searched species only (`forwardEvolutionChain`). That combination broke the one case the whole feature exists for: search "Blissey" directly (rather than clicking through from Chansey), and Chansey never appears as a card at all — forward-only from Blissey finds nothing, since Blissey has no further evolutions. The evolve-boundary visualization, which only makes sense looking *forward* from a pre-evolution, had no pre-evolution card left to live on. The `‹` (previous) button still worked in isolation, but with Chansey's card gone there was no discoverable way back to it and no visualization to see once you got there — reported as "can't go back to Chansey" and "this nice visualization isn't shown for chansey only blissey."

Two changes, both in `src/ranks/main.ts`:

- **`fullEvolutionChain(entry)`** replaces the direct `forwardEvolutionChain(selected)` call. It first walks *backward* via `parent` to find the family's base form, then does the same forward BFS from there. The card list is now the whole family (Happiny → Chansey → Blissey), independent of which stage happens to be selected — clicking into Blissey no longer makes Chansey disappear, so its header (and the `‹` button, which was always correct) both remain valid ways back. `forwardEvolutionChain` itself is unchanged, just renamed to take an explicit `root` rather than implying it's always the selected entry.
- **Every stage gets its own slider**, not just the current one (`buildLevelSlider` now runs unconditionally in `createStageCard`; the module-level singleton `levelSlider` is gone in favor of a `SliderHandle` stored per `StageCardHandle` and updated in the same `chain.forEach` loop that already renders each stage's ranks). Critically, a stage's marks aren't always about *its own* CP: if the stage has a next evolution, the marks are positioned using `bestLevelForCap` against the **evolved** species' base stats (labeled `→ Great` / `→ Ultra`) rather than the stage's own — the stage's own crossing point is usually never reached anyway (Chansey's own CP tops out around 1,435, under the Great League cap), so showing it would be static and useless. Level is a shared axis independent of species, so "the level at which evolving would cross 1500" plots correctly on the pre-evolution's own track. A stage with no further evolution (or a fully unevolving species) falls back to marking its own crossing, unchanged from v2.

This directly answers the original ask — "if I'm a level XX Chansey and if I evolve to Blissey, the boundary needs to be shown" — on Chansey's own card, without navigating anywhere first. The `‹`/`›` step buttons (§15) were kept as-is rather than redesigned: once the chain stopped collapsing, they already behaved as the "de-evolve toggle" that was asked for; the actual gap was the missing card, not the icon.
