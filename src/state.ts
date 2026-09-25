import { SAFE_HARBOR_DEADLINE, SCHOOL_BUS_DEPOT_PRESET } from "./constants.js";
import type { FacilityProfile, GameState } from "./types.js";

// Second-preset pass: createNewGame() now takes which preset to start from,
// defaulting to the bus depot only so any leftover no-arg caller doesn't
// break. cash is read directly from the SELECTED preset's
// finance.availableCapital — previously this was a module-level
// STARTING_CASH constant hardcoded to SCHOOL_BUS_DEPOT_PRESET, which would
// have silently started every game with the bus depot's capital regardless
// of which preset was actually chosen. That was a real bug this pass fixes
// as part of wiring preset selection, not a mechanics change.
export function createNewGame(preset: FacilityProfile = SCHOOL_BUS_DEPOT_PRESET): GameState {
  return {
    version: 1,
    // Cloned, not shared by reference: a serviceUpgrade completing now mutates
    // electrical.interconnectionHeadroom, and the preset must stay untouched
    // for the next game a page session creates.
    facility: structuredClone(preset),
    sim: {
      // A school bus depot's planning year starts before the school year does.
      // Kept fixed for every preset this pass — a facility-specific start
      // month (e.g. a calendar-year-aligned start for a non-school preset)
      // is a real gap, not modeled here; flagged, not fixed.
      month: 9, // September
      year: 1,
      cash: preset.finance.availableCapital,
      activeLoans: [],
      // debt and totalMonthlyDebtService are getters, not plain fields — see
      // their doc comments in types.ts (Phase 4.11: loan refinancing needed
      // a per-loan record, so these are now derived from activeLoans on
      // every read rather than separately-maintained running totals that
      // could drift out of sync with it).
      get debt() {
        return this.activeLoans.reduce((sum: number, loan: { remainingPrincipal: number }) => sum + loan.remainingPrincipal, 0);
      },
      get totalMonthlyDebtService() {
        return this.activeLoans.reduce((sum: number, loan: { monthlyPayment: number }) => sum + loan.monthlyPayment, 0);
      },
      dscr: null, // no debt yet — N/A, not a placeholder number
      electrificationRate: 0,
      // No ticks have run yet, so "this month" doesn't exist -- 100 matches
      // the "zero failures this month" baseline the first real tick computes.
      uptimePercent: 100,
      uptimeHistory: [],
      trailingUptimeAverage: 100,
      uptimeWarningLevel: "normal",
      maintenanceStrategy: "reactive",
      finalOutcome: null,
      solarCapacityKW: 0,
      reservedInterconnectionKW: 0,
      hasSpareConduit: false,
      spareConduitCapacityKW: 0,
      installedChargerKW: 0,
      reservedChargerCapacityKW: 0,
      pendingActions: [],
      consecutiveNegativeCashMonths: 0,
      gameOverReason: null,
      dieselPriceMultiplier: 1,
      eventLog: [],
      // Read from the SELECTED preset's operatingBaseline/vehicleEconomics,
      // not global constants — every preset used to share these two fields
      // (audit finding #1 from the preset-generalization pass), so a Tank
      // Wash game would have silently started with School Bus Depot's rate.
      electricityRatePerKWh: preset.operatingBaseline.electricityRatePerKWhPlaceholder,
      // Copied, not shared by reference, same reasoning as facility above:
      // incentive_program_closes_early mutates this per game instance.
      safeHarborDeadline: { ...SAFE_HARBOR_DEADLINE },
      incentiveProgramClosedEarlyFired: false,
      isPilotProgramParticipant: false,
      evCostPerVehicle: preset.fleet.vehicleEconomics.costPerVehiclePlaceholder,
      solarCompletionOrdinal: null,
      solarSystemOriginalCost: null,
      grantProgramFundingCutFired: false,
      panelUnderperformanceMonthsRemaining: 0,
      panelUnderperformanceMultiplier: 1,
    },
    speed: 1,
    realMsAccumulator: 0,
    monthlyOpex: preset.operatingBaseline.monthlyOpexPlaceholder,
    activeTab: "overview",
  };
}
