// ---------------------------------------------------------------------------
// Transition — core domain types
// ---------------------------------------------------------------------------
// This is a skeleton pass: the shapes here are deliberately generic so later
// phases (the event table, objective thresholds, early-retirement cost math,
// leasing/financing) can slot in without reworking the base schema. Solar
// sizing, interconnection/charger capacity pools, and route-miles-based
// electrification are real as of Phase 3 — see engine/engine.ts.

export type ClockSpeed = 0 | 1 | 4 | 15;

/**
 * "food_grade_tank_wash" added in the second-preset pass, specifically to
 * prove FacilityProfile generalizes beyond a single facility type — see
 * TANK_WASH_PRESET in constants.ts. More facility types land in later passes.
 */
export type FacilityType = "school_bus_depot" | "food_grade_tank_wash";

export type PhaseType = "single_phase" | "three_phase";

export type NetMeteringPolicy = "full" | "partial" | "none";

export interface Bay {
  id: string;
  label: string;
  hasCharger: boolean;
  /** Optional — bays aren't read by any mechanics this pass (charger sizing/siting isn't wired to individual bays yet), so this is pure descriptive data. Added for TANK_WASH_PRESET's liquid-sweetener-vs-pneumatic bay distinction; the bus depot preset's bays don't set it. Placeholder pending real facility power-draw data wherever it's set. */
  powerDrawKWPlaceholder?: number;
}

export type FuelType = "diesel" | "electric"; // more fuel types land in a later pass if a non-bus preset needs them

export interface VehicleClass {
  class: string; // e.g. "school_bus"
  count: number;
  avgAnnualMileage: number;
  currentFuelType: FuelType;
  /** Placeholder pending real fleet-management replacement-cycle data. Not used by any cost math this pass — routeConversion treats replacement-cycle timing as irrelevant for now (existing buses always convert at full new-vehicle cost, no early-retirement discount/penalty), a deliberate simplification, not an oversight. */
  replacementCycleYears: number;
  /**
   * Key into ev-thermal-sim's seamTable.ts SEAM_TABLE_ROWS.vehicleClass —
   * links this fleet's vehicles to a real manufacturer thermal/aging
   * profile, when one exists. Undefined means no seam-table row exists for
   * this vehicle class yet, so Route.batterySohPercent tracking is skipped
   * for every route in this fleet. Routes don't carry their own vehicle-
   * class reference (this schema's fleet.vehicleClasses and fleet.routes
   * are separate sibling arrays), so the engine looks this up from
   * fleet.vehicleClasses[0] for every route — a v1 simplification that
   * holds only because every preset so far has exactly one VehicleClass; a
   * multi-class fleet would need routes to reference their class directly.
   */
  manufacturerProfileKey?: string;
}

export interface Route {
  id: string;
  label: string;
  dailyMiles: number;
  dedicatedVehicleCount: number;
  evViable: boolean;
  /** Set true once a completed routeConversion has electrified this route's dedicated vehicles. */
  converted: boolean;
  /** monthOrdinal() at the moment this route's routeConversion completed; null while converted is false. Same "set at completion, derive months-since by subtraction" pattern as SimState.solarCompletionOrdinal (4.6) — feeds ev_drivetrain_failure's warranty-window check. */
  conversionCompletionOrdinal: number | null;
  /**
   * Battery state-of-health (0-100), tracked once this route is converted by
   * looking up ev-thermal-sim's seamTable.ts SEAM_TABLE_ROWS via the
   * fleet's VehicleClass.manufacturerProfileKey and decrementing from that
   * row's monthlySohDeltaPct each month since conversionCompletionOrdinal
   * (see rollEvents() in engine.ts, alongside the ev_drivetrain_failure
   * months-since-conversion computation it already does). null before
   * conversion, or permanently, if the fleet's vehicle class has no
   * manufacturerProfileKey. Track-only for now, no gameplay/cash/uptime
   * consequence wired to this value yet — a deliberate first pass so the
   * seam's data actually flows before any consequence is designed on top
   * of it.
   */
  batterySohPercent: number | null;
}

