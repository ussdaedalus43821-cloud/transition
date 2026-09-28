import type { TabModule } from "./types.js";
import { clamp, escapeHtml, gauge, money, pct, type GaugeTone } from "./format.js";
import {
  CHARGER_DESIGN_FRACTION,
  DSCR_MINIMUM_FOR_NEW_DEBT,
  FINAL_PLACED_IN_SERVICE_DEADLINE,
  FLEET_MAINTENANCE_PREVENTATIVE_FAILURE_MULTIPLIER,
  INTERCONNECTION_STUDY_MOBILIZATION_COST,
  INTERCONNECTION_STUDY_MONTHS,
  INTERCONNECTION_STUDY_TOTAL_COST,
  MAINTENANCE_PROGRAM_COST_PER_VEHICLE,
  OBJECTIVE_TIER_EXCEPTIONAL_MIN,
  OBJECTIVE_TIER_SUCCESSFUL_MIN,
  ROUTE_CONVERSION_DEPOSIT_FRACTION,
  ROUTE_CONVERSION_MONTHS,
  SERVICE_UPGRADE_MONTHS,
  SERVICE_UPGRADE_STUDY_FRACTION,
  SERVICE_UPGRADE_TOTAL_COST_PLACEHOLDER,
  SOLAR_COST_PER_KW_PLACEHOLDER,
  SOLAR_DESIGN_PERMIT_FRACTION,
  SOLAR_INSTALL_MONTHS,
  SPARE_CONDUIT_COST_MULTIPLIER,
  YEARS_TO_EVALUATE,
} from "../constants.js";
import {
  availableInterconnectionKW,
  canCommitAction,
  commitToChargerInstall,
  commitToInterconnectionStudy,
  commitToRouteConversion,
  commitToServiceUpgrade,
  commitToSolarInstall,
  computeArraySizing,
  computeChargerSizing,
  computeDebtFinancingProjection,
  computeGrantFinancingProjection,
  computeRefinanceProjection,
  currentItcRate,
  isActionPending,
  isRouteConvertedOrPending,
  refinanceLoan,
  requiredChargingKWForRoute,
  setMaintenanceStrategy,
  type BindingConstraint,
} from "../engine/engine.js";
import { formatDate, monthOrdinal } from "../engine/clock.js";
import type { ActiveLoan, ChargerType, CommittedAction, FinancingType, GameState, LoanTerm, Route } from "../types.js";

const CONSTRAINT_LABEL: Record<BindingConstraint, string> = {
  roof: "roof area",
  energyTarget: "energy offset target",
  interconnection: "interconnection headroom",
};

// Draft state for the charger-install form — like Rooftop's app.ts pickers,
// this lives outside GameState since it's an in-progress choice, not
// committed game state, and must survive the full-innerHTML re-renders that
// happen on every tick.
let chargerCountDraft = 1;
let chargerTypeDraft: ChargerType = "L2";
let spareConduitDraft = false;

// Per-route financing choice, same draft-state rationale as the charger form above.
const financingChoiceDraft: Record<string, FinancingType> = {};
function financingFor(routeId: string): FinancingType {
  return financingChoiceDraft[routeId] ?? "cash";
}

// Per-route loan term choice, once financing is "debt". Defaults to the
// first available term (matches computeDebtFinancingProjection's own default).
const loanTermChoiceDraft: Record<string, string> = {};
function loanTermKeyFor(routeId: string, terms: LoanTerm[]): string {
  return loanTermChoiceDraft[routeId] ?? terms[0].key;
}

// Per-loan refinance term choice (Phase 4.11), same draft-state rationale as
// the route financing drafts above — keyed by loan id, not route id, since
// a route's original loan and its post-refinance replacement are the same
// ActiveLoan entry throughout.
const refinanceTermChoiceDraft: Record<string, string> = {};
function refinanceTermKeyFor(loanId: string, terms: LoanTerm[]): string {
  return refinanceTermChoiceDraft[loanId] ?? terms[0].key;
}

function cashGauge(state: GameState): string {
  const { cash } = state.sim;
  const capital = state.facility.finance.availableCapital;
  const fraction = clamp(cash / (capital * 1.5), 0, 1);
  const tone: GaugeTone = cash < 0 ? "bad" : cash < capital * 0.25 ? "warn" : "good";
  return gauge("Cash", money(cash), fraction, tone, `starting capital ${money(capital)}`);
}

function electrificationGauge(state: GameState): string {
  const rate = state.sim.electrificationRate;
  const tone: GaugeTone = rate === 0 ? "info" : rate < 0.5 ? "warn" : "good";
  return gauge("Electrification Rate", pct(rate), rate, tone, `${state.facility.fleet.totalVehicles} vehicles in fleet`);
}

