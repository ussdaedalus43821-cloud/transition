import {
  CHARGER_DCFC_COST_PLACEHOLDER,
  CHARGER_DCFC_KW_PLACEHOLDER,
  CHARGER_DCFC_MONTHS,
  CHARGER_DESIGN_FRACTION,
  CHARGER_INSTALL_FRACTION,
  CHARGER_L2_COST_PLACEHOLDER,
  CHARGER_L2_KW_PLACEHOLDER,
  CHARGER_L2_MONTHS,
  INTERCONNECTION_STUDY_FINAL_COST,
  INTERCONNECTION_STUDY_MIDPOINT_COST,
  INTERCONNECTION_STUDY_MOBILIZATION_COST,
  INTERCONNECTION_STUDY_MONTHS,
  DSCR_MINIMUM_FOR_NEW_DEBT,
  EVENT_TABLE,
  INSOLVENCY_THRESHOLD_MONTHS,
  LOAN_REFINANCE_COST_FRACTION,
  ROOF_USABLE_FRACTION_PLACEHOLDER,
  ROUTE_CONVERSION_DELIVERY_DRAW_MONTH,
  ROUTE_CONVERSION_DELIVERY_FRACTION,
  ROUTE_CONVERSION_DEPOSIT_FRACTION,
  ROUTE_CONVERSION_DOWN_PAYMENT_FRACTION,
  ROUTE_CONVERSION_MONTHS,
  SEASONAL_GENERATION_MULTIPLIER,
  SERVICE_UPGRADE_CONSTRUCTION_DRAW_MONTH,
  SERVICE_UPGRADE_CONSTRUCTION_FRACTION,
  SERVICE_UPGRADE_HEADROOM_MULTIPLIER,
  SERVICE_UPGRADE_MONTHS,
  SERVICE_UPGRADE_STUDY_FRACTION,
  SERVICE_UPGRADE_TOTAL_COST_PLACEHOLDER,
  SOLAR_COST_PER_KW_PLACEHOLDER,
  SOLAR_DESIGN_PERMIT_FRACTION,
  SOLAR_EQUIPMENT_DRAW_MONTH,
  SOLAR_EQUIPMENT_FRACTION,
  SOLAR_INSTALL_MONTHS,
  SPARE_CONDUIT_CAPACITY_MULTIPLIER,
  SPARE_CONDUIT_COST_MULTIPLIER,
  SQFT_PER_KW_PLACEHOLDER,
  FLEET_MAINTENANCE_PREVENTATIVE_FAILURE_MULTIPLIER,
  MAINTENANCE_PROGRAM_COST_PER_VEHICLE,
  UPTIME_FLOOR_PERCENT,
  UPTIME_HISTORY_MAX_ENTRIES,
  UPTIME_IMPACT_PER_FAILURE_PLACEHOLDER,
  DSCR_MINIMUM_FOR_SUCCESS,
  OBJECTIVE_TIER_EXCEPTIONAL_MIN,
  OBJECTIVE_TIER_STRONG_MIN,
  OBJECTIVE_TIER_SUCCESSFUL_MIN,
  UPTIME_FLOOR_FOR_SUCCESS,
  UPTIME_POOR_THRESHOLD,
  UPTIME_WARNING_THRESHOLD,
  YEARS_TO_EVALUATE,
  nextId,
} from "../constants.js";
import { dateFromOrdinal, formatDate, monthOrdinal } from "./clock.js";
import { SEAM_TABLE_ROWS } from "../seamTable.js";
import type {
  ActiveLoan,
  ChargerType,
  CommittedAction,
  CommittedActionType,
  EventType,
  FacilityProfile,
  FailedSecondaryCondition,
  FinalOutcome,
  FinancingType,
  GameState,
  LoanTerm,
  ObjectiveTier,
  Route,
} from "../types.js";

export function isActionPending(state: GameState, type: CommittedAction["type"]): boolean {
  return state.sim.pendingActions.some((a) => a.type === type);
}

/** True if every type this action lists in blockedBy is currently clear. No action defines one yet, so this is always true this pass — it exists so a later action can gate on this one without touching the tick loop. */
export function canCommitAction(state: GameState, blockedBy: CommittedAction["type"][]): boolean {
  return !blockedBy.some((type) => isActionPending(state, type));
}

/** Raw nameplate interconnection headroom — the ceiling before anything has claimed a share of it. */
export function computeInterconnectionHeadroomKW(facility: FacilityProfile): number {
  const { serviceAmps, serviceVoltage, interconnectionHeadroom } = facility.electrical;
  return (serviceAmps * serviceVoltage * interconnectionHeadroom) / 1000;
}

/** The shared, depleting pool every headroom check must compare against — raw headroom minus whatever solar/charger installs have already claimed, whether pending or completed (reserved at commit time to close a double-booking race — see cancelPendingAction for the release side). */
export function availableInterconnectionKW(state: GameState): number {
  return computeInterconnectionHeadroomKW(state.facility) - state.sim.reservedInterconnectionKW;
}

export function commitToInterconnectionStudy(state: GameState): boolean {
  if (isActionPending(state, "interconnection_study")) return false;
  if (state.sim.cash < INTERCONNECTION_STUDY_MOBILIZATION_COST) return false;

  const action: CommittedAction = {
    id: nextId("action"),
    type: "interconnection_study",
    label: "Interconnection Study",
    monthsOriginal: INTERCONNECTION_STUDY_MONTHS,
    monthsRemaining: INTERCONNECTION_STUDY_MONTHS,
    // Month-0 mobilization draw is charged below, immediately — this schedule
    // only holds the draws still owed once the tick loop starts running.
    costSchedule: [
      { month: 6, amount: INTERCONNECTION_STUDY_MIDPOINT_COST, paid: false },
      { month: 12, amount: INTERCONNECTION_STUDY_FINAL_COST, paid: false },
    ],
    blockedBy: [],
    onCompleteSolarCapacityKW: 0,
    onCompleteChargerCapacityKW: 0,
    reservedInterconnectionKWOnCommit: 0,
    reservedChargerCapacityKWOnCommit: 0,
    reservedGrantFundingOnCommit: 0,
    onCompleteInterconnectionHeadroomMultiplier: 1,
    installsSpareConduit: false,
    spareConduitCapacityKWOnComplete: 0,
    targetRouteId: "",
    sizedKW: 0,
    itcRateApplied: 0,
  };

  state.sim.cash -= INTERCONNECTION_STUDY_MOBILIZATION_COST;
  state.sim.pendingActions.push(action);
  return true;
}

export type BindingConstraint = "roof" | "energyTarget" | "interconnection";

export interface ArraySizingResult {
  roofCapacityKW: number;
  energyTargetKW: number;
  interconnectionHeadroomKW: number;
  sizedKW: number;
  bindingConstraint: BindingConstraint;
}

/** Unit-consistent array sizing: three independent kW ceilings, taken as a min(). Interconnection is checked first so a tie resolves in favor of flagging the constraint that actually blocks a commit (see commitToSolarInstall). interconnectionHeadroomKW here is the shared-pool AVAILABLE figure (raw headroom minus whatever's already reserved, whether pending or completed), not the raw nameplate value — solar and chargers genuinely compete for the same capacity. */
export function computeArraySizing(state: GameState): ArraySizingResult {
  const facility = state.facility;
  const usableRoofSqFt = facility.site.roofSqFt * ROOF_USABLE_FRACTION_PLACEHOLDER;
  const roofCapacityKW = usableRoofSqFt / SQFT_PER_KW_PLACEHOLDER;

  const annualYieldPerKW = facility.location.climateZone.solarYieldFactor;
  const energyTargetKW = (facility.energy.annualFacilityLoadKWh * facility.energy.targetOffsetFraction) / annualYieldPerKW;

  const interconnectionHeadroomKW = availableInterconnectionKW(state);

  const sizedKW = Math.min(roofCapacityKW, energyTargetKW, interconnectionHeadroomKW);
  let bindingConstraint: BindingConstraint;
  if (sizedKW === interconnectionHeadroomKW) bindingConstraint = "interconnection";
  else if (sizedKW === roofCapacityKW) bindingConstraint = "roof";
  else bindingConstraint = "energyTarget";

  return { roofCapacityKW, energyTargetKW, interconnectionHeadroomKW, sizedKW, bindingConstraint };
}

/** 30% before the safe-harbor deadline, 0% after — no partial phase-down tiers or real tax math this pass. Reads state.sim.safeHarborDeadline (not the SAFE_HARBOR_DEADLINE constant directly) so incentive_program_closes_early can move the effective deadline up for this game instance without mutating the shared preset constant. */
export function currentItcRate(state: GameState): number {
  const now = monthOrdinal(state.sim.month, state.sim.year);
  const deadline = monthOrdinal(state.sim.safeHarborDeadline.month, state.sim.safeHarborDeadline.year);
  return now <= deadline ? state.facility.environment.federalITCRate : 0;
}

export function commitToSolarInstall(state: GameState): boolean {
  if (isActionPending(state, "solarInstall")) return false;

  const sizing = computeArraySizing(state);
  if (sizing.bindingConstraint === "interconnection") return false; // UI disables for this case too — guarded here as well since this is the actual gate

  const totalCost = sizing.sizedKW * SOLAR_COST_PER_KW_PLACEHOLDER;
  const designDraw = totalCost * SOLAR_DESIGN_PERMIT_FRACTION;
  const itcRate = currentItcRate(state);
  const equipmentDraw = totalCost * SOLAR_EQUIPMENT_FRACTION * (1 - itcRate);

  if (state.sim.cash < designDraw) return false;

  const action: CommittedAction = {
    id: nextId("action"),
    type: "solarInstall",
    label: `Solar Array (${sizing.sizedKW.toFixed(1)} kW)`,
    monthsOriginal: SOLAR_INSTALL_MONTHS,
    monthsRemaining: SOLAR_INSTALL_MONTHS,
    costSchedule: [{ month: SOLAR_EQUIPMENT_DRAW_MONTH, amount: equipmentDraw, paid: false }],
    blockedBy: [],
    onCompleteSolarCapacityKW: sizing.sizedKW,
    onCompleteChargerCapacityKW: 0,
    // Solar now claims a permanent share of the shared interconnection pool,
    // same as a charger install — they genuinely compete for capacity.
    // Reserved immediately below, at commit — not deferred to completion.
    reservedInterconnectionKWOnCommit: sizing.sizedKW,
    reservedChargerCapacityKWOnCommit: 0,
    reservedGrantFundingOnCommit: 0,
    onCompleteInterconnectionHeadroomMultiplier: 1,
    installsSpareConduit: false,
    spareConduitCapacityKWOnComplete: 0,
    targetRouteId: "",
    sizedKW: sizing.sizedKW,
    itcRateApplied: itcRate,
  };

  // Reserve now, at commit, so a second pending solar/charger commit can't
  // pass its own capacity-gate check against this same still-unbuilt kW.
  state.sim.reservedInterconnectionKW += sizing.sizedKW;
  state.sim.cash -= designDraw;
  state.sim.pendingActions.push(action);
  return true;
}