export interface IncentiveProgram {
  key: string;
  name: string;
  description: string;
  valueEstimate: number;
  /**
   * Dollar cap on grant coverage per bus (covers both the bus and its
   * charging infrastructure cost, per the real program's structure) —
   * replaces an earlier flat-percentage-of-total-cost model, which research
   * showed doesn't match how the program actually pays out. Per-route grant
   * amount = min(grantAmountPerBusCap, cost per bus) × vehicle count, capped
   * again by whatever remains in totalGrantFundingAvailable below.
   * Placeholder current-best-estimate (real awards have historically ranged
   * ~$325k-$375k/bus depending on funding round) — NOT a stable long-term
   * constant: the EPA Clean School Bus Program underwent a major structural
   * overhaul in February 2026 (competitive scoring replacing automatic
   * rebates, funding now shared across multiple clean-fuel types with only a
   * 50% zero-emission minimum across the whole program) and remains under
   * political review as of this writing. Distinct from valueEstimate above,
   * which is left as a separate, smaller base/infrastructure rebate figure.
   */
  grantAmountPerBusCap: number;
  /** Remaining program funding available to award, in dollars — depletes as routeConversion grants are awarded (reserved at commit time, same as the interconnection/charger capacity pools). Placeholder pending real program funding/allocation data; deliberately finite and modest — this unlocks a first conversion or two, not the whole fleet. */
  totalGrantFundingAvailable: number;
  /** Months between application and a guaranteed award, if pool room remains. Placeholder pending real program timeline research. Real programs carry competitive rejection risk this pass deliberately ignores — see commitToRouteConversion's grant branch for how that simplification is applied. */
  applicationDecisionMonths: number;
}

export interface LoanTerm {
  key: string;
  label: string;
  termMonths: number;
  apr: number;
  maxAmount: number;
}

/**
 * One originated loan, tracked individually since Phase 4.11 (loan
 * refinancing) — refinancing targets one specific loan, which the earlier
 * aggregate-scalar debt model (SimState.debt/totalMonthlyDebtService as
 * plain running totals) couldn't represent. remainingPrincipal is set at
 * origination and only ever reduced by a future payoff/amortization pass —
 * see refinanceLoan()'s doc comment for why it's untouched by a refinance
 * itself (rate-and-term only, not cash-out). No amortization schedule
 * exists yet (a known simplification carried over from the original debt
 * model, not fixed by this pass): remainingPrincipal does not decline
 * month to month as payments are made.
 */
export interface ActiveLoan {
  id: string;
  remainingPrincipal: number;
  apr: number;
  termMonths: number;
  monthlyPayment: number;
  /** Month-ordinal (see monthOrdinal() in engine/clock.ts) this loan's CURRENT terms began — the original origination month, or the month of its most recent refinance if refinanced since (a refinance resets this, since it produces a fresh amortization schedule). */
  originatedAtMonth: number;
  /** Principal at origination, before any future payoff — kept alongside remainingPrincipal so the UI/history can still show "borrowed $X" even once a payoff mechanic exists. Never changed by a refinance. */
  originalPrincipal: number;
  /** Which route conversion created this loan — the only debt-origination path this pass supports. */
  sourceRouteId: string;
}

