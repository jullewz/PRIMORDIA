/**
 * The neural network every creature carries: inputs -> tanh hidden layer -> outputs.
 *
 * Weights live in the genome. Two outputs feed back as inputs on the next
 * tick, giving the network a small working memory, and an oscillator input
 * lets it produce rhythmic behaviour without any external cue.
 */

import { N_HIDDEN, N_INPUTS, N_OUTPUTS, N_TRAITS, type Genome } from "./genome.js";

export interface BrainOutput {
  /** -0.3 .. 1, fraction of max speed (slight reverse allowed). */
  thrust: number;
  /** -1 .. 1, fraction of max turn rate. */
  turn: number;
  /** 0 .. 1, > 0.5 means eat or bite. */
  bite: number;
  /** 0 .. 1, > 0.5 means try to reproduce. */
  breed: number;
  memoryA: number;
  memoryB: number;
}

export class Brain {
  readonly inputs = new Float64Array(N_INPUTS);
  readonly hidden = new Float64Array(N_HIDDEN);
  readonly outputs = new Float64Array(N_OUTPUTS);
  private readonly w: Float64Array;

  constructor(genome: Genome) {
    this.w = Float64Array.from(genome.slice(N_TRAITS));
  }

  /** Weight from input i (or bias when i === N_INPUTS) to hidden neuron h. */
  inputWeight(i: number, h: number): number {
    return this.w[h * (N_INPUTS + 1) + i] ?? 0;
  }

  /** Weight from hidden neuron h (or bias when h === N_HIDDEN) to output o. */
  outputWeight(h: number, o: number): number {
    return this.w[N_HIDDEN * (N_INPUTS + 1) + o * (N_HIDDEN + 1) + h] ?? 0;
  }

  think(): BrainOutput {
    const w = this.w;
    const x = this.inputs;
    for (let h = 0; h < N_HIDDEN; h++) {
      const base = h * (N_INPUTS + 1);
      let sum = w[base + N_INPUTS] ?? 0; // bias
      for (let i = 0; i < N_INPUTS; i++) sum += (w[base + i] ?? 0) * (x[i] ?? 0);
      this.hidden[h] = Math.tanh(sum);
    }
    const offset = N_HIDDEN * (N_INPUTS + 1);
    for (let o = 0; o < N_OUTPUTS; o++) {
      const base = offset + o * (N_HIDDEN + 1);
      let sum = w[base + N_HIDDEN] ?? 0;
      for (let h = 0; h < N_HIDDEN; h++) sum += (w[base + h] ?? 0) * (this.hidden[h] ?? 0);
      this.outputs[o] = sum;
    }
    const out = this.outputs;
    const tanh = Math.tanh;
    const sig = (v: number): number => 1 / (1 + Math.exp(-v));
    return {
      thrust: 0.35 + 0.65 * tanh(out[0] ?? 0),
      turn: tanh(out[1] ?? 0),
      bite: sig(out[2] ?? 0),
      breed: sig(out[3] ?? 0),
      memoryA: tanh(out[4] ?? 0),
      memoryB: tanh(out[5] ?? 0),
    };
  }
}