export function commitToServiceUpgrade(state: GameState): boolean {
  if (isActionPending(state, "serviceUpgrade")) return false; // only one in progress at a time

  const designDraw = SERVICE_UPGRADE_TOTAL_COST_PLACEHOLDER * SERVICE_UPGRADE_STUDY_FRACTION;
  if (state.sim.cash < designDraw) return false;

  const action: CommittedAction = {
    id: nextId("action"),
    type: "serviceUpgrade",
    label: "Electrical Service Upgrade",
    monthsOriginal: SERVICE_UPGRADE_MONTHS,
    monthsRemaining: SERVICE_UPGRADE_MONTHS,
    costSchedule: [
      { month: SERVICE_UPGRADE_CONSTRUCTION_DRAW_MONTH, amount: SERVICE_UPGRADE_TOTAL_COST_PLACEHOLDER * SERVICE_UPGRADE_CONSTRUCTION_FRACTION, paid: false },
    ],
    blockedBy: [],
    onCompleteSolarCapacityKW: 0,
    onCompleteChargerCapacityKW: 0,
    reservedInterconnectionKWOnCommit: 0,
    reservedChargerCapacityKWOnCommit: 0,
    reservedGrantFundingOnCommit: 0,
    // Expands the shared pool itself rather than claiming a share of it.
    onCompleteInterconnectionHeadroomMultiplier: SERVICE_UPGRADE_HEADROOM_MULTIPLIER,
    installsSpareConduit: false,
    spareConduitCapacityKWOnComplete: 0,
    targetRouteId: "",
    sizedKW: 0,
    itcRateApplied: 0,
  };

  state.sim.cash -= designDraw;
  state.sim.pendingActions.push(action);
  return true;
}

export interface ChargerSizing {
  perUnitKW: number;
  perUnitCost: number;
  monthsOriginal: number;
  totalKW: number;
}

/** Per-unit kW/cost/lead-time are placeholders pending real spec/vendor research (see constants.ts). */
export function computeChargerSizing(chargerCount: number, chargerType: ChargerType): ChargerSizing {
  const perUnitKW = chargerType === "L2" ? CHARGER_L2_KW_PLACEHOLDER : CHARGER_DCFC_KW_PLACEHOLDER;
  const perUnitCost = chargerType === "L2" ? CHARGER_L2_COST_PLACEHOLDER : CHARGER_DCFC_COST_PLACEHOLDER;
  const monthsOriginal = chargerType === "L2" ? CHARGER_L2_MONTHS : CHARGER_DCFC_MONTHS;
  return { perUnitKW, perUnitCost, monthsOriginal, totalKW: chargerCount * perUnitKW };
}

export function commitToChargerInstall(state: GameState, chargerCount: number, chargerType: ChargerType, installSpareConduit: boolean): boolean {
  if (!Number.isInteger(chargerCount) || chargerCount < 1) return false;

  const sizing = computeChargerSizing(chargerCount, chargerType);
  if (sizing.totalKW > availableInterconnectionKW(state)) return false; // UI disables for this case too — guarded here as well since this is the actual gate

  let totalCost = chargerCount * sizing.perUnitCost;
  if (installSpareConduit) totalCost *= 1 + SPARE_CONDUIT_COST_MULTIPLIER;
  const designDraw = totalCost * CHARGER_DESIGN_FRACTION;
  const installDraw = totalCost * CHARGER_INSTALL_FRACTION;

  if (state.sim.cash < designDraw) return false;

  const chargerLabel = `${chargerCount}× ${chargerType} Charger${chargerCount === 1 ? "" : "s"}`;
  const action: CommittedAction = {
    id: nextId("action"),
    type: "chargerInstall",
    label: `${chargerLabel} (${sizing.totalKW} kW)`,
    monthsOriginal: sizing.monthsOriginal,
    monthsRemaining: sizing.monthsOriginal,
    // Install draw lands the month before completion, per spec.
    costSchedule: [{ month: sizing.monthsOriginal - 1, amount: installDraw, paid: false }],
    blockedBy: [],
    onCompleteSolarCapacityKW: 0,
    // Physical charger hardware built (feeds routeConversion's capacity check)
    // vs. the same install's draw on the electrical service — two different pools.
    onCompleteChargerCapacityKW: sizing.totalKW,
    // Only the hardware itself (above) waits for completion — the
    // electrical-service reservation happens now, at commit.
    reservedInterconnectionKWOnCommit: sizing.totalKW,
    reservedChargerCapacityKWOnCommit: 0,
    reservedGrantFundingOnCommit: 0,
    onCompleteInterconnectionHeadroomMultiplier: 1,
    installsSpareConduit: installSpareConduit,
    // The discount/penalty logic against this is deferred — stored only, for now.
    spareConduitCapacityKWOnComplete: installSpareConduit ? sizing.totalKW * SPARE_CONDUIT_CAPACITY_MULTIPLIER : 0,
    targetRouteId: "",
    sizedKW: 0,
    itcRateApplied: 0,
  };

  // Reserve now, at commit, so a second pending solar/charger commit can't
  // pass its own capacity-gate check against this same still-unbuilt kW.
  state.sim.reservedInterconnectionKW += sizing.totalKW;
  state.sim.cash -= designDraw;
  state.sim.pendingActions.push(action);
  return true;
}

/** Real route-miles-weighted electrification: converted daily route-miles over total daily route-miles. Called whenever a routeConversion completes — never incremented by a flat per-action bump. */
export function recomputeElectrificationRate(state: GameState): void {
  const routes = state.facility.fleet.routes;
  const totalMiles = routes.reduce((sum, r) => sum + r.dailyMiles * r.dedicatedVehicleCount, 0);
  const convertedMiles = routes.filter((r) => r.converted).reduce((sum, r) => sum + r.dailyMiles * r.dedicatedVehicleCount, 0);
  state.sim.electrificationRate = totalMiles > 0 ? convertedMiles / totalMiles : 0;
}

/** True if a route is already converted, or already has a routeConversion in flight — either way it can't be committed again. */
export function isRouteConvertedOrPending(state: GameState, routeId: string): boolean {
  const route = state.facility.fleet.routes.find((r) => r.id === routeId);
  if (!route) return true;
  if (route.converted) return true;
  return state.sim.pendingActions.some((a) => a.type === "routeConversion" && a.targetRouteId === routeId);
}

// Takes GameState (not just the route) since charging demand per vehicle is
// now read from the active preset's fleet.vehicleEconomics, not a global
// constant — every call site already has state in scope.
export function requiredChargingKWForRoute(state: GameState, route: { dedicatedVehicleCount: number }): number {
  return route.dedicatedVehicleCount * state.facility.fleet.vehicleEconomics.chargingDemandPerVehicleKWPlaceholder;
}

/**
 * Fixed opex minus whatever solar offsets it this month, plus diesel
 * fuel/maintenance savings from every route that's completed conversion so
 * far, BEFORE any capex draws. This is the same figure the tick loop settles
 * cash against — pulled out into its own function so the DSCR calc can
 * reuse the exact number instead of re-deriving it. NOTE: using this as a
 * DSCR numerator is a simplification — a real DSCR uses net operating
 * income with its own set of add-backs (depreciation, etc.), not "facility
 * overhead net of a couple of offsets." This facility also has no other
 * modeled revenue, so what's really being measured is "how much cushion
 * this cost figure leaves to service debt," not true NOI. Placeholder
 * pending real accounting treatment.
 *
 * Diesel savings are read live from facility.fleet.routes' converted flags
 * every time this runs — nothing caches or requires a manual refresh, so a
 * route completing conversion mid-game raises this figure (and therefore
 * DSCR) starting the very next time it's computed. Deliberately does NOT
 * count the route currently being evaluated for a new commit as converted
 * before it actually is — a route can't draw on its own not-yet-realized
 * savings to qualify for the loan that pays for it.
 *
 * Solar generation is reduced by panelUnderperformanceMultiplier while
 * panelUnderperformanceMonthsRemaining > 0 (a temporary panel_underperformance
 * episode) — read-only here, since this function is also called mid-tick for
 * live UI projections (e.g. computeDebtFinancingProjection); the actual
 * month-by-month countdown is decremented once per real tick in
 * advanceOneMonth, not here.
 */
export function computeMonthlyOperatingCashFlow(state: GameState): number {
  const seasonalMultiplier = SEASONAL_GENERATION_MULTIPLIER[state.sim.month - 1];
  const annualYieldPerKW = state.facility.location.climateZone.solarYieldFactor;
  const underperformanceMultiplier = state.sim.panelUnderperformanceMonthsRemaining > 0 ? state.sim.panelUnderperformanceMultiplier : 1;
  const monthlyGenerationKWh = (state.sim.solarCapacityKW * annualYieldPerKW / 12) * seasonalMultiplier * underperformanceMultiplier;
  const solarSavings = monthlyGenerationKWh * state.sim.electricityRatePerKWh;
  const dieselSavingsPerVehicle = state.facility.fleet.vehicleEconomics.dieselSavingsPerVehicleMonthlyPlaceholder;
  const dieselSavings = state.facility.fleet.routes
    .filter((r) => r.converted)
    .reduce((sum, r) => sum + r.dedicatedVehicleCount * dieselSavingsPerVehicle, 0);
  // Fleet-only preventative maintenance program cost — see
  // SimState.maintenanceStrategy's doc comment. Applied to fleet.totalVehicles
  // (converted and not), same additive-cost treatment as monthlyOpex, since
  // this is a genuine new recurring expense, not a savings/offset.
  const maintenanceProgramCost =
    state.sim.maintenanceStrategy === "preventative" ? state.facility.fleet.totalVehicles * MAINTENANCE_PROGRAM_COST_PER_VEHICLE : 0;
  return state.monthlyOpex - solarSavings + dieselSavings + maintenanceProgramCost;
}

/** Real DSCR = operating cash flow / total debt service. null ("N/A") when there's no debt yet, rather than a divide-by-zero or an infinite/misleading number. */
export function computeDSCR(state: GameState): number | null {
  if (state.sim.totalMonthlyDebtService <= 0) return null;
  return computeMonthlyOperatingCashFlow(state) / state.sim.totalMonthlyDebtService;
}

/** Standard amortization: payment = principal × (r(1+r)^n) / ((1+r)^n - 1), r = monthly rate, n = term in months. */
export function computeMonthlyLoanPayment(principal: number, apr: number, termMonths: number): number {
  const r = apr / 12;
  if (r === 0) return principal / termMonths;
  const growth = Math.pow(1 + r, termMonths);
  return (principal * r * growth) / (growth - 1);
}

