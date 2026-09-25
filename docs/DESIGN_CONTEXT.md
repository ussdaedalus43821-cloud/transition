# Design Context

One-page orientation for this repo. See `CLAUDE.md` for the rules; this is
the map.

## What this system is

Transition simulates a facility (a school bus depot, a food-grade tank
wash) deciding, month by month over a 20-year horizon, how to electrify
its vehicle fleet and add solar generation — while real interconnection
queues, construction lead times, financing constraints, and policy
deadlines gate how fast any of it can actually happen. The player commits
to actions (solar install, service upgrade, charger install, route
conversion, an interconnection study), each with a real lead time and a
staged cost schedule; a monthly tick advances every pending commitment,
settles cash, rolls random events, and checks two hard-failure conditions
(insolvency; a year-20 outcome tier). It's explicitly NOT hardcoded to one
facility type — `FacilityProfile` is the single swappable description of
"what this facility is," and every mechanic reads from it.

## Architecture at a glance

```
main.ts (boot, preset select, rAF game loop)
  -> state.ts: createNewGame(preset) -> GameState
  -> engine/engine.ts: advanceOneMonth(state), called every tick
       1. advance pending CommittedActions, fire due cost draws
       2. apply effects of anything that just completed
          (capacity/headroom/route-converted/electrificationRate)
       3. settle placeholder monthly opex, recompute DSCR
       4. rollEvents(state) — the ~19-entry random EVENT_TABLE
       5. insolvency check (3 consecutive negative-cash months)
       6. at month=1/year=YEARS_TO_EVALUATE: evaluateFinalOutcome()
  -> ui/app.ts: render() does a full innerHTML replace every tick/action;
       two delegated listeners (click, change) dispatch by a
       `data-action="tab:verb"` attribute convention
```

There is no separate "simulation core" the UI merely displays — `engine.ts`
computes state directly, and `overviewTab.ts` calls its exported functions
(`compute*Projection`, `commitTo*`) directly. Nothing here is async; a
whole tick is synchronous.

## Module map

| File | Role |
|---|---|
| `src/types.ts` | Every domain type: `FacilityProfile`, `SimState`, `GameState`, `CommittedAction`, `EventType`, etc. Start here to learn the schema. |
| `src/constants.ts` | Both facility presets (`SCHOOL_BUS_DEPOT_PRESET`, `TANK_WASH_PRESET`), `EVENT_TABLE`, and every tunable constant — almost all commented with real-vs-placeholder provenance. |
| `src/state.ts` | `createNewGame(preset)` — the one place a fresh `GameState` is built. |
| `src/engine/clock.ts` | Month/year ordinal arithmetic (`monthOrdinal`, `dateFromOrdinal`, `formatDate`). |
| `src/engine/engine.ts` | All mechanics: `commitTo*` (action-commit functions), `compute*Projection`/`compute*Sizing` (pure projections the UI previews before committing), `rollEvents`, `advanceOneMonth`, `evaluateFinalOutcome`, `cancelPendingAction`. The load-bearing file. |
| `src/main.ts` | Preset-selection screen, then the `requestAnimationFrame` clock that calls `advanceOneMonth` at a speed-controlled cadence. |
| `src/ui/app.ts` | Top-level render + the tab framework + global action dispatch (speed, tab switching). |
| `src/ui/overviewTab.ts` | The one built tab — gauges, pending commitments, every commit-action UI, route conversion panel, active loans, maintenance strategy. |
| `src/ui/format.ts` | `money`/`pct`/`gauge`/`escapeHtml` presentation helpers. |
| `src/ui/types.ts` | `AppCtx`, `TabModule` — the interface a new tab module implements. |
| `styles/main.css` | All styling; `--good`/`--warn`/`--bad`/`--info`/`--accent` CSS custom properties drive gauge/banner tone. |

## Open questions

None logged in `docs/DESIGN_QUESTIONS.md` yet — this bootstrap pass was
documentation-only, so nothing here required a design decision. The most
likely near-term source of new `Q-NNNN` entries is the ev-thermal-sim seam
work (see that repo's `docs/seam_reconnaissance.md`): wiring a real
battery-degradation signal into this fleet almost certainly touches
`VehicleClass` (a vehicle-class key to join against an ev-thermal-sim
`ManufacturerProfile`), `Route` (duty-cycle detail beyond `dailyMiles`),
and how a precomputed SOH-delta table's consequence should actually show
up here (an `ev_drivetrain_failure`-style cash event? a range-derating
effect? both?) — none of which is decided yet.