export interface ClimateZone {
  key: string;
  label: string;
  /** Placeholder annual generation yield, kWh produced per installed kW per year — not real climate data. */
  solarYieldFactor: number;
  /**
   * Real NOAA 1991-2020 climate normals for this facility's location — unlike
   * solarYieldFactor above, these three fields are NOT placeholders. Stored in
   * Fahrenheit (matching the source data and this sim's US-facility audience)
   * rather than the kelvin the ev-thermal-sim seam's own Climate schema uses
   * internally — added specifically to close that seam's "no temperature
   * data" gap (see ev-thermal-sim's docs/seam_reconnaissance.md §6), not yet
   * consumed by any mechanics here. Convert at the seam boundary, not here:
   * meanAnnualTempK = (meanAnnualTempF - 32) * 5/9 + 273.15; a Fahrenheit
   * DIFFERENCE (the two amplitude fields) converts to kelvin by multiplying
   * by 5/9 only (no offset — a temperature difference, not an absolute).
   */
  meanAnnualTempF: number;
  /** Half the peak-to-trough swing across the year: (hottest month's average - coldest month's average) / 2, from monthly normals. Matches ev-thermal-sim's Climate.seasonal_amplitude_k semantics (the amplitude of an annual cosine, i.e. the peak deviation from the mean, not an average). */
  seasonalAmplitudeF: number;
  /** Half the average monthly high-low spread, averaged across all 12 months (not the single most extreme month) — a representative typical-day swing, since ev-thermal-sim's diurnal cosine applies one fixed daily_amplitude_k uniformly across the whole year rather than varying it month to month. Matches Climate.daily_amplitude_k semantics. */
  dailyAmplitudeF: number;
  /**
   * Real facility elevation, in feet (matching this file's Fahrenheit/
   * imperial convention — convert at the seam boundary: altitudeM =
   * altitudeFt * 0.3048). Closes the second of two residual gaps
   * ev-thermal-sim's seam_reconnaissance.md §7 found after the three
   * temperature fields above (gap 3) were closed: a real Scenario for the
   * seam couldn't be built without this and solarIrradianceWPerM2 below,
   * even though gap 3 itself was done. A trivial per-location lookup, not
   * placeholder data.
   */
  altitudeFt: number;
  /**
   * Placeholder peak solar irradiance, in W/m^2 — matches ev-thermal-sim's
   * Climate.solar_irradiance_w_per_m2 (a real field used for cabin heat-gain
   * modeling), NOT the same quantity as solarYieldFactor above (an annual
   * generation-yield figure for solar-array sizing). A generic placeholder
   * is sufficient for a first version (every ev-thermal-sim reference
   * profile already uses one too), per seam_reconnaissance.md §7.
   */
  solarIrradianceWPerM2: number;
}

export interface FacilityProfile {
  name: string;
  facilityType: FacilityType;
  location: {
    state: string;
    utility: string;
    climateZone: ClimateZone;
  };
  electrical: {
    serviceVoltage: number;
    serviceAmps: number;
    phaseType: PhaseType;
    /** Fraction (0-1) of nameplate service capacity (serviceAmps × serviceVoltage) available for new interconnected generation before a service upgrade is required — a simplified stand-in for a real utility interconnection study (e.g. the common "15% of service rating" fast-track screening rule), not an actual study result. */
    interconnectionHeadroom: number;
  };
  site: {
    roofSqFt: number;
    bays: Bay[];
  };
  fleet: {
    totalVehicles: number;
    vehicleClasses: VehicleClass[];
    routes: Route[];
    /**
     * Per-vehicle economics used by routeConversion cost math and the
     * events that adjust it (ev_price_decline, diesel savings via
     * equipment_failure_diesel's theme, charging-capacity sizing). Added to
     * fix audit finding #1 from the preset-generalization pass: these three
     * figures used to be bare global constants shared by every preset,
     * meaning Tank Wash's trucks priced identically to school buses. Each
     * preset now owns its own values — see SCHOOL_BUS_DEPOT_PRESET (same
     * numbers as before, just relocated) and TANK_WASH_PRESET (distinct,
     * research-grounded truck figures) in constants.ts for the specific
     * placeholder provenance comments.
     */
    vehicleEconomics: {
      costPerVehiclePlaceholder: number;
      dieselSavingsPerVehicleMonthlyPlaceholder: number;
      chargingDemandPerVehicleKWPlaceholder: number;
    };
  };
  environment: {
    federalITCRate: number; // 0-1
    incentivePrograms: IncentiveProgram[];
    netMeteringPolicy: NetMeteringPolicy;
    interconnectionQueueMonths: number; // utility's current quoted wait, informational until the study action reads it
    /**
     * 0-1 fraction — this facility's own target electrificationRate at year
     * YEARS_TO_EVALUATE, set per-preset because route economics (and
     * therefore how much of a fleet can realistically go electric) differ by
     * facility type. Added in the second-preset pass as DATA ONLY: it is
     * NOT YET read by evaluateFinalOutcome(), which still uses the global
     * OBJECTIVE_TIER_SUCCESSFUL_MIN constant (0.6) for every preset — a
     * known gap, flagged rather than fixed, since wiring it in would mean
     * changing evaluateFinalOutcome's mechanics, out of scope for a
     * structural pass. School Bus Depot's value here (0.6) documents its
     * existing implicit floor for consistency; it changes nothing until a
     * future pass reads this field instead of the constant.
     */
    targetElectrificationRateByYear20: number;
  };
  energy: {
    annualFacilityLoadKWh: number; // placeholder — real utility-bill-derived load data comes later
    /** 1.0 = size solar to fully offset current annual use. Deliberately kept separate from any future growth-headroom multiplier rather than folded into one combined factor. */
    targetOffsetFraction: number;
  };
  finance: {
    availableCapital: number;
    creditRating: string;
    loanTermsAvailable: LoanTerm[];
  };
  /**
   * Facility-wide (not per-vehicle) operating figures — moved off global
   * constants for the same reason as fleet.vehicleEconomics above: a tank
   * wash's industrial wash-bay power draw and its utility's actual
   * commercial rate plausibly differ a lot from a school bus depot's.
   */
  operatingBaseline: {
    monthlyOpexPlaceholder: number;
    electricityRatePerKWhPlaceholder: number;
  };
}