/** Looks up a loan term by key; falls back to the first available term if no key is given or the key isn't found (preserves the old "just use the first entry" default for any caller that doesn't care which term). */
export function findLoanTerm(state: GameState, loanTermKey?: string): LoanTerm {
  const terms = state.facility.finance.loanTermsAvailable;
  const found = loanTermKey ? terms.find((t) => t.key === loanTermKey) : undefined;
  return found ?? terms[0];
}

export interface DebtFinancingProjection {
  loanTermKey: string;
  downPayment: number;
  principal: number;
  monthlyPayment: number;
  /** What DSCR would be immediately after this loan originates, given today's operating cash flow. null if that's somehow still undefined (shouldn't happen once a loan exists, since totalMonthlyDebtService would be > 0). */
  projectedDSCR: number | null;
  meetsThreshold: boolean;
}

/** Projects the effect of financing totalCost via a given loan term (by key — defaults to the first available term, same as before this pass generalized the selection). Used both to gate a debt-financed commit and to show the player the numbers before they click. Still no general multi-lender comparison system — just a choice of which of the (at most a couple of) known terms to project. */
export function computeDebtFinancingProjection(state: GameState, totalCost: number, loanTermKey?: string): DebtFinancingProjection {
  const downPayment = totalCost * ROUTE_CONVERSION_DOWN_PAYMENT_FRACTION;
  const principal = totalCost - downPayment;
  const loanTerm = findLoanTerm(state, loanTermKey);
  const monthlyPayment = computeMonthlyLoanPayment(principal, loanTerm.apr, loanTerm.termMonths);
  const projectedDebtService = state.sim.totalMonthlyDebtService + monthlyPayment;
  const projectedDSCR = projectedDebtService > 0 ? computeMonthlyOperatingCashFlow(state) / projectedDebtService : null;
  const meetsThreshold = projectedDSCR !== null && projectedDSCR >= DSCR_MINIMUM_FOR_NEW_DEBT;
  return { loanTermKey: loanTerm.key, downPayment, principal, monthlyPayment, projectedDSCR, meetsThreshold };
}

export interface RefinanceProjection {
  loanId: string;
  newTermKey: string;
  currentMonthlyPayment: number;
  newMonthlyPayment: number;
  /** LOAN_REFINANCE_COST_FRACTION × the loan's remainingPrincipal, charged as an immediate cash cost if this refinance goes through. */
  refinanceCost: number;
  /** What DSCR would be immediately after this refinance, given today's operating cash flow and every OTHER loan's payment unchanged — only this one loan's payment is swapped out for the new one. */
  projectedDSCR: number | null;
  meetsThreshold: boolean;
}

/**
 * Projects the effect of refinancing one specific loan (by id) onto a new
 * loan term, without committing anything — same "project before you click"
 * role computeDebtFinancingProjection plays for a brand-new route-conversion
 * loan. Returns null only if loanId doesn't match any entry in
 * state.sim.activeLoans (shouldn't happen from the UI, which only offers
 * refinancing for loans it's currently listing).
 */
export function computeRefinanceProjection(state: GameState, loanId: string, newTermKey: string): RefinanceProjection | null {
  const loan = state.sim.activeLoans.find((l) => l.id === loanId);
  if (!loan) return null;
  const newTerm = findLoanTerm(state, newTermKey);
  const newMonthlyPayment = computeMonthlyLoanPayment(loan.remainingPrincipal, newTerm.apr, newTerm.termMonths);
  const refinanceCost = loan.remainingPrincipal * LOAN_REFINANCE_COST_FRACTION;
  // Same-loan swap: today's totalMonthlyDebtService (a fresh sum over every
  // active loan, itself a getter — see types.ts) already includes this
  // loan's CURRENT payment, so subtract that out before adding the
  // projected new one. Every other loan's payment is untouched.
  const projectedDebtService = state.sim.totalMonthlyDebtService - loan.monthlyPayment + newMonthlyPayment;
  const projectedDSCR = projectedDebtService > 0 ? computeMonthlyOperatingCashFlow(state) / projectedDebtService : null;
  const meetsThreshold = projectedDSCR !== null && projectedDSCR >= DSCR_MINIMUM_FOR_NEW_DEBT;
  return {
    loanId,
    newTermKey: newTerm.key,
    currentMonthlyPayment: loan.monthlyPayment,
    newMonthlyPayment,
    refinanceCost,
    projectedDSCR,
    meetsThreshold,
  };
}

/**
 * Rate-and-term refinance of one existing loan (Phase 4.11) — NOT a
 * cash-out refi: remainingPrincipal is untouched, only apr/termMonths/
 * monthlyPayment change, and originatedAtMonth resets to now since this is
 * a fresh amortization schedule at the new rate. Blocked by the same
 * DSCR_MINIMUM_FOR_NEW_DEBT gate new debt originations use (lenders won't
 * refinance into a payment that would breach it either) and by insufficient
 * cash on hand for the closing cost — same "gate first, then charge cash"
 * pattern every other commit action in this file follows. Returns false and
 * changes nothing if any of those checks fail.
 */
export function refinanceLoan(state: GameState, loanId: string, newTermKey: string): boolean {
  const loan = state.sim.activeLoans.find((l) => l.id === loanId);
  if (!loan) return false;
  const projection = computeRefinanceProjection(state, loanId, newTermKey);
  if (!projection || !projection.meetsThreshold) return false;
  if (state.sim.cash < projection.refinanceCost) return false;

  const newTerm = findLoanTerm(state, newTermKey);
  state.sim.cash -= projection.refinanceCost;
  loan.apr = newTerm.apr;
  loan.termMonths = newTerm.termMonths;
  loan.monthlyPayment = projection.newMonthlyPayment;
  loan.originatedAtMonth = monthOrdinal(state.sim.month, state.sim.year);
  return true;
}

// The one grant program this pass knows how to use — no multi-program lookup
// UI or logic; if it's ever missing from facility data, grant financing is
// simply unavailable rather than an error.
const GRANT_PROGRAM_KEY = "epa_clean_school_bus";

export interface GrantFinancingProjection {
  /** False only if the program entry itself is missing from facility data (shouldn't happen with the current preset). */
  available: boolean;
  /** grantAmountPerBusCap, or the full per-bus cost if that's cheaper — the actual dollar coverage per bus before the vehicle-count multiply. Shown in the UI so the per-bus mechanic is visible, not just a final total. */
  perBusCoverage: number;
  /** Per-bus cost used for this projection (SimState.evCostPerVehicle, read fresh at call time) — surfaced so the UI can show "$X of $Y per bus" without re-reading state. Field kept "costPerBus"/"perBusCoverage" here since these describe the EPA grant program's own per-bus cap terminology, not the vehicle-economics rename below. */
  costPerBus: number;
  busCount: number;
  /** perBusCoverage × busCount, BEFORE the remaining-pool cap below — what the program would pay if funding were unlimited. */
  grantAmountUncapped: number;
  /** The actual grant applied to this route: grantAmountUncapped, reduced to whatever remains in the pool if the pool can't cover the full uncapped amount. */
  grantAmount: number;
  /** What the district must still pay in cash — totalRouteCost minus grantAmount. This is what actually gets split across the existing 25%/75% draw schedule, same scaling pattern as debt financing's down payment. */
  cashDue: number;
  remainingPoolBefore: number;
  remainingPoolAfter: number;
  /** True only if the pool can cover the FULL uncapped grant with nothing reduced — informational (e.g. for a "partially funded" note in the UI). Does not gate whether a grant-financed commit is allowed; see commitToRouteConversion. */
  meetsPool: boolean;
  applicationDecisionMonths: number;
}

/**
 * Projects grant-covered financing for a routeConversion against the one
 * known program, using a per-bus dollar cap rather than a flat percentage of
 * total cost (see grantAmountPerBusCap's doc comment in types.ts for why —
 * this replaced an earlier percentage-based model that didn't match how the
 * real program pays out). grantAmountForRoute = min(grantAmountPerBusCap,
 * costPerBus) × dedicatedVehicleCount, then capped again by whatever remains
 * in the program's funding pool — if the pool can't cover the full per-bus
 * amount, the grant is reduced to whatever's left rather than blocking the
 * commit outright, so a route can still receive partial grant funding.
 *
 * Known gap: does NOT make chargerInstall eligible for this grant, even
 * though the real program covers charging infrastructure too — chargerInstall
 * is a separate CommittedActionType and folding it into grant eligibility is
 * meaningfully more scope than this pass; noted here rather than built.
 *
 * NOTE on timing: the program's applicationDecisionMonths exists as real data
 * (and is shown to the player) but is NOT staged into the cost draws this
 * pass — since a route can't draw on savings from other routes differently
 * based on financing type, and since (per the brief) an award is guaranteed
 * once pool room exists with no rejection risk, the discount is applied
 * immediately at commit for the cash math, exactly like debt financing's loan
 * origination is already simplified to happen instantly rather than staged
 * over a real closing period. This is a deliberate simplification, not an
 * oversight: staging it via a delayed costSchedule credit was considered and
 * rejected because splitting the discount unevenly across the existing
 * 25%/75% draws either double-counts or leaks part of the grant's value.
 */
export function computeGrantFinancingProjection(state: GameState, route: Route): GrantFinancingProjection {
  const costPerBus = state.sim.evCostPerVehicle;
  const busCount = route.dedicatedVehicleCount;
  const totalRouteCost = busCount * costPerBus;
  const program = state.facility.environment.incentivePrograms.find((p) => p.key === GRANT_PROGRAM_KEY);
  if (!program) {
    return {
      available: false,
      perBusCoverage: 0,
      costPerBus,
      busCount,
      grantAmountUncapped: 0,
      grantAmount: 0,
      cashDue: totalRouteCost,
      remainingPoolBefore: 0,
      remainingPoolAfter: 0,
      meetsPool: false,
      applicationDecisionMonths: 0,
    };
  }
  const perBusCoverage = Math.min(program.grantAmountPerBusCap, costPerBus);
  const grantAmountUncapped = perBusCoverage * busCount;
  const remainingPoolBefore = program.totalGrantFundingAvailable;
  const meetsPool = remainingPoolBefore >= grantAmountUncapped;
  const grantAmount = Math.min(grantAmountUncapped, remainingPoolBefore);
  return {
    available: true,
    perBusCoverage,
    costPerBus,
    busCount,
    grantAmountUncapped,
    grantAmount,
    cashDue: totalRouteCost - grantAmount,
    remainingPoolBefore,
    remainingPoolAfter: remainingPoolBefore - grantAmount,
    meetsPool,
    applicationDecisionMonths: program.applicationDecisionMonths,
  };
}

/**
 * Cash purchase (financingType "cash", the default), debt financing
 * ("debt", 80% loan against the chosen loan term — defaults to the first
 * available term if loanTermKey is omitted), or grant financing ("grant",
 * the EPA program covers a per-bus dollar cap — see
 * computeGrantFinancingProjection — and the remainder is paid in cash this
 * pass — no grant+debt hybrid). Replacement-cycle timing
 * is deliberately ignored regardless of financing type: existing diesel
 * buses on this route just get replaced at full new-vehicle cost regardless
 * of how much service life they had left. Early-retirement discount/penalty
 * math, loan default consequences, refinancing, and competitive grant
 * rejection are all later passes.
 */
