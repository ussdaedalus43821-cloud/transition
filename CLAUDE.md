# CLAUDE.md

## Project

Transition is a facility electrification / solar-EV fleet transition
simulation: a monthly-tick, objectives-driven teaching tool showing why a
real facility's solar-plus-EV-fleet transition takes years to decades
rather than happening overnight — interconnection queues, construction
lead times, financing gates, and policy deadlines all impose real delays
cash alone can't buy down. It's built around a **swappable-facility-data
principle**: one `FacilityProfile` type (location, electrical service,
fleet, financing, environment, energy) fully describes a facility, and
every mechanic reads from that data rather than hardcoded per-facility-type
logic. Two presets exist (School Bus Depot, Tank Wash) specifically to
prove this generalizes, not because the sim is scoped to only these two.

## Architecture rules

Reconstructed from the code as it stands — constraints it actually
follows, not aspirational ones.

- **Data-driven presets, no shared globals.** `createNewGame(preset)`
  clones the given `FacilityProfile` (never shared by reference); every
  mechanic reads from `state.facility`/`state.sim`. This was previously
  violated (every preset shared a few global cost constants) and fixed as
  a bug, not a refactor — see `constants.ts`'s "audit finding #1" notes.
- **Real lead times, deliberately not reducible by cash.** Every
  `CommittedAction` has a `monthsOriginal`/`monthsRemaining` the player
  can't skip regardless of budget — `SERVICE_UPGRADE_MONTHS`'s own comment
  states this as the point, not a limitation to fix.
- **Costs draw on a schedule, reservations claimed at commit time.**
  `CostDraw`s fire on `monthsElapsed >= draw.month && !draw.paid` (not
  exact equality, so a delay event can't skip or double-fire one); shared
  capacity pools (`reservedInterconnectionKW`, `reservedChargerCapacityKW`,
  grant funding) are claimed the moment an action is committed, not on
  completion — closes a race between two simultaneously-pending actions.
- **DSCR gates new debt, not existing debt.** `computeDebtFinancingProjection`/
  `refinanceLoan` refuse below `DSCR_MINIMUM_FOR_NEW_DEBT` (1.25), using
  `computeMonthlyOperatingCashFlow` as the shared numerator — explicitly
  documented as a simplified cash-flow proxy, not real NOI.
- **Derived aggregates are computed, not separately tracked.** `SimState.
  debt`/`totalMonthlyDebtService` are getters over `activeLoans`, replacing
  an earlier design that let the two drift out of sync.
- **No RNG seeding or deterministic-replay discipline.** `rollEvents()`
  calls `Math.random()` directly throughout. Unlike ev-thermal-sim's
  fork-safe, seeded `SimState`, nothing here supports save/load, replay,
  or reproducing a specific run — a real architectural difference from
  that project.
- **Every unresearched number says so, consistently, though no written
  rule requires it.** Nearly every constant in `constants.ts` is commented
  "placeholder pending real X data" where unresearched, and several
  (electricity rates, EPA program figures, inverter lifespan) cite real
  external research directly. Worth continuing deliberately.

## Coding standards

- TypeScript 5.5+ (`package.json`'s only dependency), `strict: true`,
  target ES2020, ESM. No bundler — plain `tsc` build, served via
  `http-server`.
- **No dependencies are actually installed** — no lockfile, no
  `node_modules/` in this checkout.
- **No test framework, no lint/format tooling configured** — no test
  script or files, no Jest/Vitest/ESLint/Prettier config. Real gaps, not
  implied conventions.
- Comment style already matches ev-thermal-sim's discipline without a
  written rule requiring it: short "why," not "what," notes; every design
  tradeoff and known gap flagged inline. Continue this pattern.

## Design protocol

- Read `docs/DESIGN_QUESTIONS.md` at the start of every session.
- Before non-trivial changes, check whether the task's ambiguities are
  already logged there.
- If a decision is needed and isn't already answered, do NOT decide
  silently — append it to `docs/DESIGN_QUESTIONS.md` as a new `Q-NNNN`
  entry, following the format in that file's header.
- When a question is answered/ratified, fold the resolution into this
  file's "Known deferred work" log below, and mark the corresponding
  entry resolved in `docs/DESIGN_QUESTIONS.md`.
- Escalation bar — escalate only when a decision (a) changes a schema
  field's meaning or a module boundary, (b) determines a number that gets
  committed to the record, or (c) would be expensive to reverse later.
  Everything else: decide, document the reasoning in the commit message,
  and proceed.

## Known deferred work

Found by reading the code for TODOs, scaffolded-but-unused fields, and
documented placeholders — not exhaustive, prioritized toward what
ev-thermal-sim's seam reconnaissance already flagged as load-bearing.

- **No battery-degradation model exists.** The nearest thing,
  `ev_drivetrain_failure`, is a flat per-vehicle-per-month Bernoulli roll
  jumping 6x after a fixed 96-month warranty boundary — no dependency on
  temperature, climate, duty cycle, or charging pattern. A discrete
  reliability-event placeholder, not a degradation state. This is the
  whole reason the ev-thermal-sim seam exists.
- **`ClimateZone`'s new temperature fields** (`meanAnnualTempF`/
  `seasonalAmplitudeF`/`dailyAmplitudeF`, added for the seam's gap-3
  closure) **are real data but not yet consumed by any mechanic** — same
  status `solarYieldFactor`/`targetElectrificationRateByYear20` already have.
- **`Route` has no duty-cycle detail beyond `dailyMiles`/
  `dedicatedVehicleCount`** — no speed profile, stop frequency, or
  charging pattern. `Route.evViable` is fixed preset data nothing at
  runtime ever flips.
- **Debt service is never actually drawn from cash**, though DSCR gates
  new borrowing using that same never-drawn number — a real, load-bearing
  inconsistency, not just an unbuilt feature.
- **No persistence** — `markDirty` in `main.ts` is a literal `() => {}`.
- **No net-metering sellback** — excess solar generation is simply unused.
- **The EPA Clean School Bus grant program is reused verbatim for Tank
  Wash**, an already-flagged factual mismatch (a private trucking company
  wouldn't qualify) — kept as directed rather than researched.
- **Only insolvency is wired to `gameOverReason`.** DSCR breach and a
  sustained uptime floor were both part of the original failure-threshold
  design but have no hard-failure consequence built.
- **No tests anywhere**, for a simulator whose correctness (reservation
  math, DSCR gating, cost-draw scheduling) is entirely arithmetic and easy
  to silently regress.
- **Only one UI tab exists** (`Overview`) — Electrical/Fleet/Finance/
  Incentives are named as later passes but don't exist.
- **No battery storage or backup generation**, so `short_outage`/
  `extended_outage` apply their full effect with zero mitigation, by
  explicit design-for-now.
- **Scaffolded but unused**: `VehicleClass.replacementCycleYears` (every
  conversion is full-price regardless of vehicle age) and
  `Bay.powerDrawKWPlaceholder` (charger siting isn't wired to bays).