// The union is here so later phases extend it in one place.
export type CommittedActionType = "interconnection_study" | "solarInstall" | "serviceUpgrade" | "chargerInstall" | "routeConversion";

/**
 * The union is here so later sub-passes extend it in one place, same pattern
 * as CommittedActionType above. Phase 4.1 proved the mechanism with the first
 * two entries; Phase 4.2 added two market events and one simplified grid
 * event; Phase 4.3 added two regulatory events; Phase 4.4 added two
 * opportunity events; Phase 4.5 added one more market event and one
 * equipment event; Phase 4.6 added one more equipment event and one more
 * regulatory event; Phase 4.7 added one more equipment event and one more
 * grid event; Phase 4.8 added one more equipment event; a later pass added
 * "maintenance_strategy_changed" and this pass added short_outage/
 * extended_outage, unblocked by real uptime tracking (4.9/4.10). All chosen
 * specifically because they don't require battery storage, load management,
 * or training-lag systems (none of which exist in the sim yet).
 * "maintenance_strategy_changed" is a special case — a plain record of the
 * PLAYER's own decision, not something rollEvents() ever rolls or that
 * EVENT_TABLE needs an entry for; it reuses eventLog purely for consistency
 * with how every other consequential choice is tracked. Deferred
 * maintenance raising equipment-failure odds is now built, but fleet-only —
 * see that field's doc comment; charger_hardware_failure/inverter_failure/
 * panel_underperformance still have no maintenance lever, since
 * facility/equipment maintenance is a separate decision from fleet
 * maintenance. short_outage/extended_outage apply their full effect with no
 * mitigation — no battery storage or backup generator system exists yet;
 * either, if ever built, would reduce these events' impact. Still unbuilt:
 * curtailment (needs net metering), driver_turnover/
 * customer_contract_renewal_pressure and other operational-category events
 * (need training-lag and uptime systems), any PERMANENT generation
 * degradation and battery degradation (no battery storage system exists),
 * any capacity-loss mechanic, any windowed/time-limited discount mechanic,
 * severity tiers, seasonality weighting (no event uses it yet, kept
 * consistent), and further state-dependent probability modifiers beyond
 * what's built.
 */
export type EventType =
  | "diesel_price_shock"
  | "equipment_failure_diesel"
  | "electricity_rate_increase"
  | "interest_rate_movement"
  | "demand_spike_billing"
  | "incentive_program_closes_early"
  | "permitting_delay"
  | "utility_pilot_program"
  | "grant_bulk_purchase_opportunity"
  | "ev_price_decline"
  | "charger_hardware_failure"
  | "inverter_failure"
  | "grant_program_funding_cut"
  | "panel_underperformance"
  | "power_quality_issue"
  | "ev_drivetrain_failure"
  | "maintenance_strategy_changed"
  | "short_outage"
  | "extended_outage";

export interface EventTableEntry {
  type: EventType;
  label: string;
  /** 0-1 chance rolled once per tick (diesel_price_shock) or once per eligible vehicle class per tick (equipment_failure_diesel) — see rollEvents() in engine.ts for exactly how each is rolled. Placeholder magnitude pending the fuller event-table research pass. */
  baseMonthlyProbability: number;
  description: string;
}

