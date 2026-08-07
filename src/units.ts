/**
 * Display units. The model is millimetres internally; user-facing text is
 * imperial. Rule messages format lengths/areas through these so the whole
 * product reads in feet.
 */
const MM_PER_FT = 304.8;

/** Millimetres → a "X.X ft" string. */
export function ft(mm: number): string {
  return `${(mm / MM_PER_FT).toFixed(1)} ft`;
}

/** Square millimetres → an "N ft²" string. */
export function ft2(mm2: number): string {
  return `${Math.round(mm2 / (MM_PER_FT * MM_PER_FT))} ft²`;
}
