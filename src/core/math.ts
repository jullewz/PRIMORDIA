/** Numeric helpers for a toroidal (wrap-around) world. */

export const TAU = Math.PI * 2;

export function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export function sigmoid(x: number): number {
  return 1 / (1 + Math.exp(-x));
}

/** Wrap a coordinate into [0, size). */
export function wrap(value: number, size: number): number {
  const r = value % size;
  return r < 0 ? r + size : r;
}

/** Shortest signed difference b - a on a ring of the given size. */
export function wrapDelta(a: number, b: number, size: number): number {
  let d = b - a;
  const half = size / 2;
  if (d > half) d -= size;
  else if (d < -half) d += size;
  return d;
}

/** Normalise an angle into (-PI, PI]. */
export function normAngle(angle: number): number {
  let a = angle % TAU;
  if (a <= -Math.PI) a += TAU;
  else if (a > Math.PI) a -= TAU;
  return a;
}

export function mean(values: readonly number[]): number {
  if (values.length === 0) return 0;
  let sum = 0;
  for (const v of values) sum += v;
  return sum / values.length;
}

/** Round for display, never used inside the simulation (keeps runs deterministic). */
export function round(value: number, digits = 2): number {
  const f = 10 ** digits;
  return Math.round(value * f) / f;
}
