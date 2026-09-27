import type { TabModule } from "./types.js";
import { escapeHtml, gauge, type GaugeTone } from "./format.js";
import { cumulativeSohLossPct, seamRowForFleet } from "../engine/engine.js";
import { monthOrdinal } from "../engine/clock.js";
import type { GameState, Route } from "../types.js";

const PROJECTION_YEARS = [5, 10, 20];

function sohTone(sohPercent: number): GaugeTone {
  return sohPercent >= 90 ? "good" : sohPercent >= 75 ? "warn" : "bad";
}

function renderFleetSummary(state: GameState): string {
  const routes = state.facility.fleet.routes;
  const convertedRoutes = routes.filter((r) => r.converted);
  const trackedRoutes = convertedRoutes.filter((r) => r.batterySohPercent !== null);

  const summaryLine = `<div class="text-faint" style="font-size:12.5px;margin-bottom:10px;">
    ${trackedRoutes.length} of ${convertedRoutes.length} converted route${convertedRoutes.length === 1 ? "" : "s"}
    ${convertedRoutes.length === 1 ? "has" : "have"} tracked battery health data
    (${routes.length} route${routes.length === 1 ? "" : "s"} total in the fleet).
  </div>`;

  if (trackedRoutes.length === 0) {
    return `<div class="card">
      <h3>Fleet Battery Health</h3>
      ${summaryLine}
      <div class="list-empty">No tracked battery health data yet.</div>
    </div>`;
  }

  const avgSoh = trackedRoutes.reduce((sum, r) => sum + (r.batterySohPercent ?? 0), 0) / trackedRoutes.length;

  return `<div class="card">
    <h3>Fleet Battery Health</h3>
    ${summaryLine}
    ${gauge(
      "Fleet-average battery SOH",
      `${avgSoh.toFixed(1)}%`,
      avgSoh / 100,
      sohTone(avgSoh),
      `across ${trackedRoutes.length} tracked route${trackedRoutes.length === 1 ? "" : "s"}`,
    )}
  </div>`;
}

function renderCaveats(caveats: string[]): string {
  if (caveats.length === 0) return "";
  const items = caveats.map((c) => `<li class="text-faint" style="font-size:10.5px;margin-top:3px;">${escapeHtml(c)}</li>`).join("");
  return `<div class="text-faint" style="font-size:10.5px;margin-top:8px;">Known limitations on this projection:</div>
    <ul style="margin:2px 0 0 16px;padding:0;">${items}</ul>`;
}

function renderRouteCard(state: GameState, route: Route): string {
  const head = `<div class="route-row-head">
      <span class="route-row-label">${escapeHtml(route.label)}</span>
    </div>
    <div class="text-faint" style="font-size:11.5px;">${route.dedicatedVehicleCount} buses · ${route.dailyMiles} mi/day</div>`;

  if (!route.converted) {
    return `<div class="route-row" style="opacity:0.55;">${head}
      <div class="text-faint" style="font-size:11px;margin-top:4px;">
        Not yet converted — battery health will be tracked once this route converts to electric.
      </div>
    </div>`;
  }

  const seamRow = seamRowForFleet(state.facility);
  if (!seamRow || route.batterySohPercent === null) {
    return `<div class="route-row">${head}
      <div class="text-faint" style="font-size:11px;margin-top:4px;">
        Battery health tracking isn't available yet for this vehicle class.
      </div>
    </div>`;
  }

  const nowOrdinal = monthOrdinal(state.sim.month, state.sim.year);
  const monthsSinceConversion =
    route.conversionCompletionOrdinal !== null ? nowOrdinal - route.conversionCompletionOrdinal : 0;
  const currentSoh = route.batterySohPercent;

  const projectionsHtml = PROJECTION_YEARS.map((years) => {
    const projectedSoh = 100 - cumulativeSohLossPct(seamRow, monthsSinceConversion + years * 12);
    return `<strong>${projectedSoh.toFixed(1)}%</strong> in ${years}yr`;
  }).join(" · ");

  return `<div class="route-row">
    ${head}
    ${gauge(
      "Battery SOH",
      `${currentSoh.toFixed(1)}%`,
      currentSoh / 100,
      sohTone(currentSoh),
      `${monthsSinceConversion} month${monthsSinceConversion === 1 ? "" : "s"} since conversion`,
    )}
    <div class="text-faint" style="font-size:11px;margin-top:6px;">Projected: ${projectionsHtml}</div>
    ${renderCaveats(seamRow.caveats)}
  </div>`;
}

export const batteryHealthTab: TabModule = {
  key: "batteryHealth",
  label: "Battery Health",

  render(ctx) {
    const { state } = ctx;
    return `
    ${renderFleetSummary(state)}
    <div class="card" style="margin-top:16px;">
      <h3>By Route</h3>
      ${state.facility.fleet.routes.map((r) => renderRouteCard(state, r)).join("")}
    </div>`;
  },
};
