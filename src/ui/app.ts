import type { ClockSpeed, FailedSecondaryCondition, FinalOutcome, GameState, ObjectiveTier } from "../types.js";
import type { AppCtx, TabModule } from "./types.js";
import { formatDate } from "../engine/clock.js";
import { money } from "./format.js";
import { overviewTab } from "./overviewTab.js";
import { INSOLVENCY_THRESHOLD_MONTHS } from "../constants.js";

const TABS: TabModule[] = [overviewTab]; // more tabs (Electrical, Fleet, Finance, Incentives) land in later passes

let rootEl: HTMLElement | null = null;
let ctx: AppCtx | null = null;

export function mountApp(root: HTMLElement, state: GameState, markDirty: () => void): void {
  rootEl = root;
  ctx = { state, markDirty };
  root.addEventListener("click", onClick);
  root.addEventListener("change", onInput);
  render();
}

function activeTabModule(): TabModule {
  const found = TABS.find((t) => t.key === ctx!.state.activeTab);
  return found ?? TABS[0];
}

function renderGameOverBanner(reason: "insolvency"): string {
  const message =
    reason === "insolvency"
      ? `GAME OVER — Insolvency: cash remained negative for ${INSOLVENCY_THRESHOLD_MONTHS} consecutive months.`
      : "GAME OVER";
  return `<div class="banner banner-warn" style="margin:0;border-radius:0;font-size:15px;font-weight:700;text-align:center;padding:14px;">${message}</div>`;
}

const TIER_LABEL: Record<ObjectiveTier, string> = {
  unsuccessful: "Unsuccessful",
  successful: "Successful",
  strong: "Strong",
  exceptional: "Exceptional",
};

const FAILED_CONDITION_TEXT: Record<Exclude<FailedSecondaryCondition, null>, string> = {
  insolvent: "the district became insolvent before the finish line",
  dscr_breach: "DSCR was below 1.0 (in active breach) at the finish line",
  uptime_floor: "the trailing uptime average was below the 70% floor at the finish line",
};

// Same rgba-alpha convention as the existing .banner-info/.banner-warn
// classes in main.css (border color at full opacity, background at 0.12),
// applied inline here since this is the first banner with more than two
// possible tones.
const TIER_BANNER_STYLE: Record<ObjectiveTier, { border: string; background: string; text: string }> = {
  unsuccessful: { border: "#f2545b", background: "rgba(242, 84, 91, 0.12)", text: "#f2545b" },
  successful: { border: "#f0b429", background: "rgba(240, 180, 41, 0.12)", text: "#f0b429" },
  strong: { border: "#3ecf8e", background: "rgba(62, 207, 142, 0.12)", text: "#3ecf8e" },
  exceptional: { border: "#3ecf8e", background: "rgba(62, 207, 142, 0.12)", text: "#3ecf8e" },
};

function renderFinalOutcomeBanner(outcome: FinalOutcome): string {
  const style = TIER_BANNER_STYLE[outcome.tier];
  const conditionsLine = outcome.conditionsMet
    ? "All secondary conditions held (solvent, DSCR not in breach, uptime above floor)."
    : `Secondary conditions did NOT hold: ${FAILED_CONDITION_TEXT[outcome.failedCondition as Exclude<FailedSecondaryCondition, null>]}.`;

  return `<div class="banner" style="margin:0;border-radius:0;border-color:${style.border};background:${style.background};text-align:center;padding:14px;">
    <div style="font-size:15px;font-weight:700;">Year ${outcome.year} Outcome — <span style="color:${style.text}">${TIER_LABEL[outcome.tier]}</span></div>
    <div style="font-size:13px;margin-top:4px;">Final electrification rate: <strong>${(outcome.electrificationRate * 100).toFixed(1)}%</strong> · ${conditionsLine}</div>
  </div>`;
}

export function render(): void {
  if (!rootEl || !ctx) return;
  const { state } = ctx;
  const gameOver = state.sim.gameOverReason !== null;
  const finalOutcome = state.sim.finalOutcome;
  const halted = gameOver || finalOutcome !== null;

  const tabsHtml = TABS.map(
    (t) => `<button class="tab-btn ${t.key === state.activeTab ? "active" : ""}" data-action="global:setTab" data-tab="${t.key}">${t.label}</button>`,
  ).join("");

  const speeds: { v: ClockSpeed; label: string }[] = [
    { v: 0, label: "II" },
    { v: 1, label: "1x" },
    { v: 4, label: "4x" },
    { v: 15, label: "15x" },
  ];
  const speedHtml = speeds
    .map(
      (s) =>
        `<button class="speed-btn ${state.speed === s.v ? "active" : ""}" data-action="global:setSpeed" data-speed="${s.v}" ${halted ? "disabled" : ""}>${s.label}</button>`,
    )
    .join("");

  rootEl.innerHTML = `
    <div class="topbar">
      <div class="brand">
        <span class="logo">TRANSITION</span>
        <span class="store-name">${state.facility.name}</span>
      </div>
      <div class="clock-cluster">
        <div class="date-display">${formatDate(state.sim.month, state.sim.year)}<span class="phase">Facility Electrification Plan</span></div>
        <div class="speed-controls">${speedHtml}</div>
      </div>
      <div class="hud-stats">
        <div class="hud-stat"><div class="label">Cash</div><div class="value ${state.sim.cash < 0 ? "neg" : "pos"}">${money(state.sim.cash)}</div></div>
      </div>
    </div>
    ${gameOver ? renderGameOverBanner(state.sim.gameOverReason as "insolvency") : finalOutcome ? renderFinalOutcomeBanner(finalOutcome) : ""}
    <div class="tabbar">${tabsHtml}</div>
    <div class="tab-content" ${halted ? 'style="pointer-events:none;opacity:0.5;"' : ""}>${activeTabModule().render(ctx!)}</div>
  `;
}

function onClick(e: MouseEvent): void {
  const target = (e.target as HTMLElement).closest("[data-action]") as HTMLElement | null;
  if (!target || !ctx) return;
  const action = target.getAttribute("data-action")!;

  if (action === "global:setTab") {
    ctx.state.activeTab = target.getAttribute("data-tab")!;
    render();
    return;
  }
  if (ctx.state.sim.gameOverReason || ctx.state.sim.finalOutcome) return; // speed controls and every commit action are frozen once the game is over or has reached its final outcome
  if (action === "global:setSpeed") {
    ctx.state.speed = Number(target.getAttribute("data-speed")) as ClockSpeed;
    render();
    return;
  }

  const mod = activeTabModule();
  if (mod.onAction && mod.onAction(ctx, action, target)) {
    ctx.markDirty();
    render();
  }
}

function onInput(e: Event): void {
  const target = (e.target as HTMLElement).closest("[data-action]") as HTMLElement | null;
  if (!target || !ctx) return;
  const action = target.getAttribute("data-action")!;

  const mod = activeTabModule();
  if (mod.onInput && mod.onInput(ctx, action, target)) {
    render();
  }
}