function dscrGauge(state: GameState): string {
  const { dscr } = state.sim;
  if (dscr === null) {
    return gauge("DSCR", "N/A", 0, "info", `no debt outstanding · ${DSCR_MINIMUM_FOR_NEW_DEBT} minimum once financed`);
  }
  const fraction = clamp(dscr / 2.5, 0, 1);
  const tone: GaugeTone = dscr >= DSCR_MINIMUM_FOR_NEW_DEBT ? "good" : dscr >= 1.0 ? "warn" : "bad";
  return gauge("DSCR", dscr.toFixed(2), fraction, tone, `minimum ${DSCR_MINIMUM_FOR_NEW_DEBT} for new debt · simplified cash-flow proxy, not real NOI`);
}

function uptimeGauge(state: GameState): string {
  const { uptimePercent, trailingUptimeAverage, uptimeWarningLevel } = state.sim;
  const tone: GaugeTone = uptimeWarningLevel === "poor" ? "bad" : uptimeWarningLevel === "warning" ? "warn" : "good";
  const statusLabel = uptimeWarningLevel === "poor" ? "Poor" : uptimeWarningLevel === "warning" ? "Warning" : "Normal";
  // Gauge shows the trend (trailing 3mo average), not just this month's
  // number — the hint line shows "what happened this month" alongside it.
  return gauge(
    "Uptime (3mo avg)",
    pct(trailingUptimeAverage / 100, 1),
    trailingUptimeAverage / 100,
    tone,
    `this month: ${pct(uptimePercent / 100, 1)} · ${statusLabel}`,
  );
}

function renderAction(action: CommittedAction): string {
  const progress = 1 - action.monthsRemaining / action.monthsOriginal;
  const elapsed = action.monthsOriginal - action.monthsRemaining;
  const remainingCost = action.costSchedule.filter((d) => d.month > elapsed).reduce((sum, d) => sum + d.amount, 0);
  return `<div class="commitment">
    <div class="commitment-head">
      <span class="commitment-label">${escapeHtml(action.label)}</span>
      <span class="commitment-months">${action.monthsRemaining} of ${action.monthsOriginal} months remaining</span>
    </div>
    <div class="track"><div class="fill" style="width:${(progress * 100).toFixed(1)}%;background:var(--accent)"></div></div>
    ${remainingCost > 0 ? `<div class="gh">${money(remainingCost)} still to be drawn on schedule</div>` : ""}
  </div>`;
}

function renderItcBanner(state: GameState): string {
  const now = monthOrdinal(state.sim.month, state.sim.year);
  const deadline = monthOrdinal(state.sim.safeHarborDeadline.month, state.sim.safeHarborDeadline.year);
  const monthsLeft = deadline - now;
  const safeHarborDate = formatDate(state.sim.safeHarborDeadline.month, state.sim.safeHarborDeadline.year);
  const finalDate = formatDate(FINAL_PLACED_IN_SERVICE_DEADLINE.month, FINAL_PLACED_IN_SERVICE_DEADLINE.year);

  if (monthsLeft > 0) {
    return `<div class="banner banner-info">
      <strong>${monthsLeft} month${monthsLeft === 1 ? "" : "s"}</strong> left to lock in the 30% federal ITC — safe-harbor deadline is ${escapeHtml(safeHarborDate)}.
      Anything that starts after that must be placed in service by ${escapeHtml(finalDate)} to qualify at all.
    </div>`;
  }
  return `<div class="banner banner-warn">
    Safe-harbor deadline (${escapeHtml(safeHarborDate)}) has passed — new solar commitments no longer qualify for the 30% ITC.
  </div>`;
}

// Milestone: usability pass (docs/DESIGN_QUESTIONS.md Q-0001) — a one-line
// orientation for a first-time player, using the real evaluateFinalOutcome
// thresholds directly (not restated numbers that could drift from them).
function renderMissionBanner(): string {
  return `<div class="banner banner-info" style="margin-bottom:12px;">
    <strong>Mission:</strong> convert ${pct(OBJECTIVE_TIER_SUCCESSFUL_MIN)}-${pct(OBJECTIVE_TIER_EXCEPTIONAL_MIN)} of your fleet to electric by year ${YEARS_TO_EVALUATE} — without going broke.
    Cash can't go negative for long, and your debt coverage (DSCR) and route uptime both have to stay above their minimums along the way — hitting the electrification target while wrecking the business doesn't count.
  </div>`;
}

// Milestone: usability pass (Q-0001) — was a single tiny, faint,
// easy-to-miss line showing only the very latest event; cash movements
// (equipment failures, rate shocks) were effectively invisible unless a
// player was staring at this exact spot at the right tick. Now a proper
// small panel, last 5 events, newest first — still purely presentational
// (SimState.eventLog already recorded every one of these; nothing new is
// computed here).
const RECENT_ACTIVITY_COUNT = 5;
function renderRecentActivityPanel(state: GameState): string {
  const log = state.sim.eventLog;
  if (log.length === 0) return "";
  const recent = log.slice(-RECENT_ACTIVITY_COUNT).reverse();
  return `<div class="card" style="margin-bottom:12px;">
    <h3>Recent Activity</h3>
    ${recent
      .map(
        (entry) =>
          `<div style="font-size:12.5px;padding:4px 0;border-top:1px solid var(--border);">
            <span class="text-faint">${escapeHtml(formatDate(entry.month, entry.year))}</span> — ${escapeHtml(entry.effect)}
          </div>`,
      )
      .join("")}
  </div>`;
}

