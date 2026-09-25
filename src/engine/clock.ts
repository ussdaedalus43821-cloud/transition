import type { ClockSpeed } from "../types.js";

export const MONTH_MS_AT_1X = 3000; // real ms per simulated month at 1x speed

export function msPerGameMonth(speed: ClockSpeed): number {
  if (speed === 0) return Infinity;
  return MONTH_MS_AT_1X / speed;
}

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

export function formatDate(month: number, year: number): string {
  return `${MONTH_NAMES[month - 1]} Year ${year}`;
}

/** A single increasing number for a {month, year} pair, so two dates can be compared/subtracted directly. */
export function monthOrdinal(month: number, year: number): number {
  return year * 12 + month;
}

/** Inverse of monthOrdinal() — converts an ordinal back into a {month, year} pair. Needed by the incentive_program_closes_early event to compute a moved-up deadline date from an ordinal subtraction. */
export function dateFromOrdinal(ordinal: number): { month: number; year: number } {
  const year = Math.floor((ordinal - 1) / 12);
  const month = ordinal - year * 12;
  return { month, year };
}