export function commitToRouteConversion(state: GameState, routeId: string, financingType: FinancingType = "cash", loanTermKey?: string): boolean {
  const route = state.facility.fleet.routes.find((r) => r.id === routeId);
  if (!route) return false;
  if (isRouteConvertedOrPending(state, routeId)) return false;
  if (!route.evViable) return false;

  const requiredKW = requiredChargingKWForRoute(state, route);
  const availableChargerKW = state.sim.installedChargerKW - state.sim.reservedChargerCapacityKW;
  if (requiredKW > availableChargerKW) return false; // UI disables for this case too — guarded here as well since this is the actual gate

  // Read fresh at commit time, not cached — an ev_price_decline that fires
  // after this route already has a pending/completed conversion never
  // retroactively changes that action's already-baked-in cost draws; only a
  // NEW commit made after the decline sees the lower price.
  const totalCost = route.dedicatedVehicleCount * state.sim.evCostPerVehicle;

  let debtProjection: DebtFinancingProjection | null = null;
  let grantProjection: GrantFinancingProjection | null = null;
  if (financingType === "debt") {
    debtProjection = computeDebtFinancingProjection(state, totalCost, loanTermKey);
    if (!debtProjection.meetsThreshold) return false; // lenders refuse new debt below the DSCR floor
  } else if (financingType === "grant") {
    grantProjection = computeGrantFinancingProjection(state, route);
    // Unlike the debt gate above, a depleted/partial pool does NOT block the
    // commit — the grant is simply reduced to whatever remains (see
    // computeGrantFinancingProjection), and the district pays the larger
    // cash-due remainder instead. Only a genuinely missing program blocks.
    if (!grantProjection.available) return false;
  }

  // Cash purchase draws 100% of totalCost through the existing 25%/75%
  // schedule; debt financing draws only the down payment through that same
  // schedule (the loan itself never touches cash); grant financing draws
  // only the cash-due remainder after the grant share — same scaling idea,
  // no DSCR gate involved since none of it is debt.
  const cashPortion =
    financingType === "debt" ? (debtProjection as DebtFinancingProjection).downPayment
    : financingType === "grant" ? (grantProjection as GrantFinancingProjection).cashDue
    : totalCost;
  const depositDraw = cashPortion * ROUTE_CONVERSION_DEPOSIT_FRACTION;
  const deliveryDraw = cashPortion * ROUTE_CONVERSION_DELIVERY_FRACTION;

  if (state.sim.cash < depositDraw) return false;

  const label =
    financingType === "debt" ? `Convert Route: ${route.label} (debt financed)`
    : financingType === "grant" ? `Convert Route: ${route.label} (grant financed)`
    : `Convert Route: ${route.label}`;

  const action: CommittedAction = {
    id: nextId("action"),
    type: "routeConversion",
    label,
    monthsOriginal: ROUTE_CONVERSION_MONTHS,
    monthsRemaining: ROUTE_CONVERSION_MONTHS,
    costSchedule: [{ month: ROUTE_CONVERSION_DELIVERY_DRAW_MONTH, amount: deliveryDraw, paid: false }],
    blockedBy: [],
    onCompleteSolarCapacityKW: 0,
    onCompleteChargerCapacityKW: 0,
    reservedInterconnectionKWOnCommit: 0,
    reservedChargerCapacityKWOnCommit: requiredKW,
    reservedGrantFundingOnCommit: financingType === "grant" ? (grantProjection as GrantFinancingProjection).grantAmount : 0,
    onCompleteInterconnectionHeadroomMultiplier: 1,
    installsSpareConduit: false,
    spareConduitCapacityKWOnComplete: 0,
    targetRouteId: routeId,
    sizedKW: 0,
    itcRateApplied: 0,
  };

  // Reserve now, at commit, so a second pending routeConversion/chargerInstall
  // can't pass its own capacity-gate check against this same still-unclaimed kW.
  state.sim.reservedChargerCapacityKW += requiredKW;
  state.sim.cash -= depositDraw;
  state.sim.pendingActions.push(action);

  if (financingType === "debt" && debtProjection) {
    // Loan originates now, at commit, the same moment the down payment's
    // first draw fires — not deferred to completion. Cancelling this action
    // before it completes does not currently unwind the loan (cancelPendingAction
    // only releases capacity/grant reservations); that's a gap for whenever a
    // real cancellation flow needs to handle debt-financed actions.
    //
    // Pushed as its own ActiveLoan entry (Phase 4.11), not added to a scalar
    // running total — state.sim.debt/totalMonthlyDebtService are derived
    // getters over this array (see types.ts), so nothing further needs
    // updating here to keep them correct.
    const loanTerm = findLoanTerm(state, loanTermKey);
    const loan: ActiveLoan = {
      id: nextId("loan"),
      remainingPrincipal: debtProjection.principal,
      apr: loanTerm.apr,
      termMonths: loanTerm.termMonths,
      monthlyPayment: debtProjection.monthlyPayment,
      originatedAtMonth: monthOrdinal(state.sim.month, state.sim.year),
      originalPrincipal: debtProjection.principal,
      sourceRouteId: routeId,
    };
    state.sim.activeLoans.push(loan);
  }
  if (financingType === "grant" && grantProjection) {
    const program = state.facility.environment.incentivePrograms.find((p) => p.key === GRANT_PROGRAM_KEY);
    if (program) program.totalGrantFundingAvailable -= grantProjection.grantAmount;
  }

  return true;
}

const DIESEL_PRICE_SHOCK_MIN_MAGNITUDE = 0.15; // placeholder — see EVENT_TABLE's diesel_price_shock entry
const DIESEL_PRICE_SHOCK_MAX_MAGNITUDE = 0.4; // placeholder
// Guards against a shock (or a run of them) driving the multiplier to zero or
// negative — a sanity bound, not real diesel-price data.
const DIESEL_PRICE_MULTIPLIER_FLOOR = 0.3;
const EQUIPMENT_FAILURE_COST_MIN = 3_000; // placeholder — see EVENT_TABLE's equipment_failure_diesel entry
const EQUIPMENT_FAILURE_COST_MAX = 8_000; // placeholder
const ELECTRICITY_RATE_INCREASE_MIN_MAGNITUDE = 0.05; // placeholder — see EVENT_TABLE's electricity_rate_increase entry
const ELECTRICITY_RATE_INCREASE_MAX_MAGNITUDE = 0.15; // placeholder
const INTEREST_RATE_MOVEMENT_MIN_PP = 0.0025; // 0.25 percentage points, placeholder — see EVENT_TABLE's interest_rate_movement entry
const INTEREST_RATE_MOVEMENT_MAX_PP = 0.0075; // 0.75 percentage points, placeholder
// Guards against a run of down-shocks driving a loan term's APR to zero or
// negative — a sanity bound, not real rate data.
const LOAN_APR_FLOOR = 0.01;
const DEMAND_SPIKE_COST_MIN = 500; // placeholder — see EVENT_TABLE's demand_spike_billing entry
const DEMAND_SPIKE_COST_MAX = 2_000; // placeholder
const INCENTIVE_CLOSURE_MIN_MONTHS = 3; // placeholder — see EVENT_TABLE's incentive_program_closes_early entry
const INCENTIVE_CLOSURE_MAX_MONTHS = 12; // placeholder
const PERMITTING_DELAY_MIN_MONTHS = 1; // placeholder — see EVENT_TABLE's permitting_delay entry
const PERMITTING_DELAY_MAX_MONTHS = 3; // placeholder
// Only these four action types have a real lead-time/permitting exposure this
// pass; interconnection_study is deliberately excluded (per the design brief).
const PERMITTING_DELAY_ELIGIBLE_TYPES: CommittedActionType[] = ["solarInstall", "serviceUpgrade", "chargerInstall", "routeConversion"];
const UTILITY_PILOT_PROGRAM_MIN_CASH = 5_000; // placeholder — see EVENT_TABLE's utility_pilot_program entry
const UTILITY_PILOT_PROGRAM_MAX_CASH = 15_000; // placeholder
const GRANT_BULK_PURCHASE_MIN_AMOUNT = 500_000; // placeholder — see EVENT_TABLE's grant_bulk_purchase_opportunity entry
const GRANT_BULK_PURCHASE_MAX_AMOUNT = 1_000_000; // placeholder
const EV_PRICE_DECLINE_MIN_MAGNITUDE = 0.03; // placeholder — see EVENT_TABLE's ev_price_decline entry
const EV_PRICE_DECLINE_MAX_MAGNITUDE = 0.08; // placeholder
const CHARGER_HARDWARE_FAILURE_BAND_KW = 20; // simplification — see EVENT_TABLE's charger_hardware_failure entry
const CHARGER_HARDWARE_FAILURE_COST_MIN = 2_000; // placeholder
const CHARGER_HARDWARE_FAILURE_COST_MAX = 6_000; // placeholder
// Grounded in real inverter lifespan research (10-15yr typical replacement
// window) — see EVENT_TABLE's inverter_failure entry.
const INVERTER_FAILURE_LATE_LIFE_THRESHOLD_MONTHS = 120; // 10 years
const INVERTER_FAILURE_LATE_LIFE_MULTIPLIER = 5;
const INVERTER_FAILURE_COST_MIN_FRACTION = 0.05; // placeholder, grounded in the same research
const INVERTER_FAILURE_COST_MAX_FRACTION = 0.09; // placeholder
const GRANT_FUNDING_CUT_MIN_FRACTION = 0.3; // placeholder — see EVENT_TABLE's grant_program_funding_cut entry
const GRANT_FUNDING_CUT_MAX_FRACTION = 0.6; // placeholder
// Grounded in NREL soiling-loss research (~5% typical annual generation
// loss) — see EVENT_TABLE's panel_underperformance entry.
const PANEL_UNDERPERFORMANCE_MIN_MULTIPLIER = 0.85; // placeholder
const PANEL_UNDERPERFORMANCE_MAX_MULTIPLIER = 0.95; // placeholder
const PANEL_UNDERPERFORMANCE_MIN_MONTHS = 1; // placeholder
const PANEL_UNDERPERFORMANCE_MAX_MONTHS = 3; // placeholder
// Triggering condition grounded in the real-world principle that
// voltage/power-quality problems increase near a service's rated capacity —
// see EVENT_TABLE's power_quality_issue entry.
const POWER_QUALITY_ISSUE_HEADROOM_USAGE_THRESHOLD = 0.85;
const POWER_QUALITY_ISSUE_COST_MIN = 1_000; // placeholder
const POWER_QUALITY_ISSUE_COST_MAX = 3_000; // placeholder
// Grounded in real 8yr/100k-mile EV drivetrain warranty coverage — see
// EVENT_TABLE's ev_drivetrain_failure entry.
const EV_DRIVETRAIN_WARRANTY_THRESHOLD_MONTHS = 96; // 8 years
// ~6x: 0.001/vehicle/month within warranty -> ~0.006/vehicle/month after,
// same "multiplier off the table's baseMonthlyProbability" pattern as
// inverter_failure's INVERTER_FAILURE_LATE_LIFE_MULTIPLIER — keeps this
// force-testable via EVENT_TABLE rather than a second hardcoded constant.
const EV_DRIVETRAIN_FAILURE_POST_WARRANTY_MULTIPLIER = 6;
const EV_DRIVETRAIN_FAILURE_COST_WARRANTY_MIN = 1_500; // placeholder — deductible/minor uncovered item
const EV_DRIVETRAIN_FAILURE_COST_WARRANTY_MAX = 4_000; // placeholder
const EV_DRIVETRAIN_FAILURE_COST_POST_WARRANTY_MIN = 4_000; // placeholder, grounded in real ESB maintenance-savings research
const EV_DRIVETRAIN_FAILURE_COST_POST_WARRANTY_MAX = 10_000; // placeholder
// short_outage/extended_outage — see EVENT_TABLE's entries. No battery
// storage or backup generator system exists in this sim, so both apply
// their full effect with no mitigation.
const SHORT_OUTAGE_MIN_UPTIME_REDUCTION = 2; // placeholder
const SHORT_OUTAGE_MAX_UPTIME_REDUCTION = 4; // placeholder
const EXTENDED_OUTAGE_MIN_UPTIME_REDUCTION = 8; // placeholder
const EXTENDED_OUTAGE_MAX_UPTIME_REDUCTION = 15; // placeholder
const EXTENDED_OUTAGE_COST_MIN = 500; // placeholder — lost productivity/cleanup, not a repair cost
const EXTENDED_OUTAGE_COST_MAX = 1_500; // placeholder