function renderSolarSection(state: GameState): string {
  const sizing = computeArraySizing(state);
  const alreadyPending = isActionPending(state, "solarInstall");
  const itcRate = currentItcRate(state);
  const designDraw = sizing.sizedKW * SOLAR_COST_PER_KW_PLACEHOLDER * SOLAR_DESIGN_PERMIT_FRACTION;
  const blockedByInterconnection = sizing.bindingConstraint === "interconnection";
  const canCommit = !alreadyPending && !blockedByInterconnection && state.sim.cash >= designDraw;

  const disabledReason = alreadyPending
    ? "Already underway."
    : blockedByInterconnection
      ? `Blocked: interconnection headroom (${sizing.interconnectionHeadroomKW.toFixed(1)} kW) is capping array size below what the roof (${sizing.roofCapacityKW.toFixed(1)} kW) and your energy offset target (${sizing.energyTargetKW.toFixed(1)} kW) could otherwise support.`
      : !canCommit
        ? `Needs ${money(designDraw)} cash on hand for design/permitting.`
        : "";

  return `
  <div style="margin-top:14px;padding-top:14px;border-top:1px solid var(--border);">
    <h3 style="margin-bottom:4px;">Solar Array</h3>
    <div class="text-faint" style="font-size:12.5px;margin-bottom:6px;">Generates power that cuts your monthly electricity bill, and can qualify for the 30% federal tax credit (ITC) shown below if committed before the safe-harbor deadline.</div>
    <div class="text-faint" style="font-size:12.5px;">
      Projected array: <strong>${sizing.sizedKW.toFixed(1)} kW</strong> — sized by ${escapeHtml(CONSTRAINT_LABEL[sizing.bindingConstraint])}
      (roof ${sizing.roofCapacityKW.toFixed(1)} kW · energy target ${sizing.energyTargetKW.toFixed(1)} kW · interconnection ${sizing.interconnectionHeadroomKW.toFixed(1)} kW)
    </div>
    <div class="text-faint" style="font-size:12.5px;margin-top:2px;">
      ITC if committed now: <strong style="color:${itcRate > 0 ? "var(--good)" : "var(--bad)"}">${pct(itcRate)}</strong>
    </div>
    <div class="btn-row">
      <button class="btn btn-primary" data-action="overview:commitSolarInstall" ${canCommit ? "" : "disabled"}>
        Commit to Solar Array — ${SOLAR_INSTALL_MONTHS}mo, ${money(sizing.sizedKW * SOLAR_COST_PER_KW_PLACEHOLDER)} est.
      </button>
    </div>
    ${disabledReason ? `<div class="text-faint" style="font-size:11.5px;margin-top:6px;">${escapeHtml(disabledReason)}</div>` : ""}
    ${state.sim.solarCapacityKW > 0 ? `<div class="text-faint" style="font-size:11.5px;margin-top:6px;">Installed solar capacity: <strong>${state.sim.solarCapacityKW.toFixed(1)} kW</strong></div>` : ""}
  </div>`;
}

function renderServiceUpgradeSection(state: GameState): string {
  const alreadyPending = isActionPending(state, "serviceUpgrade");
  const designDraw = SERVICE_UPGRADE_TOTAL_COST_PLACEHOLDER * SERVICE_UPGRADE_STUDY_FRACTION;
  const canCommit = !alreadyPending && state.sim.cash >= designDraw;
  const disabledReason = alreadyPending
    ? "Already underway."
    : !canCommit
      ? `Needs ${money(designDraw)} cash on hand for the study/application.`
      : "";

  return `
  <div style="margin-top:14px;padding-top:14px;border-top:1px solid var(--border);">
    <h3 style="margin-bottom:4px;">Electrical Service Upgrade</h3>
    <div class="text-faint" style="font-size:12.5px;">
      Why it matters: solar and chargers both draw against your interconnection headroom — this increases that headroom by 50% once complete, so it's usually what unblocks further growth once the utility connection itself is the limit. The utility study queue plus construction lead time can't be bought down, regardless of budget.
    </div>
    <div class="btn-row">
      <button class="btn btn-primary" data-action="overview:commitServiceUpgrade" ${canCommit ? "" : "disabled"}>
        Commit to Electrical Service Upgrade — ${SERVICE_UPGRADE_MONTHS}mo, ${money(SERVICE_UPGRADE_TOTAL_COST_PLACEHOLDER)} est.
      </button>
    </div>
    ${disabledReason ? `<div class="text-faint" style="font-size:11.5px;margin-top:6px;">${escapeHtml(disabledReason)}</div>` : ""}
  </div>`;
}

