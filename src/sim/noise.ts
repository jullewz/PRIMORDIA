/**
 * Seamless (tileable) value noise used for the fertility map.
 * Tileable so the wrap-around world has no visible seam at its edges.
 */

import type { Rng } from "../core/rng.js";

export class TileableNoise {
  private readonly lattice: Float64Array;

  constructor(
    rng: Rng,
    private readonly cellsX: number,
    private readonly cellsY: number,
  ) {
    this.lattice = new Float64Array(cellsX * cellsY);
    for (let i = 0; i < this.lattice.length; i++) this.lattice[i] = rng.next();
  }

  private at(ix: number, iy: number): number {
    const x = ((ix % this.cellsX) + this.cellsX) % this.cellsX;
    const y = ((iy % this.cellsY) + this.cellsY) % this.cellsY;
    return this.lattice[y * this.cellsX + x] ?? 0;
  }

  /** Smooth noise in [0, 1] for coordinates in lattice units. */
  sample(x: number, y: number): number {
    const ix = Math.floor(x);
    const iy = Math.floor(y);
    const fx = x - ix;
    const fy = y - iy;
    const sx = fx * fx * (3 - 2 * fx);
    const sy = fy * fy * (3 - 2 * fy);
    const a = this.at(ix, iy);
    const b = this.at(ix + 1, iy);
    const c = this.at(ix, iy + 1);
    const d = this.at(ix + 1, iy + 1);
    return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
  }
}

/** A precomputed fertility map in [0, 1] built from several noise octaves. */
export class FertilityMap {
  readonly cols: number;
  readonly rows: number;
  readonly cell: number;
  readonly values: Float64Array;

  constructor(rng: Rng, width: number, height: number, scale: number, cell = 20) {
    this.cell = cell;
    this.cols = Math.ceil(width / cell);
    this.rows = Math.ceil(height / cell);
    this.values = new Float64Array(this.cols * this.rows);
    const octaves = [
      { freq: 1, amp: 1 },
      { freq: 2, amp: 0.5 },
      { freq: 4, amp: 0.25 },
    ];
    const layers = octaves.map((o) => {
      const cx = Math.max(2, Math.round(width * scale * o.freq));
      const cy = Math.max(2, Math.round(height * scale * o.freq));
      return { noise: new TileableNoise(rng, cx, cy), cx, cy, amp: o.amp };
    });
    const total = octaves.reduce((sum, o) => sum + o.amp, 0);
    let max = 0;
    for (let r = 0; r < this.rows; r++) {
      for (let c = 0; c < this.cols; c++) {
        const u = ((c + 0.5) * cell) / width;
        const v = ((r + 0.5) * cell) / height;
        let value = 0;
        for (const layer of layers) value += layer.amp * layer.noise.sample(u * layer.cx, v * layer.cy);
        value /= total;
        // sharpen into distinct fertile regions and barren plains
        const shaped = Math.max(0, (value - 0.38) / 0.62) ** 1.6;
        this.values[r * this.cols + c] = shaped;
        if (shaped > max) max = shaped;
      }
    }
    if (max > 0) for (let i = 0; i < this.values.length; i++) this.values[i] = (this.values[i] ?? 0) / max;
  }

  at(x: number, y: number): number {
    const c = Math.min(this.cols - 1, Math.max(0, Math.floor(x / this.cell)));
    const r = Math.min(this.rows - 1, Math.max(0, Math.floor(y / this.cell)));
    return this.values[r * this.cols + c] ?? 0;
  }
}