function randomIntInclusive(min: number, max: number): number {
  return min + Math.floor(Math.random() * (max - min + 1));
}

function findEventTableEntry(type: EventType) {
  const entry = EVENT_TABLE.find((e) => e.type === type);
  if (!entry) throw new Error(`Missing EVENT_TABLE entry for ${type}`);
  return entry;
}

/**
 * Averages the last `months` entries of uptimeHistory (fewer if the game
 * hasn't run that long yet). Returns 100 on a fresh game with empty
 * history — matches the "zero failures" baseline that both uptimePercent
 * and trailingUptimeAverage otherwise start at, rather than NaN or 0.
 */
export function computeTrailingUptimeAverage(state: GameState, months = 3): number {
  const history = state.sim.uptimeHistory;
  if (history.length === 0) return 100;
  const window = history.slice(-months);
  return window.reduce((sum, v) => sum + v, 0) / window.length;
}

/**
 * Updates route.batterySohPercent from ev-thermal-sim's seam-table data
 * (src/seamTable.ts, generated from that sibling project's
 * examples/generate_seam_table.py) — track-only for now, no cash/uptime/
 * cash-flow consequence wired to this value yet. Looks up the seam-table
 * row via fleet.vehicleClasses[0].manufacturerProfileKey, a v1
 * simplification: routes don't carry their own vehicle-class reference
 * (see manufacturerProfileKey's own doc comment in types.ts), so this only
 * gives correct per-route data for a single-vehicle-class fleet, true of
 * both presets today. Leaves batterySohPercent null (a no-op) when the
 * fleet's vehicle class has no manufacturerProfileKey, or no seam-table row
 * matches it. monthsSinceConversion is clamped to the row's own
 * monthlySohDeltaPct length (its sourceDurationYears × 12) — a run longer
 * than the table's horizon keeps the last cumulative loss rather than
 * extrapolating past data ev-thermal-sim never generated.
 */
function updateRouteBatterySohPercent(facility: FacilityProfile, route: Route, monthsSinceConversion: number): void {
  const manufacturerProfileKey = facility.fleet.vehicleClasses[0]?.manufacturerProfileKey;
  if (!manufacturerProfileKey) return;
  const seamRow = SEAM_TABLE_ROWS.find((row) => row.vehicleClass === manufacturerProfileKey);
  if (!seamRow) return;

  if (monthsSinceConversion <= 0) {
    route.batterySohPercent = 100;
    return;
  }
  const monthsElapsed = Math.min(monthsSinceConversion, seamRow.monthlySohDeltaPct.length);
  const cumulativeLossPct = seamRow.monthlySohDeltaPct.slice(0, monthsElapsed).reduce((sum, v) => sum + v, 0);
  route.batterySohPercent = 100 - cumulativeLossPct;
}

/**
 * Step 4 of the tick sequence design ("event roll") — proof of mechanism
 * with exactly the two EVENT_TABLE entries; see that constant's comment for
 * what's deliberately NOT built yet (the rest of the event table, severity
 * tiers, seasonality weighting, state-dependent probability modifiers).
 * Called from advanceOneMonth after financial settlement and before the
 * insolvency check, so an event's cash impact this month is caught by that
 * same month's check rather than deferred a tick.
 */