function renderChargerSection(state: GameState): string {
  const available = availableInterconnectionKW(state);
  const sizing = computeChargerSizing(chargerCountDraft, chargerTypeDraft);
  const fitsHeadroom = sizing.totalKW <= available;

  let totalCost = chargerCountDraft * sizing.perUnitCost;
  if (spareConduitDraft) totalCost *= 1 + SPARE_CONDUIT_COST_MULTIPLIER;
  const designDraw = totalCost * CHARGER_DESIGN_FRACTION;

  const validCount = Number.isInteger(chargerCountDraft) && chargerCountDraft >= 1;
  const canCommit = validCount && fitsHeadroom && state.sim.cash >= designDraw;
  const disabledReason = !validCount
    ? "Enter at least 1 charger."
    : !fitsHeadroom
      ? `Blocked: requested load (${sizing.totalKW} kW) exceeds available interconnection headroom (${available.toFixed(1)} kW).`
      : state.sim.cash < designDraw
        ? `Needs ${money(designDraw)} cash on hand for design/permitting.`
        : "";

  return `
  <div style="margin-top:14px;padding-top:14px;border-top:1px solid var(--border);">
    <h3 style="margin-bottom:4px;">Charger Install</h3>
    <div class="text-faint" style="font-size:12.5px;margin-bottom:6px;">Why it matters: a route can't be converted to electric until enough charger capacity is installed to serve it — this is what makes route conversion (below) possible.</div>
    <div class="text-faint" style="font-size:11px;margin-bottom:8px;">Available interconnection headroom: <strong>${available.toFixed(1)} kW</strong></div>
    <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;">
      <label class="text-faint" style="font-size:12px;display:flex;align-items:center;gap:4px;">
        Count
        <input type="number" min="1" step="1" value="${chargerCountDraft}" data-action="overview:setChargerCount"
          style="width:56px;background:var(--bg);border:1px solid var(--border);color:var(--text);border-radius:4px;padding:4px 6px;" />
      </label>
      <label class="text-faint" style="font-size:12px;display:flex;align-items:center;gap:4px;">
        Type
        <select data-action="overview:setChargerType" style="background:var(--bg);border:1px solid var(--border);color:var(--text);border-radius:4px;padding:4px 6px;">
          <option value="L2" ${chargerTypeDraft === "L2" ? "selected" : ""}>L2 (19 kW each)</option>
          <option value="DCFC" ${chargerTypeDraft === "DCFC" ? "selected" : ""}>DCFC (150 kW each)</option>
        </select>
      </label>
      <label class="text-faint" style="font-size:12px;display:flex;align-items:center;gap:4px;">
        <input type="checkbox" data-action="overview:setSpareConduit" ${spareConduitDraft ? "checked" : ""} />
        Install extra conduit capacity (+25% cost)
      </label>
    </div>
    <div class="text-faint" style="font-size:12.5px;margin-top:8px;">
      Total load: <strong>${sizing.totalKW} kW</strong> · Lead time: <strong>${sizing.monthsOriginal}mo</strong> · Est. cost: <strong>${money(totalCost)}</strong>
    </div>
    <div class="btn-row">
      <button class="btn btn-primary" data-action="overview:commitChargerInstall" ${canCommit ? "" : "disabled"}>
        Commit to Charger Install
      </button>
    </div>
    ${disabledReason ? `<div class="text-faint" style="font-size:11.5px;margin-top:6px;">${escapeHtml(disabledReason)}</div>` : ""}
    ${state.sim.hasSpareConduit ? `<div class="text-faint" style="font-size:11.5px;margin-top:6px;">Spare conduit capacity banked: <strong>${state.sim.spareConduitCapacityKW.toFixed(1)} kW</strong></div>` : ""}
  </div>`;
}

