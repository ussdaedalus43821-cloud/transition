import type { GameState } from "../types.js";

export interface AppCtx {
  state: GameState;
  markDirty: () => void;
}

export interface TabModule {
  key: string;
  label: string;
  render(ctx: AppCtx): string;
  onAction?(ctx: AppCtx, action: string, target: HTMLElement): boolean;
  onInput?(ctx: AppCtx, action: string, target: HTMLElement): boolean;
}
