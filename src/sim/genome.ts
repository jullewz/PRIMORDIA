/**
 * Genome layout, decoding, mutation, crossover and genetic distance.
 *
 * A genome is a flat array of numbers: trait genes first, then the weights
 * of the creature's neural network. Trait genes are unbounded reals mapped
 * into physical ranges by smooth functions, so mutation never gets stuck at
 * a hard limit.
 */

import type { Rng } from "../core/rng.js";
import { clamp, sigmoid } from "../core/math.js";

export const TRAIT_NAMES = [
  "size",
  "speed",
  "agility",
  "senseRange",
  "fieldOfView",
  "diet",
  "hue",
  "mutationRate",
  "breedThreshold",
  "offspringShare",
  "clock",
] as const;

export type TraitName = (typeof TRAIT_NAMES)[number];

export const N_TRAITS = TRAIT_NAMES.length;
export const N_INPUTS = 16;
export const N_HIDDEN = 10;
export const N_OUTPUTS = 6;
export const N_WEIGHTS = (N_INPUTS + 1) * N_HIDDEN + (N_HIDDEN + 1) * N_OUTPUTS;
export const GENOME_LENGTH = N_TRAITS + N_WEIGHTS;

export const INPUT_LABELS = [
  "energy",
  "speed",
  "plant ◂",
  "plant ▴",
  "plant ▸",
  "creature ◂",
  "creature ▴",
  "creature ▸",
  "meat ◂",
  "meat ▴",
  "meat ▸",
  "rel. size",
  "kinship",
  "clock",
  "memory A",
  "memory B",
] as const;

export const OUTPUT_LABELS = ["thrust", "turn", "bite", "breed", "memory A", "memory B"] as const;

export type Genome = number[];

/** Decoded, physical traits of a genome. */
export interface Traits {
  /** Body radius. */
  size: number;
  maxSpeed: number;
  /** Max turn per tick, radians. */
  agility: number;
  senseRange: number;
  /** Total angle of the vision cone, radians. */
  fieldOfView: number;
  /** 0 = pure herbivore, 1 = pure carnivore. */
  diet: number;
  hue: number;
  mutationRate: number;
  /** Fraction of max energy needed before breeding is possible. */
  breedThreshold: number;
  /** Fraction of energy handed to each offspring. */
  offspringShare: number;
  /** Frequency of the internal oscillator input. */
  clock: number;
}

const s = sigmoid;

export function decodeTraits(g: Genome): Traits {
  const gene = (i: number): number => g[i] ?? 0;
  const size = 3 + 7 * s(gene(0));
  return {
    size,
    // bigger bodies are slower: a classic trade-off that drives niche splitting
    maxSpeed: (0.7 + 2.6 * s(gene(1))) * (1.15 - size / 40),
    agility: 0.04 + 0.26 * s(gene(2)),
    senseRange: 28 + 130 * s(gene(3)),
    fieldOfView: 0.5 + 2.4 * s(gene(4)),
    diet: s(gene(5) * 1.5),
    hue: (((gene(6) * 60) % 360) + 360) % 360,
    mutationRate: 0.01 + 0.2 * s(gene(7)),
    breedThreshold: 0.45 + 0.5 * s(gene(8)),
    offspringShare: 0.2 + 0.4 * s(gene(9)),
    clock: 0.005 + 0.12 * s(gene(10)),
  };
}

export type Instinct = "grazer" | "hunter";

/** Index of the weight from input `i` (or the bias when i === N_INPUTS) to hidden neuron `h`. */
export function inputWeightIndex(i: number, h: number): number {
  return N_TRAITS + h * (N_INPUTS + 1) + i;
}

/** Index of the weight from hidden neuron `h` (or the bias when h === N_HIDDEN) to output `o`. */
export function outputWeightIndex(h: number, o: number): number {
  return N_TRAITS + N_HIDDEN * (N_INPUTS + 1) + o * (N_HIDDEN + 1) + h;
}

/**
 * A random starting genome with a few hard-wired instincts.
 *
 * Founders are born knowing how to steer towards food, move and eat. This
 * only seeds the first generation: every weight is free to mutate, and
 * within a few hundred generations little of the original wiring is left.
 */
