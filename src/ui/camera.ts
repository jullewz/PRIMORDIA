/** Pan/zoom camera over the wrap-around world. */

import { clamp, wrap, wrapDelta } from "../core/math.js";

export class Camera {
  x: number;
  y: number;
  zoom = 1;
  viewWidth = 1;
  viewHeight = 1;

  constructor(
    private readonly worldWidth: number,
    private readonly worldHeight: number,
  ) {
    this.x = worldWidth / 2;
    this.y = worldHeight / 2;
  }

  resize(viewWidth: number, viewHeight: number): void {
    this.viewWidth = viewWidth;
    this.viewHeight = viewHeight;
    this.zoom = clamp(this.zoom, this.minZoom, 8);
  }

  /** Zoom at which the whole world fits the view. */
  get fitZoom(): number {
    return Math.min(this.viewWidth / this.worldWidth, this.viewHeight / this.worldHeight);
  }

  get minZoom(): number {
    return this.fitZoom * 0.6;
  }

  fit(): void {
    this.zoom = this.fitZoom * 0.96;
    this.x = this.worldWidth / 2;
    this.y = this.worldHeight / 2;
  }

  toWorld(sx: number, sy: number): { x: number; y: number } {
    return {
      x: wrap(this.x + (sx - this.viewWidth / 2) / this.zoom, this.worldWidth),
      y: wrap(this.y + (sy - this.viewHeight / 2) / this.zoom, this.worldHeight),
    };
  }

  pan(dxScreen: number, dyScreen: number): void {
    this.x = wrap(this.x - dxScreen / this.zoom, this.worldWidth);
    this.y = wrap(this.y - dyScreen / this.zoom, this.worldHeight);
  }

  /** Zoom keeping the world point under the cursor fixed. */
  zoomAt(sx: number, sy: number, factor: number): void {
    const before = {
      x: this.x + (sx - this.viewWidth / 2) / this.zoom,
      y: this.y + (sy - this.viewHeight / 2) / this.zoom,
    };
    this.zoom = clamp(this.zoom * factor, this.minZoom, 8);
    this.x = wrap(before.x - (sx - this.viewWidth / 2) / this.zoom, this.worldWidth);
    this.y = wrap(before.y - (sy - this.viewHeight / 2) / this.zoom, this.worldHeight);
  }

  /** Ease towards a world position along the shortest wrapped path. */
  follow(x: number, y: number, ease = 0.12): void {
    this.x = wrap(this.x + wrapDelta(this.x, x, this.worldWidth) * ease, this.worldWidth);
    this.y = wrap(this.y + wrapDelta(this.y, y, this.worldHeight) * ease, this.worldHeight);
  }

  /** World-space rectangle currently visible (not wrapped). */
  get bounds(): { left: number; top: number; right: number; bottom: number } {
    const hw = this.viewWidth / 2 / this.zoom;
    const hh = this.viewHeight / 2 / this.zoom;
    return { left: this.x - hw, top: this.y - hh, right: this.x + hw, bottom: this.y + hh };
  }
}
