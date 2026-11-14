/**
 * Seeded pseudo-random number generator (xoshiro128**).
 *
 * Every random decision in the simulation flows through one `Rng`, so a
 * world created from the same seed and settings evolves identically on the
 * same JavaScript engine. The full state can be saved and restored.
 */

export type RngState = [number, number, number, number];

/** SplitMix32: expands a 32-bit seed into well-mixed state words. */
function splitmix32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x9e3779b9) >>> 0;
    let z = a;
    z = Math.imul(z ^ (z >>> 16), 0x85ebca6b) >>> 0;
    z = Math.imul(z ^ (z >>> 13), 0xc2b2ae35) >>> 0;
    return (z ^ (z >>> 16)) >>> 0;
  };
}

/** Hash an arbitrary string seed ("primordia", "42") into 32 bits (FNV-1a). */
export function hashSeed(seed: string | number): number {
  const text = String(seed);
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

export class Rng {
  private s: RngState;
  private spareGaussian: number | null = null;

  constructor(seed: string | number = Date.now()) {
    const next = splitmix32(hashSeed(seed));
    this.s = [next(), next(), next(), next()];
    if (this.s.every((v) => v === 0)) this.s[0] = 1;
  }

  /**
   * Rebuild a generator. `spare` is the cached second Box-Muller value: without
   * it, a restored generator would drift from the original at the next gaussian().
   */
  static fromState(state: RngState, spare: number | null = null): Rng {
    const rng = new Rng(0);
    rng.s = [state[0] >>> 0, state[1] >>> 0, state[2] >>> 0, state[3] >>> 0];
    rng.spareGaussian = spare;
    return rng;
  }

  /** The cached gaussian value, part of the full generator state. */
  get spare(): number | null {
    return this.spareGaussian;
  }

  get state(): RngState {
    return [this.s[0], this.s[1], this.s[2], this.s[3]];
  }

  /** Next raw 32-bit unsigned integer. */
  nextU32(): number {
    const s = this.s;
    const result = Math.imul(rotl(Math.imul(s[1], 5) >>> 0, 7), 9) >>> 0;
    const t = (s[1] << 9) >>> 0;
    s[2] = (s[2] ^ s[0]) >>> 0;
    s[3] = (s[3] ^ s[1]) >>> 0;
    s[1] = (s[1] ^ s[2]) >>> 0;
    s[0] = (s[0] ^ s[3]) >>> 0;
    s[2] = (s[2] ^ t) >>> 0;
    s[3] = rotl(s[3], 11);
    return result;
  }

  /** Uniform float in [0, 1). */
  next(): number {
    return this.nextU32() / 4294967296;
  }

  range(min: number, max: number): number {
    return min + (max - min) * this.next();
  }

  int(minInclusive: number, maxExclusive: number): number {
    return minInclusive + Math.floor(this.next() * (maxExclusive - minInclusive));
  }

  chance(p: number): boolean {
    return this.next() < p;
  }

  pick<T>(items: readonly T[]): T {
    if (items.length === 0) throw new Error("cannot pick from an empty list");
    return items[this.int(0, items.length)] as T;
  }

  /** Standard normal sample (Box-Muller, caching the second value). */
  gaussian(): number {
    if (this.spareGaussian !== null) {
      const value = this.spareGaussian;
      this.spareGaussian = null;
      return value;
    }
    let u = 0;
    while (u === 0) u = this.next();
    const v = this.next();
    const mag = Math.sqrt(-2 * Math.log(u));
    this.spareGaussian = mag * Math.sin(2 * Math.PI * v);
    return mag * Math.cos(2 * Math.PI * v);
  }

  /** Independent child generator, useful for side streams that must not disturb the main one. */
  fork(label: string): Rng {
    return new Rng(`${this.nextU32()}:${label}`);
  }
}

function rotl(x: number, k: number): number {
  return ((x << k) | (x >>> (32 - k))) >>> 0;
}