export function rollEvents(state: GameState): void {
  const sim = state.sim;
  // Tracks how many vehicle-failure events fire during THIS call, so the
  // uptime bookkeeping at the end can count them without threading a counter
  // through every individual roll block below.
  const eventLogLengthBeforeThisTick = sim.eventLog.length;

  // diesel_price_shock: one roll per tick, independent of fleet composition.
  const priceShockEntry = findEventTableEntry("diesel_price_shock");
  if (Math.random() < priceShockEntry.baseMonthlyProbability) {
    const magnitude = DIESEL_PRICE_SHOCK_MIN_MAGNITUDE + Math.random() * (DIESEL_PRICE_SHOCK_MAX_MAGNITUDE - DIESEL_PRICE_SHOCK_MIN_MAGNITUDE);
    const sign = Math.random() < 0.5 ? -1 : 1;
    const before = sim.dieselPriceMultiplier;
    const after = Math.max(DIESEL_PRICE_MULTIPLIER_FLOOR, before * (1 + sign * magnitude));
    sim.dieselPriceMultiplier = after;
    sim.eventLog.push({
      month: sim.month,
      year: sim.year,
      type: "diesel_price_shock",
      effect: `Diesel price shock: dieselPriceMultiplier ${before.toFixed(2)} -> ${after.toFixed(2)} (${sign > 0 ? "+" : "-"}${(magnitude * 100).toFixed(1)}%)`,
    });
  }

  // equipment_failure_diesel: one independent roll per vehicle class that
  // still has at least one unconverted vehicle. "Unconverted" is tracked
  // per-route (Route.converted), not on VehicleClass itself, so this sums
  // dedicatedVehicleCount across every not-yet-converted route to determine
  // whether a class still has diesel exposure — with this preset's single
  // "school_bus" class, that's effectively one roll per tick until every
  // route converts. Electrified vehicles never roll this event.
  const failureEntry = findEventTableEntry("equipment_failure_diesel");
  const equipmentFailureProbability =
    sim.maintenanceStrategy === "preventative"
      ? failureEntry.baseMonthlyProbability * FLEET_MAINTENANCE_PREVENTATIVE_FAILURE_MULTIPLIER
      : failureEntry.baseMonthlyProbability;
  for (const vehicleClass of state.facility.fleet.vehicleClasses) {
    if (vehicleClass.currentFuelType !== "diesel") continue;
    const unconvertedCount = state.facility.fleet.routes
      .filter((r) => !r.converted)
      .reduce((sum, r) => sum + r.dedicatedVehicleCount, 0);
    if (unconvertedCount <= 0) continue;
    if (Math.random() < equipmentFailureProbability) {
      const cost = EQUIPMENT_FAILURE_COST_MIN + Math.random() * (EQUIPMENT_FAILURE_COST_MAX - EQUIPMENT_FAILURE_COST_MIN);
      sim.cash -= cost;
      sim.eventLog.push({
        month: sim.month,
        year: sim.year,
        type: "equipment_failure_diesel",
        effect: `Diesel equipment failure (${vehicleClass.class}): $${cost.toFixed(0)} unplanned repair cost (${unconvertedCount} buses still diesel)`,
      });
    }
  }

  // electricity_rate_increase: one roll per tick, independent of fleet/loan
  // state. Compounds naturally since it multiplies the current (possibly
  // already-raised) rate rather than resetting to a base value.
  const rateIncreaseEntry = findEventTableEntry("electricity_rate_increase");
  if (Math.random() < rateIncreaseEntry.baseMonthlyProbability) {
    const magnitude = ELECTRICITY_RATE_INCREASE_MIN_MAGNITUDE + Math.random() * (ELECTRICITY_RATE_INCREASE_MAX_MAGNITUDE - ELECTRICITY_RATE_INCREASE_MIN_MAGNITUDE);
    const before = sim.electricityRatePerKWh;
    const after = before * (1 + magnitude);
    sim.electricityRatePerKWh = after;
    sim.eventLog.push({
      month: sim.month,
      year: sim.year,
      type: "electricity_rate_increase",
      effect: `Electricity rate increase: $${before.toFixed(4)}/kWh -> $${after.toFixed(4)}/kWh (+${(magnitude * 100).toFixed(1)}%)`,
    });
  }

  // interest_rate_movement: one roll per tick; shifts every
  // loanTermsAvailable entry's APR by the same delta (one market-wide
  // movement, not an independent roll per term). Only affects FUTURE
  // originations and refinances — each ActiveLoan stores its own locked-in
  // apr/monthlyPayment at the moment it originated or was last refinanced
  // (see commitToRouteConversion's debt branch and refinanceLoan()), and
  // totalMonthlyDebtService is a derived sum over those per-loan values
  // (see types.ts), never recalculated from the live rate table on its own
  // — so a rate movement changes what a NEW loan or refinance would cost,
  // never an existing loan's payment until the player actively refinances it.
  const interestMovementEntry = findEventTableEntry("interest_rate_movement");
  if (Math.random() < interestMovementEntry.baseMonthlyProbability) {
    const deltaPP = INTEREST_RATE_MOVEMENT_MIN_PP + Math.random() * (INTEREST_RATE_MOVEMENT_MAX_PP - INTEREST_RATE_MOVEMENT_MIN_PP);
    const sign = Math.random() < 0.5 ? -1 : 1;
    const delta = sign * deltaPP;
    const shifts: string[] = [];
    for (const term of state.facility.finance.loanTermsAvailable) {
      const before = term.apr;
      term.apr = Math.max(LOAN_APR_FLOOR, before + delta);
      shifts.push(`${term.key} ${(before * 100).toFixed(2)}%->${(term.apr * 100).toFixed(2)}%`);
    }
    sim.eventLog.push({
      month: sim.month,
      year: sim.year,
      type: "interest_rate_movement",
      effect: `Interest rate movement (${sign > 0 ? "+" : "-"}${(deltaPP * 100).toFixed(2)}pp): ${shifts.join(", ")} — existing debt keeps its original rate`,
    });
  }

  // demand_spike_billing: one roll per tick; simplified stand-in for real
  // demand-charge billing — see EVENT_TABLE's comment on this entry for why
  // full grid event modeling is deferred.
  const demandSpikeEntry = findEventTableEntry("demand_spike_billing");
  if (Math.random() < demandSpikeEntry.baseMonthlyProbability) {
    const cost = DEMAND_SPIKE_COST_MIN + Math.random() * (DEMAND_SPIKE_COST_MAX - DEMAND_SPIKE_COST_MIN);
    sim.cash -= cost;
    sim.eventLog.push({
      month: sim.month,
      year: sim.year,
      type: "demand_spike_billing",
      effect: `Demand spike billing (simplified): $${cost.toFixed(0)} one-time cost`,
    });
  }

  // incentive_program_closes_early: can only fire once per game, and only
  // while we're still before the (current) safe-harbor deadline — firing
  // after it's already passed would mean moving a deadline that no longer
  // matters. Moving it up is applied immediately: any pending solarInstall
  // whose equipment draw hasn't fired yet gets re-evaluated against
  // currentItcRate() (the SAME function commitToSolarInstall used at commit
  // time — not duplicated here) and loses its ITC discount if it now falls
  // after the moved-up deadline, exactly as if it had committed too late.
  const closureEntry = findEventTableEntry("incentive_program_closes_early");
  if (!sim.incentiveProgramClosedEarlyFired) {
    const now = monthOrdinal(sim.month, sim.year);
    const currentDeadlineOrdinal = monthOrdinal(sim.safeHarborDeadline.month, sim.safeHarborDeadline.year);
    if (now < currentDeadlineOrdinal && Math.random() < closureEntry.baseMonthlyProbability) {
      const monthsEarlier = randomIntInclusive(INCENTIVE_CLOSURE_MIN_MONTHS, INCENTIVE_CLOSURE_MAX_MONTHS);
      const newDeadline = dateFromOrdinal(currentDeadlineOrdinal - monthsEarlier);
      sim.safeHarborDeadline = newDeadline;
      sim.incentiveProgramClosedEarlyFired = true;

      const revokedActionIds: string[] = [];
      for (const action of sim.pendingActions) {
        if (action.type !== "solarInstall") continue;
        const drawIndex = action.costSchedule.findIndex((d) => d.month === SOLAR_EQUIPMENT_DRAW_MONTH);
        const monthsElapsed = action.monthsOriginal - action.monthsRemaining;
        if (drawIndex === -1 || monthsElapsed >= SOLAR_EQUIPMENT_DRAW_MONTH) continue; // draw already fired (or doesn't exist) -- too late to revoke that money
        const newItcRate = currentItcRate(state);
        if (newItcRate === action.itcRateApplied) continue; // no change -- already ineligible, or somehow still eligible
        const totalCost = action.sizedKW * SOLAR_COST_PER_KW_PLACEHOLDER;
        action.costSchedule[drawIndex] = { month: SOLAR_EQUIPMENT_DRAW_MONTH, amount: totalCost * SOLAR_EQUIPMENT_FRACTION * (1 - newItcRate), paid: false };
        action.itcRateApplied = newItcRate;
        revokedActionIds.push(action.id);
      }

      sim.eventLog.push({
        month: sim.month,
        year: sim.year,
        type: "incentive_program_closes_early",
        effect:
          `Incentive program closes early: federal ITC safe-harbor deadline moved up ${monthsEarlier} month(s), now ${formatDate(newDeadline.month, newDeadline.year)}` +
          (revokedActionIds.length > 0
            ? `; revoked ITC eligibility on pending solarInstall action(s): ${revokedActionIds.join(", ")}`
            : "; no pending solarInstall action's remaining draws were affected"),
      });
    }
  }

  // permitting_delay: rolled INDEPENDENTLY against each currently-pending
  // action that has a real lead time (not once globally) -- a large fleet of
  // simultaneous commitments can each be delayed independently.
  const delayEntry = findEventTableEntry("permitting_delay");
  for (const action of sim.pendingActions) {
    if (!PERMITTING_DELAY_ELIGIBLE_TYPES.includes(action.type)) continue;
    if (Math.random() < delayEntry.baseMonthlyProbability) {
      const delayMonths = randomIntInclusive(PERMITTING_DELAY_MIN_MONTHS, PERMITTING_DELAY_MAX_MONTHS);
      action.monthsRemaining += delayMonths; // monthsOriginal deliberately untouched -- slip stays visible against the original estimate
      sim.eventLog.push({
        month: sim.month,
        year: sim.year,
        type: "permitting_delay",
        effect: `Permitting delay: ${action.label} (${action.type}, id=${action.id}) delayed ${delayMonths} month(s) — ${action.monthsRemaining} of ${action.monthsOriginal} original months now remaining`,
      });
    }
  }

  // utility_pilot_program: one roll per tick, independent of fleet/loan
  // state. isPilotProgramParticipant is stored but deliberately not wired to
  // any further consequence this pass — see EVENT_TABLE's comment.
  const pilotProgramEntry = findEventTableEntry("utility_pilot_program");
  if (Math.random() < pilotProgramEntry.baseMonthlyProbability) {
    const cashInflow = randomIntInclusive(UTILITY_PILOT_PROGRAM_MIN_CASH, UTILITY_PILOT_PROGRAM_MAX_CASH);
    sim.cash += cashInflow;
    sim.isPilotProgramParticipant = true;
    sim.eventLog.push({
      month: sim.month,
      year: sim.year,
      type: "utility_pilot_program",
      effect: `Utility pilot program: $${cashInflow} one-time cash inflow; district is now a pilot program participant`,
    });
  }

  // grant_bulk_purchase_opportunity: one roll per tick; adds directly to the
  // grant program's remaining pool without touching any existing
  // reservation, and doesn't require a pending action to exist.
  const bulkPurchaseEntry = findEventTableEntry("grant_bulk_purchase_opportunity");
  if (Math.random() < bulkPurchaseEntry.baseMonthlyProbability) {
    const program = state.facility.environment.incentivePrograms.find((p) => p.key === GRANT_PROGRAM_KEY);
    if (program) {
      const poolAddition = randomIntInclusive(GRANT_BULK_PURCHASE_MIN_AMOUNT, GRANT_BULK_PURCHASE_MAX_AMOUNT);
      const before = program.totalGrantFundingAvailable;
      program.totalGrantFundingAvailable += poolAddition;
      sim.eventLog.push({
        month: sim.month,
        year: sim.year,
        type: "grant_bulk_purchase_opportunity",
        effect: `Grant bulk purchase opportunity: +$${poolAddition} added to the grant funding pool ($${before} -> $${program.totalGrantFundingAvailable})`,
      });
    }
  }

  // ev_price_decline: one roll per tick, independent of fleet/loan state.
  // Compounds naturally (multiplies the current, possibly already-reduced
  // price) exactly like electricity_rate_increase. evCostPerVehicle is read
  // fresh at commit time by computeGrantFinancingProjection and
  // commitToRouteConversion, so this never retroactively touches an
  // already-committed routeConversion's baked-in cost draws. Started from
  // the active preset's own fleet.vehicleEconomics.costPerVehiclePlaceholder
  // in createNewGame(), so each preset compounds independently from its own
  // starting value, not a shared global.
  const evPriceDeclineEntry = findEventTableEntry("ev_price_decline");
  if (Math.random() < evPriceDeclineEntry.baseMonthlyProbability) {
    const magnitude = EV_PRICE_DECLINE_MIN_MAGNITUDE + Math.random() * (EV_PRICE_DECLINE_MAX_MAGNITUDE - EV_PRICE_DECLINE_MIN_MAGNITUDE);
    const before = sim.evCostPerVehicle;
    const after = before * (1 - magnitude);
    sim.evCostPerVehicle = after;
    sim.eventLog.push({
      month: sim.month,
      year: sim.year,
      type: "ev_price_decline",
      effect: `EV price decline: evCostPerVehicle $${before.toFixed(0)} -> $${after.toFixed(0)} (-${(magnitude * 100).toFixed(1)}%)`,
    });
  }

  // charger_hardware_failure: rolled independently once per full 20kW band
  // of installedChargerKW -- a simplification for "more hardware, more
  // chances something breaks," not a real per-unit failure-rate model. Cash
  // cost only this pass; installedChargerKW/reservedChargerCapacityKW are
  // deliberately untouched (no capacity-loss mechanic this pass).
  const chargerFailureEntry = findEventTableEntry("charger_hardware_failure");
  const failureBands = Math.floor(sim.installedChargerKW / CHARGER_HARDWARE_FAILURE_BAND_KW);
  for (let band = 0; band < failureBands; band++) {
    if (Math.random() < chargerFailureEntry.baseMonthlyProbability) {
      const cost = randomIntInclusive(CHARGER_HARDWARE_FAILURE_COST_MIN, CHARGER_HARDWARE_FAILURE_COST_MAX);
      sim.cash -= cost;
      sim.eventLog.push({
        month: sim.month,
        year: sim.year,
        type: "charger_hardware_failure",
        effect: `Charger hardware failure: $${cost} repair cost (installedChargerKW=${sim.installedChargerKW}, band ${band + 1} of ${failureBands})`,
      });
    }
  }

  // inverter_failure: only rolls once a solarInstall has completed (no
  // solar, no inverter, no roll). One roll per tick; probability jumps x5
  // once the most recently completed array passes 120 months (10 years)
  // since completion — grounded in real inverter lifespan research (10-15yr
  // typical replacement window). Only tracks the most recent completed
  // solarInstall — see SimState.solarCompletionOrdinal's doc comment.
  const inverterFailureEntry = findEventTableEntry("inverter_failure");
  if (sim.solarCompletionOrdinal !== null && sim.solarSystemOriginalCost !== null) {
    const monthsSinceCompletion = monthOrdinal(sim.month, sim.year) - sim.solarCompletionOrdinal;
    const isLateLife = monthsSinceCompletion > INVERTER_FAILURE_LATE_LIFE_THRESHOLD_MONTHS;
    const probability = isLateLife
      ? inverterFailureEntry.baseMonthlyProbability * INVERTER_FAILURE_LATE_LIFE_MULTIPLIER
      : inverterFailureEntry.baseMonthlyProbability;
    if (Math.random() < probability) {
      const fraction = INVERTER_FAILURE_COST_MIN_FRACTION + Math.random() * (INVERTER_FAILURE_COST_MAX_FRACTION - INVERTER_FAILURE_COST_MIN_FRACTION);
      const cost = sim.solarSystemOriginalCost * fraction;
      sim.cash -= cost;
      sim.eventLog.push({
        month: sim.month,
        year: sim.year,
        type: "inverter_failure",
        effect: `Inverter failure: $${cost.toFixed(0)} replacement cost (${(fraction * 100).toFixed(1)}% of $${sim.solarSystemOriginalCost.toFixed(0)} original system cost, ${monthsSinceCompletion} months since completion${isLateLife ? ", late-life x5 rate" : ""})`,
      });
    }
  }

  // grant_program_funding_cut: fires at most once per game. Only reduces the
  // UNRESERVED remaining balance — totalGrantFundingAvailable already
  // excludes anything reserved at commit time (see commitToRouteConversion's
  // grant branch), so amounts tied to pending/completed grant-financed
  // commits are never touched by this cut.
  const fundingCutEntry = findEventTableEntry("grant_program_funding_cut");
  if (!sim.grantProgramFundingCutFired && Math.random() < fundingCutEntry.baseMonthlyProbability) {
    sim.grantProgramFundingCutFired = true;
    const program = state.facility.environment.incentivePrograms.find((p) => p.key === GRANT_PROGRAM_KEY);
    if (program) {
      const cutFraction = GRANT_FUNDING_CUT_MIN_FRACTION + Math.random() * (GRANT_FUNDING_CUT_MAX_FRACTION - GRANT_FUNDING_CUT_MIN_FRACTION);
      const before = program.totalGrantFundingAvailable;
      const cutAmount = before * cutFraction;
      program.totalGrantFundingAvailable = before - cutAmount;
      sim.eventLog.push({
        month: sim.month,
        year: sim.year,
        type: "grant_program_funding_cut",
        effect: `Grant program funding cut: -${(cutFraction * 100).toFixed(1)}% of remaining pool ($${before.toFixed(0)} -> $${program.totalGrantFundingAvailable.toFixed(0)}) — reserved amounts on pending/completed actions untouched`,
      });
    }
  }

  // panel_underperformance: only rolls once solar exists, and only if no
  // episode is already active (a fresh roll while one is running is ignored
  // rather than restarting/extending it — see EVENT_TABLE's comment).
  const panelUnderperformanceEntry = findEventTableEntry("panel_underperformance");
  if (sim.solarCapacityKW > 0 && sim.panelUnderperformanceMonthsRemaining === 0) {
    if (Math.random() < panelUnderperformanceEntry.baseMonthlyProbability) {
      const multiplier = PANEL_UNDERPERFORMANCE_MIN_MULTIPLIER + Math.random() * (PANEL_UNDERPERFORMANCE_MAX_MULTIPLIER - PANEL_UNDERPERFORMANCE_MIN_MULTIPLIER);
      const durationMonths = randomIntInclusive(PANEL_UNDERPERFORMANCE_MIN_MONTHS, PANEL_UNDERPERFORMANCE_MAX_MONTHS);
      sim.panelUnderperformanceMultiplier = multiplier;
      sim.panelUnderperformanceMonthsRemaining = durationMonths;
      sim.eventLog.push({
        month: sim.month,
        year: sim.year,
        type: "panel_underperformance",
        effect: `Panel underperformance: generation reduced to ${(multiplier * 100).toFixed(1)}% of normal for ${durationMonths} month(s), starting next tick`,
      });
    }
  }

  // power_quality_issue: only rolls at all once reservedInterconnectionKW /
  // interconnectionHeadroomKW exceeds the threshold — 0 probability below it,
  // not just a lower one.
  const powerQualityEntry = findEventTableEntry("power_quality_issue");
  const interconnectionHeadroomKW = computeInterconnectionHeadroomKW(state.facility);
  const headroomUsageRatio = interconnectionHeadroomKW > 0 ? sim.reservedInterconnectionKW / interconnectionHeadroomKW : 0;
  if (headroomUsageRatio > POWER_QUALITY_ISSUE_HEADROOM_USAGE_THRESHOLD) {
    if (Math.random() < powerQualityEntry.baseMonthlyProbability) {
      const cost = randomIntInclusive(POWER_QUALITY_ISSUE_COST_MIN, POWER_QUALITY_ISSUE_COST_MAX);
      sim.cash -= cost;
      sim.eventLog.push({
        month: sim.month,
        year: sim.year,
        type: "power_quality_issue",
        effect: `Power quality issue: $${cost} diagnostic/repair cost (interconnection usage ${(headroomUsageRatio * 100).toFixed(1)}%, above the ${(POWER_QUALITY_ISSUE_HEADROOM_USAGE_THRESHOLD * 100).toFixed(0)}% threshold)`,
      });
    }
  }

  // ev_drivetrain_failure: only rolls per route where converted === true,
  // independently per vehicle in that route (dedicatedVehicleCount rolls per
  // tick for a fully-converted route). Probability and cost both jump at the
  // 96-month (8-year) real EV drivetrain warranty boundary — see
  // EVENT_TABLE's comment for the research this is grounded in.
  const drivetrainFailureEntry = findEventTableEntry("ev_drivetrain_failure");
  const nowOrdinal = monthOrdinal(sim.month, sim.year);
  for (const route of state.facility.fleet.routes) {
    if (!route.converted || route.conversionCompletionOrdinal === null) continue;
    const monthsSinceConversion = nowOrdinal - route.conversionCompletionOrdinal;

    updateRouteBatterySohPercent(state.facility, route, monthsSinceConversion);

    const isPostWarranty = monthsSinceConversion > EV_DRIVETRAIN_WARRANTY_THRESHOLD_MONTHS;
    let probability = isPostWarranty
      ? drivetrainFailureEntry.baseMonthlyProbability * EV_DRIVETRAIN_FAILURE_POST_WARRANTY_MULTIPLIER
      : drivetrainFailureEntry.baseMonthlyProbability;
    if (sim.maintenanceStrategy === "preventative") {
      probability *= FLEET_MAINTENANCE_PREVENTATIVE_FAILURE_MULTIPLIER;
    }
    for (let vehicle = 0; vehicle < route.dedicatedVehicleCount; vehicle++) {
      if (Math.random() < probability) {
        const cost = isPostWarranty
          ? randomIntInclusive(EV_DRIVETRAIN_FAILURE_COST_POST_WARRANTY_MIN, EV_DRIVETRAIN_FAILURE_COST_POST_WARRANTY_MAX)
          : randomIntInclusive(EV_DRIVETRAIN_FAILURE_COST_WARRANTY_MIN, EV_DRIVETRAIN_FAILURE_COST_WARRANTY_MAX);
        sim.cash -= cost;
        sim.eventLog.push({
          month: sim.month,
          year: sim.year,
          type: "ev_drivetrain_failure",
          effect: `EV drivetrain failure (${route.label}): $${cost} repair cost (${monthsSinceConversion} months since conversion, ${isPostWarranty ? "post-warranty" : "within warranty"})`,
        });
      }
    }
  }

  // short_outage / extended_outage: grid outages, unblocked by real uptime
  // tracking (4.9/4.10). No battery storage or backup generator system
  // exists in this sim, so both apply their full effect with no mitigation
  // — either, if ever built, would reduce these events' impact. Roll
  // independently (NOT mutually exclusive); their uptime-point reductions
  // accumulate here and are applied ON TOP OF the failure-count-based
  // calculation below, before the shared uptime floor.
  let outageUptimeReduction = 0;
  const shortOutageEntry = findEventTableEntry("short_outage");
  if (Math.random() < shortOutageEntry.baseMonthlyProbability) {
    const reduction = SHORT_OUTAGE_MIN_UPTIME_REDUCTION + Math.random() * (SHORT_OUTAGE_MAX_UPTIME_REDUCTION - SHORT_OUTAGE_MIN_UPTIME_REDUCTION);
    outageUptimeReduction += reduction;
    sim.eventLog.push({
      month: sim.month,
      year: sim.year,
      type: "short_outage",
      effect: `Short outage: -${reduction.toFixed(1)} uptime points this month (no mitigation available — battery storage, if ever built, would reduce this event's impact)`,
    });
  }
  const extendedOutageEntry = findEventTableEntry("extended_outage");
  if (Math.random() < extendedOutageEntry.baseMonthlyProbability) {
    const reduction = EXTENDED_OUTAGE_MIN_UPTIME_REDUCTION + Math.random() * (EXTENDED_OUTAGE_MAX_UPTIME_REDUCTION - EXTENDED_OUTAGE_MIN_UPTIME_REDUCTION);
    const cost = randomIntInclusive(EXTENDED_OUTAGE_COST_MIN, EXTENDED_OUTAGE_COST_MAX);
    outageUptimeReduction += reduction;
    sim.cash -= cost;
    sim.eventLog.push({
      month: sim.month,
      year: sim.year,
      type: "extended_outage",
      effect: `Extended outage: -${reduction.toFixed(1)} uptime points this month, $${cost} lost productivity/cleanup cost (no mitigation available — battery storage, if ever built, would reduce this event's impact)`,
    });
  }

  // Uptime bookkeeping — a real, per-month value as of this pass, not the
  // old static placeholder. Only counts vehicle-failure events (diesel
  // equipment failures, EV drivetrain failures) that fired THIS tick;
  // infrastructure events (charger/inverter/panel failures, power quality
  // issues) don't count here since those affect equipment, not fleet
  // service delivery directly. A month with zero such failures (and no
  // outage this month) reads 100. outageUptimeReduction (short_outage /
  // extended_outage, possibly both, stacked) is subtracted on top of the
  // failure-count-based hit before the shared floor is applied. No failure/
  // game-over threshold is wired to this yet — deliberately deferred, same
  // pattern as insolvency detection (3.8) preceding its own consequences.
  const vehicleFailureEventCount = sim.eventLog
    .slice(eventLogLengthBeforeThisTick)
    .filter((e) => e.type === "equipment_failure_diesel" || e.type === "ev_drivetrain_failure").length;
  sim.uptimePercent = Math.max(
    UPTIME_FLOOR_PERCENT,
    100 - vehicleFailureEventCount * UPTIME_IMPACT_PER_FAILURE_PLACEHOLDER - outageUptimeReduction,
  );
  sim.uptimeHistory.push(sim.uptimePercent);
  if (sim.uptimeHistory.length > UPTIME_HISTORY_MAX_ENTRIES) {
    sim.uptimeHistory.shift();
  }

  // Trailing-average warning system (4.10): purely informational this pass —
  // see SimState.uptimeWarningLevel's doc comment for why the original
  // design's harder "lose a customer contract" consequence is deferred
  // rather than built here.
  sim.trailingUptimeAverage = computeTrailingUptimeAverage(state);
  sim.uptimeWarningLevel =
    sim.trailingUptimeAverage < UPTIME_POOR_THRESHOLD ? "poor" : sim.trailingUptimeAverage < UPTIME_WARNING_THRESHOLD ? "warning" : "normal";
}