function renderRouteRow(state: GameState, route: Route): string {
  const requiredKW = requiredChargingKWForRoute(state, route);
  const available = state.sim.installedChargerKW - state.sim.reservedChargerCapacityKW;
  const fitsCapacity = requiredKW <= available;
  const pending = !route.converted && isRouteConvertedOrPending(state, route.id);
  const totalCost = route.dedicatedVehicleCount * state.sim.evCostPerVehicle;

  const statusLabel = route.converted ? "Converted" : pending ? "Conversion in progress" : !route.evViable ? "Not EV-viable" : "Not converted";
  const head = `<div class="route-row-head">
      <span class="route-row-label">${escapeHtml(route.label)}</span>
      <span class="route-row-status ${route.converted ? "route-converted" : ""}">${escapeHtml(statusLabel)}</span>
    </div>
    <div class="text-faint" style="font-size:11.5px;">${route.dedicatedVehicleCount} buses · ${route.dailyMiles} mi/day · requires ${requiredKW} kW charging</div>`;

  if (route.converted) {
    // Track-only display (no gameplay consequence yet) — see
    // Route.batterySohPercent's doc comment in types.ts and
    // updateRouteBatterySohPercent() in engine.ts. null means either the
    // fleet's vehicle class has no ev-thermal-sim seam-table row yet (Tank
    // Wash's trucks) or this route hasn't ticked forward since conversion.
    const sohLine =
      route.batterySohPercent !== null
        ? `<div class="text-faint" style="font-size:11px;margin-top:4px;">Battery SOH: <strong>${route.batterySohPercent.toFixed(1)}%</strong></div>`
        : "";
    return `<div class="route-row">${head}${sohLine}</div>`;
  }
  if (pending) {
    return `<div class="route-row">${head}<div class="text-faint" style="font-size:11px;margin-top:4px;">Already underway.</div></div>`;
  }
  if (!route.evViable) {
    // Fixed, preset-authored data — see Route.evViable's doc comment;
    // nothing in the sim currently flips this at runtime (no event, no
    // tick-loop logic touches it), so there's no "becomes viable later"
    // state to react to here, just a permanent display-only exclusion.
    // Still shown (not hidden) so a player can see the route exists and
    // why it's excluded, per the fix for the evViable UI gap — previously
    // this row fell through to the interactive financing UI below and
    // relied entirely on commitToRouteConversion's engine-level gate,
    // which silently no-ops with zero feedback when clicked.
    return `<div class="route-row" style="opacity:0.55;">${head}<div class="text-faint" style="font-size:11px;margin-top:4px;">Not currently EV-viable — route length/duty cycle exceeds practical range for available technology.</div></div>`;
  }
  if (!fitsCapacity) {
    // The cash/debt financing choice only makes sense once capacity allows a
    // commit at all — showing it here would offer a choice that can't be acted on.
    return `<div class="route-row">${head}<div class="text-faint" style="font-size:11px;margin-top:4px;">Blocked: needs ${requiredKW} kW of charger capacity, only ${available.toFixed(1)} kW available.</div></div>`;
  }

  const financing = financingFor(route.id);
  const financingRadios = `
    <div style="display:flex;gap:12px;margin-top:6px;">
      <label class="text-faint" style="font-size:11.5px;display:flex;align-items:center;gap:4px;">
        <input type="radio" name="financing-${route.id}" value="cash" data-action="overview:setRouteFinancing" data-route="${route.id}" ${financing === "cash" ? "checked" : ""} />
        Cash purchase
      </label>
      <label class="text-faint" style="font-size:11.5px;display:flex;align-items:center;gap:4px;">
        <input type="radio" name="financing-${route.id}" value="debt" data-action="overview:setRouteFinancing" data-route="${route.id}" ${financing === "debt" ? "checked" : ""} />
        Debt financed (20% down)
      </label>
      <label class="text-faint" style="font-size:11.5px;display:flex;align-items:center;gap:4px;">
        <input type="radio" name="financing-${route.id}" value="grant" data-action="overview:setRouteFinancing" data-route="${route.id}" ${financing === "grant" ? "checked" : ""} />
        Grant + cash remainder
      </label>
    </div>`;

  let body: string;
  if (financing === "cash") {
    const depositDraw = totalCost * ROUTE_CONVERSION_DEPOSIT_FRACTION;
    const canCommit = state.sim.cash >= depositDraw;
    body = `
      <div class="btn-row">
        <button class="btn btn-primary btn-sm" data-action="overview:commitRouteConversion" data-route="${route.id}" ${canCommit ? "" : "disabled"}>
          Commit — ${ROUTE_CONVERSION_MONTHS}mo, ${money(totalCost)} est.
        </button>
      </div>
      ${!canCommit ? `<div class="text-faint" style="font-size:11px;margin-top:4px;">Needs ${money(depositDraw)} cash on hand for the order deposit.</div>` : ""}`;
  } else if (financing === "grant") {
    const projection = computeGrantFinancingProjection(state, route);
    const depositDraw = projection.cashDue * ROUTE_CONVERSION_DEPOSIT_FRACTION;
    const canCommit = projection.available && state.sim.cash >= depositDraw;
    const disabledReason = !projection.available
      ? "Grant program data unavailable."
      : !canCommit
        ? `Needs ${money(depositDraw)} cash on hand for the order deposit.`
        : "";
    body = `
      <div class="text-faint" style="font-size:11.5px;margin-top:4px;">
        Grant covers <strong>${money(projection.perBusCoverage)}</strong> of ${money(projection.costPerBus)} per bus (${projection.busCount} buses) =
        <strong>${money(projection.grantAmountUncapped)}</strong>${!projection.meetsPool ? `, reduced to <strong>${money(projection.grantAmount)}</strong> by remaining pool` : ""}
      </div>
      <div class="text-faint" style="font-size:11.5px;margin-top:2px;">
        Cash due: <strong>${money(projection.cashDue)}</strong> · Remaining pool: <strong>${money(projection.remainingPoolAfter)}</strong>
      </div>
      ${!projection.meetsPool && projection.available ? `<div class="text-faint" style="font-size:11px;margin-top:2px;color:var(--warn, #d9a441);">Program pool can't cover this route's full per-bus cap — grant partially funded.</div>` : ""}
      ${projection.available ? `<div class="text-faint" style="font-size:11px;margin-top:2px;">Award typically confirmed ~${projection.applicationDecisionMonths}mo after application — no rejection risk modeled this pass if pool room remains. Charging-infrastructure costs (a separate chargerInstall action) aren't grant-eligible this pass, even though the real program covers them too.</div>` : ""}
      <div class="btn-row">
        <button class="btn btn-primary btn-sm" data-action="overview:commitRouteConversion" data-route="${route.id}" ${canCommit ? "" : "disabled"}>
          Commit — ${ROUTE_CONVERSION_MONTHS}mo, ${money(projection.cashDue)} cash due
        </button>
      </div>
      ${disabledReason ? `<div class="text-faint" style="font-size:11px;margin-top:4px;">${escapeHtml(disabledReason)}</div>` : ""}`;
  } else {
    const terms = state.facility.finance.loanTermsAvailable;
    const selectedKey = loanTermKeyFor(route.id, terms);

    // Compute every term's projection up front so they can be shown side by
    // side — the point of this comparison is letting the player see the
    // term-length tradeoff directly rather than the system picking for them.
    const termRows = terms
      .map((term) => {
        const projection = computeDebtFinancingProjection(state, totalCost, term.key);
        const dscrText = projection.projectedDSCR !== null ? projection.projectedDSCR.toFixed(2) : "N/A";
        const selected = term.key === selectedKey;
        return `<label class="text-faint" style="font-size:11.5px;display:flex;align-items:center;gap:6px;margin-top:4px;">
          <input type="radio" name="loanterm-${route.id}" value="${term.key}" data-action="overview:setRouteLoanTerm" data-route="${route.id}" ${selected ? "checked" : ""} />
          <span style="min-width:190px;">${escapeHtml(term.label)} (${term.termMonths / 12}yr @ ${pct(term.apr, 1)})</span>
          Monthly: <strong>${money(projection.monthlyPayment)}</strong> ·
          DSCR: <strong style="color:${projection.meetsThreshold ? "var(--good)" : "var(--bad)"}">${dscrText}</strong>
        </label>`;
      })
      .join("");

    const projection = computeDebtFinancingProjection(state, totalCost, selectedKey);
    const depositDraw = projection.downPayment * ROUTE_CONVERSION_DEPOSIT_FRACTION;
    const canCommit = projection.meetsThreshold && state.sim.cash >= depositDraw;
    const dscrText = projection.projectedDSCR !== null ? projection.projectedDSCR.toFixed(2) : "N/A";
    const disabledReason = !projection.meetsThreshold
      ? `Blocked: financing this would bring DSCR to ${dscrText}, below the ${DSCR_MINIMUM_FOR_NEW_DEBT} minimum lenders require for new debt.`
      : !canCommit
        ? `Needs ${money(depositDraw)} cash on hand for the down payment deposit.`
        : "";
    body = `
      <div class="text-faint" style="font-size:11.5px;margin-top:4px;">Down payment (either term): <strong>${money(projection.downPayment)}</strong></div>
      ${termRows}
      <div class="btn-row">
        <button class="btn btn-primary btn-sm" data-action="overview:commitRouteConversion" data-route="${route.id}" ${canCommit ? "" : "disabled"}>
          Commit — ${ROUTE_CONVERSION_MONTHS}mo, ${money(projection.downPayment)} down
        </button>
      </div>
      ${disabledReason ? `<div class="text-faint" style="font-size:11px;margin-top:4px;">${escapeHtml(disabledReason)}</div>` : ""}`;
  }

  return `<div class="route-row">${head}${financingRadios}${body}</div>`;
}

function renderRouteConversionPanel(state: GameState): string {
  return `<div class="card" style="margin-top:16px;">
    <h3>Route Conversion</h3>
    <div class="text-faint" style="font-size:11px;margin-bottom:10px;">Installed charger capacity: <strong>${state.sim.installedChargerKW.toFixed(1)} kW</strong> · reserved for converted/in-progress routes: <strong>${state.sim.reservedChargerCapacityKW.toFixed(1)} kW</strong></div>
    ${state.facility.fleet.routes.map((r) => renderRouteRow(state, r)).join("")}
  </div>`;
}

function renderMaintenanceStrategyCard(state: GameState): string {
  const strategy = state.sim.maintenanceStrategy;
  const monthlyCost = state.facility.fleet.totalVehicles * MAINTENANCE_PROGRAM_COST_PER_VEHICLE;
  const reductionPct = ((1 - FLEET_MAINTENANCE_PREVENTATIVE_FAILURE_MULTIPLIER) * 100).toFixed(0);
  return `<div class="card">
    <h3>Fleet Maintenance Strategy</h3>
    <div class="text-faint" style="font-size:11.5px;margin-bottom:8px;">An ongoing operating posture — switch anytime, no lead time or commitment.</div>
    <div style="display:flex;flex-direction:column;gap:8px;">
      <label class="text-faint" style="font-size:12.5px;display:flex;align-items:center;gap:6px;">
        <input type="radio" name="maintenanceStrategy" value="reactive" data-action="overview:setMaintenanceStrategy" ${strategy === "reactive" ? "checked" : ""} />
        Reactive (fix on failure) — no added cost
      </label>
      <label class="text-faint" style="font-size:12.5px;display:flex;align-items:center;gap:6px;">
        <input type="radio" name="maintenanceStrategy" value="preventative" data-action="overview:setMaintenanceStrategy" ${strategy === "preventative" ? "checked" : ""} />
        Preventative — +${money(monthlyCost)}/mo, -${reductionPct}% diesel &amp; EV drivetrain failure odds
      </label>
    </div>
  </div>`;
}

function renderLoanRow(state: GameState, loan: ActiveLoan): string {
  const route = state.facility.fleet.routes.find((r) => r.id === loan.sourceRouteId);
  const terms = state.facility.finance.loanTermsAvailable;
  const selectedKey = refinanceTermKeyFor(loan.id, terms);
  const projection = computeRefinanceProjection(state, loan.id, selectedKey);

  const termOptions = terms
    .map((term) => `<option value="${term.key}" ${term.key === selectedKey ? "selected" : ""}>${escapeHtml(term.label)} (${term.termMonths / 12}yr @ ${pct(term.apr, 1)})</option>`)
    .join("");

  let projectionLine = "";
  let disabledReason = "";
  let canRefinance = false;
  if (projection) {
    const dscrText = projection.projectedDSCR !== null ? projection.projectedDSCR.toFixed(2) : "N/A";
    projectionLine = `<div class="text-faint" style="font-size:11.5px;margin-top:4px;">
      New payment: <strong>${money(projection.newMonthlyPayment)}</strong>/mo (currently ${money(projection.currentMonthlyPayment)}/mo) ·
      Projected DSCR: <strong style="color:${projection.meetsThreshold ? "var(--good)" : "var(--bad)"}">${dscrText}</strong> ·
      Closing cost: <strong>${money(projection.refinanceCost)}</strong>
    </div>`;
    canRefinance = projection.meetsThreshold && state.sim.cash >= projection.refinanceCost;
    disabledReason = !projection.meetsThreshold
      ? `Blocked: refinancing this loan would bring DSCR to ${dscrText}, below the ${DSCR_MINIMUM_FOR_NEW_DEBT} minimum lenders require.`
      : !canRefinance
        ? `Needs ${money(projection.refinanceCost)} cash on hand for the refinance closing cost.`
        : "";
  }

  return `<div class="route-row">
    <div class="route-row-head">
      <span class="route-row-label">${escapeHtml(route ? route.label : loan.sourceRouteId)}</span>
      <span class="route-row-status">${pct(loan.apr, 2)} APR</span>
    </div>
    <div class="text-faint" style="font-size:11.5px;">
      Remaining principal: <strong>${money(loan.remainingPrincipal)}</strong> of ${money(loan.originalPrincipal)} borrowed ·
      Payment: <strong>${money(loan.monthlyPayment)}</strong>/mo · Term: ${loan.termMonths / 12}yr
    </div>
    <div style="display:flex;gap:8px;align-items:center;margin-top:6px;flex-wrap:wrap;">
      <label class="text-faint" style="font-size:11.5px;display:flex;align-items:center;gap:4px;">
        Refinance into
        <select data-action="overview:setRefinanceLoanTerm" data-loan="${loan.id}" style="background:var(--bg);border:1px solid var(--border);color:var(--text);border-radius:4px;padding:4px 6px;">
          ${termOptions}
        </select>
      </label>
      <button class="btn btn-sm" data-action="overview:commitRefinanceLoan" data-loan="${loan.id}" ${canRefinance ? "" : "disabled"}>
        Refinance
      </button>
    </div>
    ${projectionLine}
    ${disabledReason ? `<div class="text-faint" style="font-size:11px;margin-top:4px;">${escapeHtml(disabledReason)}</div>` : ""}
  </div>`;
}

// Only rendered once at least one loan exists — an empty card before any
// debt-financed route conversion would just be noise, same reasoning as
// renderPendingCommitments showing "no active commitments" instead of
// hiding itself (that one always has something to say; this one doesn't).
function renderActiveLoansSection(state: GameState): string {
  const loans = state.sim.activeLoans;
  if (loans.length === 0) return "";
  return `<div class="card" style="margin-top:16px;">
    <h3>Active Loans</h3>
    <div class="text-faint" style="font-size:11px;margin-bottom:10px;">Total outstanding debt: <strong>${money(state.sim.debt)}</strong> · Total monthly debt service: <strong>${money(state.sim.totalMonthlyDebtService)}</strong></div>
    ${loans.map((loan) => renderLoanRow(state, loan)).join("")}
  </div>`;
}

function renderPendingCommitments(state: GameState): string {
  const actions = state.sim.pendingActions;
  if (actions.length === 0) {
    return `<div class="card"><h3>Pending Commitments</h3><div class="list-empty">No active commitments.</div></div>`;
  }
  return `<div class="card">
    <h3>Pending Commitments</h3>
    ${actions.map(renderAction).join("")}
  </div>`;
}

export const overviewTab: TabModule = {
  key: "overview",
  label: "Overview",

  render(ctx) {
    const { state } = ctx;
    const alreadyPending = isActionPending(state, "interconnection_study");
    const canCommit = canCommitAction(state, []) && !alreadyPending && state.sim.cash >= INTERCONNECTION_STUDY_MOBILIZATION_COST;
    const disabledReason = alreadyPending
      ? "Already underway."
      : state.sim.cash < INTERCONNECTION_STUDY_MOBILIZATION_COST
        ? `Needs ${money(INTERCONNECTION_STUDY_MOBILIZATION_COST)} cash on hand for mobilization.`
        : "";

    return `
    ${renderMissionBanner()}
    ${renderItcBanner(state)}
    ${renderRecentActivityPanel(state)}

    <div class="grid grid-cols-4">
      <div class="card">${cashGauge(state)}</div>
      <div class="card">${electrificationGauge(state)}</div>
      <div class="card">${dscrGauge(state)}</div>
      <div class="card">${uptimeGauge(state)}</div>
    </div>

    <div class="grid grid-cols-2" style="margin-top:16px;">
      ${renderPendingCommitments(state)}

      <div class="card">
        <h3>Available Actions</h3>
        <div class="text-faint" style="font-size:12.5px;">Commit to any of these when you're ready — each has a real lead time and cost you can't skip regardless of budget.</div>
        ${renderSolarSection(state)}
        ${renderServiceUpgradeSection(state)}
        ${renderChargerSection(state)}
        <div style="margin-top:14px;padding-top:14px;border-top:1px solid var(--border);opacity:0.6;">
          <h3 style="margin-bottom:4px;font-size:13px;">Interconnection Study (prototype)</h3>
          <p class="text-faint" style="font-size:11.5px;">Exercises the commitment/cost-schedule system end to end — costs cash and takes ${INTERCONNECTION_STUDY_MONTHS} months, but has no effect on your facility yet.</p>
          <div class="btn-row">
            <button class="btn" data-action="overview:commitInterconnectionStudy" ${canCommit ? "" : "disabled"}>
              Commit — ${INTERCONNECTION_STUDY_MONTHS}mo, ${money(INTERCONNECTION_STUDY_TOTAL_COST)}
            </button>
          </div>
          ${disabledReason ? `<div class="text-faint" style="font-size:11.5px;margin-top:6px;">${escapeHtml(disabledReason)}</div>` : ""}
        </div>
      </div>
    </div>

    <div style="margin-top:16px;">${renderMaintenanceStrategyCard(state)}</div>

    ${renderActiveLoansSection(state)}

    ${renderRouteConversionPanel(state)}`;
  },

  onAction(ctx, action, target) {
    if (action === "overview:commitInterconnectionStudy") {
      return commitToInterconnectionStudy(ctx.state);
    }
    if (action === "overview:commitSolarInstall") {
      return commitToSolarInstall(ctx.state);
    }
    if (action === "overview:commitServiceUpgrade") {
      return commitToServiceUpgrade(ctx.state);
    }
    if (action === "overview:commitChargerInstall") {
      const committed = commitToChargerInstall(ctx.state, chargerCountDraft, chargerTypeDraft, spareConduitDraft);
      if (committed) chargerCountDraft = 1;
      return committed;
    }
    if (action === "overview:commitRouteConversion") {
      const routeId = target.getAttribute("data-route");
      if (!routeId) return false;
      const terms = ctx.state.facility.finance.loanTermsAvailable;
      return commitToRouteConversion(ctx.state, routeId, financingFor(routeId), loanTermKeyFor(routeId, terms));
    }
    if (action === "overview:commitRefinanceLoan") {
      const loanId = target.getAttribute("data-loan");
      if (!loanId) return false;
      const terms = ctx.state.facility.finance.loanTermsAvailable;
      return refinanceLoan(ctx.state, loanId, refinanceTermKeyFor(loanId, terms));
    }
    return false;
  },

  onInput(ctx, action, target) {
    if (action === "overview:setMaintenanceStrategy" && target instanceof HTMLInputElement) {
      setMaintenanceStrategy(ctx.state, target.value === "preventative" ? "preventative" : "reactive");
      return true;
    }
    if (action === "overview:setChargerCount" && target instanceof HTMLInputElement) {
      const n = parseInt(target.value, 10);
      chargerCountDraft = Number.isFinite(n) && n > 0 ? n : 1;
      return true;
    }
    if (action === "overview:setChargerType" && target instanceof HTMLSelectElement) {
      chargerTypeDraft = target.value === "DCFC" ? "DCFC" : "L2";
      return true;
    }
    if (action === "overview:setSpareConduit" && target instanceof HTMLInputElement) {
      spareConduitDraft = target.checked;
      return true;
    }
    if (action === "overview:setRouteFinancing" && target instanceof HTMLInputElement) {
      const routeId = target.getAttribute("data-route");
      if (routeId) {
        financingChoiceDraft[routeId] = target.value === "debt" ? "debt" : target.value === "grant" ? "grant" : "cash";
      }
      return true;
    }
    if (action === "overview:setRouteLoanTerm" && target instanceof HTMLInputElement) {
      const routeId = target.getAttribute("data-route");
      if (routeId) loanTermChoiceDraft[routeId] = target.value;
      return true;
    }
    if (action === "overview:setRefinanceLoanTerm" && target instanceof HTMLSelectElement) {
      const loanId = target.getAttribute("data-loan");
      if (loanId) refinanceTermChoiceDraft[loanId] = target.value;
      return true;
    }
    return false;
  },
};