export function randomGenome(rng: Rng, instinct: Instinct = "grazer"): Genome {
  const g: Genome = new Array<number>(GENOME_LENGTH);
  for (let i = 0; i < N_TRAITS; i++) g[i] = rng.gaussian() * 0.8;
  g[6] = rng.range(0, 6); // hue
  for (let i = N_TRAITS; i < GENOME_LENGTH; i++) g[i] = rng.gaussian() * 0.5;

  // input indices: 2..4 plants, 5..7 creatures, 8..10 meat (left, ahead, right)
  const steer = (hidden: number, left: number, right: number, gain: number): void => {
    g[inputWeightIndex(left, hidden)] = -gain;
    g[inputWeightIndex(right, hidden)] = gain;
    g[inputWeightIndex(N_INPUTS, hidden)] = 0;
    g[outputWeightIndex(hidden, 1)] = 2.2; // turn towards the stronger side
  };
  if (instinct === "grazer") {
    g[5] = -1.3 + rng.gaussian() * 0.5; // plant eater with a taste for scavenging
    steer(0, 2, 4, 3);
  } else {
    g[0] = 0.6 + rng.gaussian() * 0.3; // larger body
    g[1] = 1 + rng.gaussian() * 0.3; // fast
    g[3] = 0.8; // sharp senses
    g[5] = 1.5 + rng.gaussian() * 0.3; // mostly meat
    steer(0, 8, 10, 3.2); // carrion first
    steer(1, 5, 7, 2.4); // then living prey
  }
  g[outputWeightIndex(N_HIDDEN, 0)] = 1.2 + rng.gaussian() * 0.3; // keep moving
  g[outputWeightIndex(N_HIDDEN, 2)] = 1 + rng.gaussian() * 0.3; // bite when something is in reach
  g[outputWeightIndex(N_HIDDEN, 3)] = 0.5 + rng.gaussian() * 0.3; // breed when able
  return g;
}

/**
 * Gaussian point mutation. Each gene mutates with the genome's own
 * (evolvable) mutation rate, so lineages can tune their own evolvability.
 */
export function mutate(parent: Genome, rng: Rng, scale = 1): Genome {
  const rate = decodeTraits(parent).mutationRate;
  const child = parent.slice();
  for (let i = 0; i < child.length; i++) {
    if (rng.next() < rate * Math.max(scale, 0.0001)) {
      const strength = i < N_TRAITS ? 0.35 : 0.5;
      child[i] = clamp((child[i] ?? 0) + rng.gaussian() * strength * scale, -8, 8);
    }
  }
  // Rare macro-mutation on one trait keeps exploring new niches.
  if (scale > 0 && rng.next() < 0.02 * scale) {
    const i = rng.int(0, N_TRAITS);
    child[i] = clamp((child[i] ?? 0) + rng.gaussian() * 1.5, -8, 8);
  }
  return child;
}

/** Uniform crossover per gene, with trait genes and each neuron's weights kept in blocks. */
export function crossover(a: Genome, b: Genome, rng: Rng): Genome {
  const child = new Array<number>(GENOME_LENGTH);
  for (let i = 0; i < N_TRAITS; i++) child[i] = rng.next() < 0.5 ? (a[i] ?? 0) : (b[i] ?? 0);
  // Inherit whole neurons so functional circuits are not shredded.
  let offset = N_TRAITS;
  const blocks: number[] = [
    ...new Array<number>(N_HIDDEN).fill(N_INPUTS + 1),
    ...new Array<number>(N_OUTPUTS).fill(N_HIDDEN + 1),
  ];
  for (const width of blocks) {
    const src = rng.next() < 0.5 ? a : b;
    for (let j = 0; j < width; j++) child[offset + j] = src[offset + j] ?? 0;
    offset += width;
  }
  return child;
}

/**
 * Genetic distance in roughly [0, 2]. Traits weigh more than individual
 * weights because they describe body plan and niche.
 */
export function distance(a: Genome, b: Genome): number {
  let traitSum = 0;
  for (let i = 0; i < N_TRAITS; i++) {
    const w = i === 5 ? 2 : i === 6 ? 0.25 : 1; // diet matters most, colour least
    traitSum += w * Math.abs(Math.tanh((a[i] ?? 0) / 2) - Math.tanh((b[i] ?? 0) / 2));
  }
  let brainSum = 0;
  for (let i = N_TRAITS; i < GENOME_LENGTH; i++) {
    brainSum += Math.abs(Math.tanh((a[i] ?? 0) / 2) - Math.tanh((b[i] ?? 0) / 2));
  }
  return (traitSum / (N_TRAITS + 1.25)) * 1.2 + (brainSum / N_WEIGHTS) * 0.8;
}

export function isGenome(value: unknown): value is Genome {
  return (
    Array.isArray(value) &&
    value.length === GENOME_LENGTH &&
    value.every((v) => typeof v === "number" && Number.isFinite(v))
  );
}