/** One simulated month. Advances every pending commitment, draws any cost due this month, applies pool effects (solar/charger capacity, interconnection headroom, spare conduit, route conversion + electrificationRate) for anything that just completed, settles the placeholder opex, then rolls for events (see rollEvents). */
export function advanceOneMonth(state: GameState): void {
  const sim = state.sim;

  // Hard stop: once a game-over condition has been reached, no further month
  // may advance — checked first, before any draws/opex/completion effects,
  // not after. Only checked here (not also gated at each caller) since every
  // caller (the rAF speed-controlled clock in main.ts, tests) routes through
  // this single function to advance time. finalOutcome halts the same way —
  // it's a natural endpoint (the year-YEARS_TO_EVALUATE checkpoint), not a
  // failure, which is why it's a separate field rather than overloading
  // gameOverReason, but the tick loop stops for either one identically.
  if (sim.gameOverReason || sim.finalOutcome) return;

  sim.month += 1;
  if (sim.month > 12) {
    sim.month = 1;
    sim.year += 1;
  }

  const completed: CommittedAction[] = [];
  for (const action of sim.pendingActions) {
    action.monthsRemaining -= 1;
    const monthsElapsed = action.monthsOriginal - action.monthsRemaining;
    // Fires each draw at most once, by month reached rather than exact
    // equality: monthsElapsed normally increases by exactly 1 per tick, so
    // ">=" and "===" agree in the common case, but ">=" plus the paid flag
    // is what keeps this safe if anything (permitting_delay today; any
    // hypothetical future expedite mechanic) ever moves monthsRemaining
    // without moving monthsOriginal, letting monthsElapsed count backward
    // and re-cross a draw's month. draw.paid is set true in the same step
    // as applying the cash effect, not after, so there's no reentrancy gap.
    for (const draw of action.costSchedule) {
      if (!draw.paid && monthsElapsed >= draw.month) {
        draw.paid = true;
        sim.cash -= draw.amount;
      }
    }
    if (action.monthsRemaining <= 0) completed.push(action);
  }
  if (completed.length > 0) {
    sim.pendingActions = sim.pendingActions.filter((a) => !completed.includes(a));
    let routeConverted = false;
    for (const action of completed) {
      // reservedInterconnectionKW and reservedChargerCapacityKW are NOT
      // touched here — they were already claimed at commit time (see
      // commitToSolarInstall/commitToChargerInstall/commitToRouteConversion).
      // Completion just leaves that reservation in place as the new
      // permanent baseline; adding to it again here would double-count it.
      sim.solarCapacityKW += action.onCompleteSolarCapacityKW;
      sim.installedChargerKW += action.onCompleteChargerCapacityKW;
      if (action.onCompleteInterconnectionHeadroomMultiplier !== 1) {
        state.facility.electrical.interconnectionHeadroom *= action.onCompleteInterconnectionHeadroomMultiplier;
      }
      if (action.installsSpareConduit) {
        sim.hasSpareConduit = true;
        sim.spareConduitCapacityKW += action.spareConduitCapacityKWOnComplete;
      }
      if (action.type === "routeConversion" && action.targetRouteId) {
        const route = state.facility.fleet.routes.find((r) => r.id === action.targetRouteId);
        if (route) {
          route.converted = true;
          // Feeds ev_drivetrain_failure's warranty-window check — same
          // "set at completion, derive months-since by subtraction" pattern
          // as SimState.solarCompletionOrdinal.
          route.conversionCompletionOrdinal = monthOrdinal(sim.month, sim.year);
        }
        routeConverted = true;
      }
      if (action.type === "solarInstall") {
        // Feeds inverter_failure's "months since completion" clock and cash-
        // cost basis. Only the MOST RECENT completed array is tracked (see
        // SimState.solarCompletionOrdinal's doc comment) — a simplification,
        // not a per-installation history.
        sim.solarCompletionOrdinal = monthOrdinal(sim.month, sim.year);
        sim.solarSystemOriginalCost = action.sizedKW * SOLAR_COST_PER_KW_PLACEHOLDER;
      }
    }
    if (routeConverted) recomputeElectrificationRate(state);
  }

  // Placeholder financial settlement: fixed monthly opex, offset by whatever
  // solar generated this month (if any). Excess generation is unused for
  // now — no net-metering sellback logic yet, that's a later pass. Real EV
  // fuel-cost avoidance lands once that decision exists to drive it. Debt
  // service itself isn't drawn here yet — loan payments aren't actually
  // debited from cash this pass (a later pass wires that); DSCR still uses
  // the real committed debt service for its own math regardless.
  sim.cash -= Math.max(0, computeMonthlyOperatingCashFlow(state));
  sim.dscr = computeDSCR(state);

  // If a panel_underperformance episode is active, this month's generation
  // (just settled above, using the multiplier while it was still active) was
  // reduced — now count down one real tick. Done here, once per tick, NOT
  // inside computeMonthlyOperatingCashFlow itself (see that function's doc
  // comment for why). Resets the multiplier back to a no-op the tick the
  // episode ends, so generation genuinely reverts rather than staying
  // permanently reduced.
  if (sim.panelUnderperformanceMonthsRemaining > 0) {
    sim.panelUnderperformanceMonthsRemaining -= 1;
    if (sim.panelUnderperformanceMonthsRemaining === 0) {
      sim.panelUnderperformanceMultiplier = 1;
    }
  }

  // Step 4: event roll — after financial settlement, before the insolvency
  // check, so an event firing this month (e.g. an equipment-failure cash
  // cost) is caught by that same month's check rather than deferred a tick.
  rollEvents(state);

  // Insolvency check happens last, after this month's draws/opex/savings AND
  // any event cash impact have all applied to cash — DSCR-breach and
  // uptime-based failure are separate, not-yet-wired future passes,
  // deliberately out of scope this pass.
  if (sim.cash < 0) {
    sim.consecutiveNegativeCashMonths += 1;
  } else {
    sim.consecutiveNegativeCashMonths = 0;
  }
  if (sim.consecutiveNegativeCashMonths >= INSOLVENCY_THRESHOLD_MONTHS) {
    sim.gameOverReason = "insolvency";
  }

  // Annual checkpoint (sim.month === 1, i.e. the start of each January tick
  // regardless of the game's September start date) — this pass only acts on
  // it at year YEARS_TO_EVALUATE, but the checkpoint itself is generic so a
  // future pass (e.g. a mid-run objective progress notification) can reuse
  // it without re-deriving "once per calendar year." Guarded by
  // finalOutcome === null even though month/year strictly increase and this
  // can only naturally match once, as defensive belt-and-suspenders
  // consistent with this sim's other one-shot flags.
  if (sim.month === 1 && sim.year === YEARS_TO_EVALUATE && sim.finalOutcome === null) {
    sim.finalOutcome = evaluateFinalOutcome(state);
  }
}

