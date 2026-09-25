export function money(n: number): string {
  const sign = n < 0 ? "-" : "";
  return `${sign}$${Math.abs(Math.round(n)).toLocaleString()}`;
}

export function pct(n: number, digits = 0): string {
  return `${(n * 100).toFixed(digits)}%`;
}

export function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

export function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export type GaugeTone = "good" | "warn" | "bad" | "info";

/** Reserve-style horizontal gauge: label + value on top, a filled track below. */
export function gauge(label: string, valueLabel: string, fraction: number, tone: GaugeTone, hint?: string): string {
  const color = `var(--${tone})`;
  const width = (clamp(fraction, 0, 1) * 100).toFixed(1);
  return `<div class="gauge">
    <div class="gl"><span>${escapeHtml(label)}</span><span class="gv" style="color:${color}">${escapeHtml(valueLabel)}</span></div>
    <div class="track"><div class="fill" style="width:${width}%;background:${color}"></div></div>
    ${hint ? `<div class="gh">${escapeHtml(hint)}</div>` : ""}
  </div>`;
}
