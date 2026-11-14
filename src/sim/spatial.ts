/**
 * Uniform spatial hash grid on a torus.
 *
 * Rebuilt every tick (cheap: O(n)), queried for neighbours within a radius.
 * Queries visit cells in a fixed order, so results are deterministic.
 */

export interface Positioned {
  x: number;
  y: number;
}

export class SpatialGrid<T extends Positioned> {
  private readonly cols: number;
  private readonly rows: number;
  private readonly cells: T[][];

  constructor(
    readonly width: number,
    readonly height: number,
    readonly cellSize: number,
  ) {
    this.cols = Math.max(1, Math.floor(width / cellSize));
    this.rows = Math.max(1, Math.floor(height / cellSize));
    this.cells = Array.from({ length: this.cols * this.rows }, () => []);
  }

  private index(x: number, y: number): number {
    const c = Math.min(this.cols - 1, Math.floor((x / this.width) * this.cols));
    const r = Math.min(this.rows - 1, Math.floor((y / this.height) * this.rows));
    return r * this.cols + c;
  }

  clear(): void {
    for (const cell of this.cells) cell.length = 0;
  }

  insert(item: T): void {
    this.cells[this.index(item.x, item.y)]?.push(item);
  }

  rebuild(items: Iterable<T>): void {
    this.clear();
    for (const item of items) this.insert(item);
  }

  /** Call `visit` for every item whose cell is within `radius` of (x, y), wrapping at edges. */
  forEachNear(x: number, y: number, radius: number, visit: (item: T) => void): void {
    const cw = this.width / this.cols;
    const ch = this.height / this.rows;
    const rc = Math.min(Math.ceil(radius / cw), Math.floor((this.cols - 1) / 2));
    const rr = Math.min(Math.ceil(radius / ch), Math.floor((this.rows - 1) / 2));
    const c0 = Math.floor((x / this.width) * this.cols);
    const r0 = Math.floor((y / this.height) * this.rows);
    for (let dr = -rr; dr <= rr; dr++) {
      const r = (((r0 + dr) % this.rows) + this.rows) % this.rows;
      for (let dc = -rc; dc <= rc; dc++) {
        const c = (((c0 + dc) % this.cols) + this.cols) % this.cols;
        const cell = this.cells[r * this.cols + c];
        if (cell) for (const item of cell) visit(item);
      }
    }
  }
}