/**
 * The game's single, final outcome evaluation — called once, at the year-
 * YEARS_TO_EVALUATE annual checkpoint, from advanceOneMonth. Secondary
 * conditions are deliberately softer than the gates used elsewhere (see
 * DSCR_MINIMUM_FOR_SUCCESS/UPTIME_FLOOR_FOR_SUCCESS's comments in
 * constants.ts). If they don't hold, the tier is "unsuccessful" REGARDLESS
 * of how high electrificationRate climbed — matches the original design:
 * you can't hit the target by wrecking the business. The
 * customer-contract consequence from that same original design is NOT
 * built here — deferred, no clean analog for a municipal-fleet preset.
 */
export function evaluateFinalOutcome(state: GameState): FinalOutcome {
  const sim = state.sim;
  const rate = sim.electrificationRate;

  const solvent = sim.gameOverReason === null;
  const dscrOk = sim.dscr === null || sim.dscr >= DSCR_MINIMUM_FOR_SUCCESS;
  const uptimeOk = sim.trailingUptimeAverage >= UPTIME_FLOOR_FOR_SUCCESS;
  const conditionsMet = solvent && dscrOk && uptimeOk;

  let failedCondition: FailedSecondaryCondition = null;
  if (!solvent) failedCondition = "insolvent";
  else if (!dscrOk) failedCondition = "dscr_breach";
  else if (!uptimeOk) failedCondition = "uptime_floor";

  let tier: ObjectiveTier;
  if (!conditionsMet) {
    tier = "unsuccessful";
  } else if (rate >= OBJECTIVE_TIER_EXCEPTIONAL_MIN) {
    tier = "exceptional";
  } else if (rate >= OBJECTIVE_TIER_STRONG_MIN) {
    tier = "strong";
  } else if (rate >= OBJECTIVE_TIER_SUCCESSFUL_MIN) {
    tier = "successful";
  } else {
    tier = "unsuccessful";
  }

  return { tier, electrificationRate: rate, year: YEARS_TO_EVALUATE, conditionsMet, failedCondition };
}

/**
 * Releases a pending action's capacity/grant reservations and removes it
 * from the queue, for whenever a routeConversion or chargerInstall is
 * abandoned before completing. No cancellation UI exists yet this pass —
 * this function exists so a future cancel feature has a correct release
 * path to call rather than reinventing (and likely getting wrong) the
 * reservation math. Deliberately doesn't touch cash or debt: whether/how
 * much of an already-drawn deposit is refundable, or an originated loan is
 * unwound, on cancellation is that later feature's decision.
 */
/**
 * Switches SimState.maintenanceStrategy — an ongoing operating posture, not
 * a CommittedAction: no lead time, no cost draw here (the recurring cost
 * lives in computeMonthlyOperatingCashFlow, gated on the current strategy
 * each tick), reversible at any time. Logs a plain eventLog entry recording
 * the player's own decision (type "maintenance_strategy_changed") — not a
 * rollEvents() roll, just reusing the log for consistency with how every
 * other consequential choice is tracked. No-ops (and doesn't log) if the
 * requested strategy is already active, so toggling back and forth doesn't
 * spam duplicate entries for a non-change.
 */
export function setMaintenanceStrategy(state: GameState, strategy: "reactive" | "preventative"): void {
  const sim = state.sim;
  if (sim.maintenanceStrategy === strategy) return;
  const before = sim.maintenanceStrategy;
  sim.maintenanceStrategy = strategy;
  sim.eventLog.push({
    month: sim.month,
    year: sim.year,
    type: "maintenance_strategy_changed",
    effect: `Maintenance strategy changed: ${before} -> ${strategy} (player decision)`,
  });
}

export function cancelPendingAction(state: GameState, actionId: string): boolean {
  const action = state.sim.pendingActions.find((a) => a.id === actionId);
  if (!action) return false;

  state.sim.reservedInterconnectionKW -= action.reservedInterconnectionKWOnCommit;
  state.sim.reservedChargerCapacityKW -= action.reservedChargerCapacityKWOnCommit;
  if (action.reservedGrantFundingOnCommit > 0) {
    const program = state.facility.environment.incentivePrograms.find((p) => p.key === GRANT_PROGRAM_KEY);
    if (program) program.totalGrantFundingAvailable += action.reservedGrantFundingOnCommit;
  }

  state.sim.pendingActions = state.sim.pendingActions.filter((a) => a.id !== actionId);
  return true;
}