/** One fired occurrence, as recorded in SimState.eventLog. `effect` is the specific, already-resolved outcome (exact numbers), distinct from EventTableEntry.description, which is the generic table entry text. */
export interface SimEventLogEntry {
  month: number;
  year: number;
  type: EventType;
  effect: string;
}

/**
 * The tiered outcome from the original failure-thresholds planning.
 * "unsuccessful" covers both "electrificationRate never cleared 60%" and
 * "the rate cleared 60% but a secondary condition failed" — see
 * evaluateFinalOutcome() in engine.ts for why those two cases collapse into
 * the same tier (you can't hit the target by wrecking the business).
 */
export type ObjectiveTier = "unsuccessful" | "successful" | "strong" | "exceptional";

/** Which secondary condition failed, when conditionsMet is false; null when conditionsMet is true, or when conditionsMet is true but electrificationRate alone still put the run in "unsuccessful". */
export type FailedSecondaryCondition = "insolvent" | "dscr_breach" | "uptime_floor" | null;

/** SimState.finalOutcome's shape — set once at year YEARS_TO_EVALUATE, never recomputed. See that field's doc comment. */
export interface FinalOutcome {
  tier: ObjectiveTier;
  electrificationRate: number;
  year: number;
  conditionsMet: boolean;
  failedCondition: FailedSecondaryCondition;
}

export type ChargerType = "L2" | "DCFC";

export type FinancingType = "cash" | "debt" | "grant";

export interface CostDraw {
  /** Months elapsed into the action (0 = the month it was committed) when this draw is due. */
  month: number;
  amount: number;
  /**
   * True once this draw has fired. The tick loop fires a draw when
   * monthsElapsed >= month AND paid is false, setting this to true in the
   * same step as applying the cash effect — this is what makes a draw safe
   * to check idempotently instead of relying on monthsElapsed hitting month
   * via exact equality on exactly one tick. That equality assumption breaks
   * once anything (permitting_delay today; any hypothetical future
   * "expedite" mechanic) can move monthsRemaining without moving
   * monthsOriginal, letting monthsElapsed count backward and re-cross an
   * already-fired draw's month. Always starts false at construction.
   */
  paid: boolean;
}

export interface CommittedAction {
  id: string;
  type: CommittedActionType;
  label: string;
  monthsRemaining: number;
  monthsOriginal: number;
  /** Draws still to be applied by the tick loop — the month-0 mobilization draw is charged immediately at commit time and isn't in this list. */
  costSchedule: CostDraw[];
  /** Other action types that must NOT be pending for this one to be committed. Empty for now — no cross-action gating exists yet. */
  blockedBy: CommittedActionType[];
  /** kW added to SimState.solarCapacityKW once this action completes; 0 for actions that don't touch solar capacity. */
  onCompleteSolarCapacityKW: number;
  /** kW added to SimState.installedChargerKW once this action completes — physical charger hardware built; 0 for actions other than chargerInstall. Distinct from reservedInterconnectionKWOnCommit, which tracks the same install's draw on the *electrical service*, not on charger hardware available to plug vehicles into. */
  onCompleteChargerCapacityKW: number;
  /**
   * kW reserved from SimState.reservedChargerCapacityKW the moment this
   * action is COMMITTED, not when it completes — 0 for actions other than
   * routeConversion. Reserving this early closes a race where two pending
   * actions could each pass their own capacity-gate check against the same
   * still-unclaimed capacity. Completion leaves the reservation in place
   * as the new permanent baseline (it does not add to the pool again).
   * Kept on the action so cancelPendingAction() can release exactly this
   * much back if it's ever abandoned before completing.
   */
  reservedChargerCapacityKWOnCommit: number;
  /** The route this action converts, for routeConversion; "" for every other action type. */
  targetRouteId: string;
  /** Same commit-time reservation pattern as reservedChargerCapacityKWOnCommit, but against SimState.reservedInterconnectionKW — the shared interconnection pool that solar and chargers now compete for; 0 for actions that don't consume interconnection capacity (e.g. serviceUpgrade, which expands the pool instead). */
  reservedInterconnectionKWOnCommit: number;
  /** Dollars reserved from the EPA grant program's totalGrantFundingAvailable at commit time — same reservation-at-commit pattern as the capacity pools above, so cancelPendingAction() can release it correctly. 0 for every action except a grant-financed routeConversion. */
  reservedGrantFundingOnCommit: number;
  /** Multiplies facility.electrical.interconnectionHeadroom once this action completes; 1 (no-op) for every action except serviceUpgrade. */
  onCompleteInterconnectionHeadroomMultiplier: number;
  /** True if this commit included the "install extra conduit capacity" over-provisioning choice; false for action types that don't offer it. */
  installsSpareConduit: boolean;
  /** kW added to SimState.spareConduitCapacityKW once this action completes; 0 unless installsSpareConduit is true. */
  spareConduitCapacityKWOnComplete: number;
  /** System size frozen at commit time, for display while pending; 0 for actions with no associated array size. */
  sizedKW: number;
  /** Federal ITC rate (0-1) locked in for this commitment at commit time; 0 for actions the ITC doesn't apply to. */
  itcRateApplied: number;
}

