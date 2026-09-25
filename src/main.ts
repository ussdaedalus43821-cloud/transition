import { createNewGame } from "./state.js";
import { advanceOneMonth } from "./engine/engine.js";
import { msPerGameMonth } from "./engine/clock.js";
import { mountApp, render } from "./ui/app.js";
import { SCHOOL_BUS_DEPOT_PRESET, TANK_WASH_PRESET } from "./constants.js";
import type { FacilityProfile } from "./types.js";

// Minimal preset-selection screen, shown before createNewGame() runs. No
// elaborate UI — just enough to prove preset selection actually works.
const PRESET_OPTIONS: { label: string; description: string; preset: FacilityProfile }[] = [
  {
    label: SCHOOL_BUS_DEPOT_PRESET.name,
    description: "Municipal school bus depot — 50 diesel buses, 480V/400A service, EPA grant + municipal financing.",
    preset: SCHOOL_BUS_DEPOT_PRESET,
  },
  {
    label: TANK_WASH_PRESET.name,
    description: "Private food-grade tank wash — 18 trucks, 600V/600A service, commercial financing.",
    preset: TANK_WASH_PRESET,
  },
];

function boot(): void {
  const root = document.getElementById("app");
  if (!root) return;

  renderPresetSelection(root);
}

function renderPresetSelection(root: HTMLElement): void {
  root.innerHTML = `
    <div style="max-width:640px;margin:80px auto;padding:0 16px;">
      <div style="margin-bottom:24px;">
        <span style="font-size:22px;font-weight:700;letter-spacing:0.5px;">TRANSITION</span>
        <div style="color:var(--text-faint);margin-top:4px;">Select a facility to begin.</div>
      </div>
      ${PRESET_OPTIONS.map(
        (option, i) => `
        <button data-preset-index="${i}" class="card" style="display:block;width:100%;text-align:left;margin-bottom:12px;cursor:pointer;font:inherit;">
          <div style="font-weight:700;font-size:15px;">${option.label}</div>
          <div class="text-faint" style="font-size:12.5px;margin-top:4px;">${option.description}</div>
        </button>`,
      ).join("")}
    </div>
  `;
  root.querySelectorAll<HTMLButtonElement>("[data-preset-index]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const index = Number(btn.getAttribute("data-preset-index"));
      startGame(root, PRESET_OPTIONS[index].preset);
    });
  });
}

function startGame(root: HTMLElement, preset: FacilityProfile): void {
  const state = createNewGame(preset);
  // No persistence layer yet this pass — markDirty is a hook for the save/load
  // system a later pass adds, kept in AppCtx now so tab modules don't need to
  // change when it lands.
  const markDirty = () => {};

  mountApp(root, state, markDirty);

  let lastFrame = performance.now();

  function frame(now: number): void {
    const elapsed = now - lastFrame;
    lastFrame = now;

    if (state.speed > 0) {
      state.realMsAccumulator += elapsed;
      const perMonth = msPerGameMonth(state.speed);
      let advanced = false;
      let guard = 0;
      while (state.realMsAccumulator >= perMonth && guard < 24 && !state.sim.gameOverReason && !state.sim.finalOutcome) {
        state.realMsAccumulator -= perMonth;
        advanceOneMonth(state);
        advanced = true;
        guard += 1;
      }
      if (advanced) render();
    }

    requestAnimationFrame(frame);
  }

  requestAnimationFrame(frame);
}

boot();