export interface SimState {
  month: number; // 1-12
  year: number;
  cash: number;
  /** Every originated loan this game, tracked individually since Phase 4.11 so a refinance can target one specific loan. Only routeConversion originates debt this pass (see commitToRouteConversion's debt branch); refinanceLoan() mutates an existing entry in place rather than adding/removing one. */
  activeLoans: ActiveLoan[];
  /** DERIVED — sum of remainingPrincipal across activeLoans, computed fresh via a getter (see state.ts's createNewGame) every time this is read, never a separately-maintained running total. This is deliberate: Phase 4.2 found "no per-loan record was needed" and kept debt as a plain incremented scalar, but that let this field and activeLoans drift out of sync in principle even though nothing exploited it before refinancing existed. readonly — assigning to it directly will throw (it has no setter); originate debt by pushing onto activeLoans instead. */
  readonly debt: number;
  /** DERIVED — sum of monthlyPayment across activeLoans, same getter treatment and same reasoning as debt above. 0 means no debt exists — computeDSCR() returns null (not 0 or Infinity) in that case. readonly, same as debt. */
  readonly totalMonthlyDebtService: number;
  /** Real DSCR = monthlyOperatingCashFlow / totalMonthlyDebtService, recomputed every tick by computeDSCR(); null ("N/A") when totalMonthlyDebtService is 0 rather than a divide-by-zero or misleading number. */
  dscr: number | null;
  /** 0-1. Real route-miles-weighted figure: sum(dailyMiles × dedicatedVehicleCount) over converted routes, divided by the same sum over every route. Recomputed by recomputeElectrificationRate() whenever a routeConversion completes — never incremented by a flat per-action bump. */
  electrificationRate: number;
  /** This month's fleet uptime, 0-100 — a per-month value, NOT cumulative decay. Recomputed every tick from how many vehicle-failure events (equipment_failure_diesel, ev_drivetrain_failure) fired that same tick; a month with zero such failures reads 100. See rollEvents() in engine.ts. No failure/game-over threshold is wired to this yet — that's deliberately deferred, same pattern as insolvency detection (3.8) preceding its own consequences. */
  uptimePercent: number;
  /** One entry appended per tick, in order, holding that month's uptimePercent — feeds computeTrailingUptimeAverage(). Capped at UPTIME_HISTORY_MAX_ENTRIES (oldest entries drop off) so a 20-year run doesn't grow this unbounded. */
  uptimeHistory: number[];
  /** Trailing 3-month average of uptimeHistory, recomputed every tick via computeTrailingUptimeAverage() right after uptimeHistory updates. 100 on a fresh game (empty history) — matches the "zero failures" baseline the instantaneous value also starts at. */
  trailingUptimeAverage: number;
  /** Purely informational status derived from trailingUptimeAverage — "warning" below 90, "poor" below 85, "normal" otherwise. No cash, cancellation, or gameOverReason consequence tied to this yet: the original failure-threshold design paired "poor" with losing a customer contract, but that consequence assumes a commercial/contracted operator (a freight carrier, a parcel depot) and has no clean analog for a municipal district running its own fleet — deferred until a preset exists where it fits. */
  uptimeWarningLevel: "normal" | "warning" | "poor";
  /**
   * "reactive" (default, preserves pre-existing behavior exactly) or
   * "preventative" — an ongoing operating posture the player can switch at
   * any time, no lead time or commitment queue (unlike every other
   * decision in this sim, which goes through CommittedAction). While
   * "preventative": computeMonthlyOperatingCashFlow adds
   * MAINTENANCE_PROGRAM_COST_PER_VEHICLE × fleet.totalVehicles to monthly
   * opex, and rollEvents multiplies equipment_failure_diesel's and
   * ev_drivetrain_failure's effective probability by
   * FLEET_MAINTENANCE_PREVENTATIVE_FAILURE_MULTIPLIER. Fleet-only —
   * charger_hardware_failure, inverter_failure, and panel_underperformance
   * are untouched, since facility/equipment maintenance is a conceptually
   * separate decision, deferred to a future pass.
   */
  maintenanceStrategy: "reactive" | "preventative";
  /**
   * Set exactly once, at the year-YEARS_TO_EVALUATE annual checkpoint, and
   * never recomputed after — the game's single, final outcome evaluation.
   * null until then. This is a natural endpoint, not a failure, which is
   * why it's a distinct field rather than overloading gameOverReason —
   * advanceOneMonth() still refuses to advance any further month once it's
   * set, same halt pattern as gameOverReason. The customer-contract
   * consequence from the original design is NOT wired to this — deferred,
   * same reasoning as uptimeWarningLevel above.
   */
  finalOutcome: FinalOutcome | null;
  solarCapacityKW: number; // installed/operational solar capacity, 0 until a solarInstall action completes
  /** Shared, depleting pool: kW of interconnection headroom already claimed by completed solar/charger installs. Solar sizing and charger commits must both check against (interconnectionHeadroomKW - reservedInterconnectionKW), never the raw headroom value. */
  reservedInterconnectionKW: number;
  hasSpareConduit: boolean;
  /** Spare conduit capacity banked from over-provisioned charger installs — stored only; Phase 3 wires the actual discount/penalty logic against future charger expansions. */
  spareConduitCapacityKW: number;
  /** Total physical charger capacity built via completed chargerInstall actions. */
  installedChargerKW: number;
  /** Shared, depleting pool: kW of installedChargerKW already committed to specific vehicles via a completed routeConversion. Available charger capacity for a new conversion = installedChargerKW - reservedChargerCapacityKW. */
  reservedChargerCapacityKW: number;
  pendingActions: CommittedAction[];
  /** Number of consecutive completed ticks (so far) where cash ended the month negative. Reset to 0 the moment cash ends a tick at or above zero. Drives the insolvency hard-failure check — see INSOLVENCY_THRESHOLD_MONTHS in constants.ts. */
  consecutiveNegativeCashMonths: number;
  /** Set once a hard-failure condition is met; null while the game is still playable. Only "insolvency" exists this pass — DSCR-breach and uptime-based failure are separate future passes. Once set, advanceOneMonth() refuses to advance any further month. */
  gameOverReason: "insolvency" | null;
  /** Multiplier applied to diesel-related cost math once a later pass wires it in — 1.0 = no adjustment. Moved by the diesel_price_shock event. Deliberately NOT yet consumed by computeMonthlyOperatingCashFlow's diesel-savings math this pass — wiring it in would change DSCR, which this pass is scoped to leave untouched; that connection is a follow-up once the event engine itself is proven. */
  dieselPriceMultiplier: number;
  /** Every event that has fired, oldest first. Proof-of-mechanism logging only — queryable, but no history UI panel yet beyond the single most-recent-event line on the Overview tab. */
  eventLog: SimEventLogEntry[];
  /** $/kWh used by computeMonthlyOperatingCashFlow's solar-savings math — moved into SimState (originally from a global ELECTRICITY_RATE_PLACEHOLDER_PER_KWH constant, 4.2) so the electricity_rate_increase event can permanently, compoundingly raise it per game instance without leaking a mutation into a shared module-level constant. As of the vehicle-economics pass, starts at the active preset's own operatingBaseline.electricityRatePerKWhPlaceholder in createNewGame() — previously a single global constant shared by every preset (audit finding #1). */
  electricityRatePerKWh: number;
  /** Same "moved into mutable state" pattern as electricityRatePerKWh above, and for the same reason: the fixed SAFE_HARBOR_DEADLINE constant can't be permanently moved up by incentive_program_closes_early without leaking a mutation into a shared module-level object. currentItcRate() reads this field instead of the constant directly — same function, no duplicated deadline-check logic. Starts as a copy of SAFE_HARBOR_DEADLINE in createNewGame(). */
  safeHarborDeadline: { month: number; year: number };
  /** True once incentive_program_closes_early has fired — the event checks this first and refuses to fire again, since the deadline can only move up once per game. */
  incentiveProgramClosedEarlyFired: boolean;
  /** Set true by utility_pilot_program when it fires. Stored only — no further consequence wired up this pass. Reserved for a future data-sharing/obligation mechanic that would come with real pilot-program participation (e.g. required usage reporting, a reciprocal commitment); deliberately deferred. */
  isPilotProgramParticipant: boolean;
  /**
   * $ per vehicle used by computeGrantFinancingProjection and
   * commitToRouteConversion — originally named evCostPerBus (4.5), renamed
   * here since "bus" stopped being accurate the moment a non-bus preset
   * (Tank Wash) existed. Moved into SimState (from the module-level
   * ELECTRIC_BUS_COST_PLACEHOLDER constant) so ev_price_decline can
   * permanently, compoundingly reduce it per game instance without leaking
   * a mutation into a shared constant, same pattern as electricityRatePerKWh.
   * As of the vehicle-economics pass, starts at the active preset's
   * fleet.vehicleEconomics.costPerVehiclePlaceholder in createNewGame() —
   * previously a single global constant shared by every preset. Read fresh
   * at commit time only, so an already-committed routeConversion's
   * baked-in cost draws are never retroactively changed by a later
   * decline — same principle that already protects existing debt from
   * interest_rate_movement.
   */
  evCostPerVehicle: number;
  /**
   * monthOrdinal() at the moment the most recent solarInstall completed;
   * null until the first one does. inverter_failure derives "months since
   * completion" from this by subtraction each time it rolls, rather than a
   * live-incrementing counter. Simplification: this sim only allows one
   * solarInstall to be pending at a time, but a SECOND array could
   * theoretically complete later in a long game (e.g. after a serviceUpgrade
   * raises headroom) — this field (and solarSystemOriginalCost below) only
   * ever holds the MOST RECENT completion, not a per-installation history;
   * a prior array's inverter-failure exposure is not separately tracked.
   */
  solarCompletionOrdinal: number | null;
  /** Original (pre-ITC) total cost of the most recent completed solarInstall — sizedKW × SOLAR_COST_PER_KW_PLACEHOLDER at that action's commit time. Set alongside solarCompletionOrdinal; null until a solarInstall completes. inverter_failure's cash cost is a percentage of this figure, not of whatever was actually paid net of the ITC discount. */
  solarSystemOriginalCost: number | null;
  /** True once grant_program_funding_cut has fired — the event checks this first and refuses to fire again, same one-shot pattern as incentiveProgramClosedEarlyFired. */
  grantProgramFundingCutFired: boolean;
  /** 0 = no active panel_underperformance episode. Set to a random 1-3 by that event when it fires; decremented by one real tick at a time in advanceOneMonth (NOT inside computeMonthlyOperatingCashFlow itself, since that function is also called mid-tick for live UI projections like computeDebtFinancingProjection — decrementing inside a function called an unpredictable number of times per tick would wear the episode off inconsistently). Reset to 0 (and panelUnderperformanceMultiplier to 1) the tick it reaches 0. */
  panelUnderperformanceMonthsRemaining: number;
  /** 1 = no reduction. While panelUnderperformanceMonthsRemaining > 0, computeMonthlyOperatingCashFlow multiplies that month's solar generation by this value before computing savings — a temporary reduction only, never a permanent one. Meaningless (ignored) while panelUnderperformanceMonthsRemaining is 0. */
  panelUnderperformanceMultiplier: number;
}

export interface GameState {
  version: number;
  facility: FacilityProfile;
  sim: SimState;
  speed: ClockSpeed;
  realMsAccumulator: number;
  /** Placeholder fixed monthly opex until real solar/EV/utility-bill math replaces it. Starts at the active preset's own operatingBaseline.monthlyOpexPlaceholder in createNewGame() — previously a single global constant shared by every preset (audit finding #1 from the preset-generalization pass). */
  monthlyOpex: number;
  activeTab: string;
}
