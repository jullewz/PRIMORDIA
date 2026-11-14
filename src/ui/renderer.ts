/** Canvas renderer for the world view. */

import { TAU } from "../core/math.js";
import type { Creature } from "../sim/creature.js";
import type { World } from "../sim/world.js";
import type { Camera } from "./camera.js";

export type ColorMode = "genome" | "species" | "diet" | "energy" | "generation";

export interface ViewOptions {
  colorMode: ColorMode;
  halos: boolean;
  vision: boolean;
  highlightSpecies: number | null;
  selectedId: number | null;
}

const BG = "#07070a";

export class Renderer {
  private readonly ctx: CanvasRenderingContext2D;
  private terrain: HTMLCanvasElement | null = null;
  private terrainFor: World | null = null;
  private readonly halos = new Map<number, HTMLCanvasElement>();
  private dpr = 1;

  constructor(private readonly canvas: HTMLCanvasElement) {
    const ctx = canvas.getContext("2d", { alpha: false });
    if (!ctx) throw new Error("this browser does not support 2D canvas");
    this.ctx = ctx;
  }

  resize(): { width: number; height: number } {
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    const width = this.canvas.clientWidth;
    const height = this.canvas.clientHeight;
    this.canvas.width = Math.round(width * this.dpr);
    this.canvas.height = Math.round(height * this.dpr);
    return { width, height };
  }

  private buildTerrain(world: World): HTMLCanvasElement {
    const f = world.fertility;
    const canvas = document.createElement("canvas");
    canvas.width = f.cols;
    canvas.height = f.rows;
    const ctx = canvas.getContext("2d");
    if (!ctx) return canvas;
    const image = ctx.createImageData(f.cols, f.rows);
    for (let i = 0; i < f.values.length; i++) {
      const v = f.values[i] ?? 0;
      image.data[i * 4] = 7 + v * 8;
      image.data[i * 4 + 1] = 7 + v * 34;
      image.data[i * 4 + 2] = 10 + v * 38;
      image.data[i * 4 + 3] = 255;
    }
    ctx.putImageData(image, 0, 0);
    return canvas;
  }

  private halo(hue: number): HTMLCanvasElement {
    const bucket = Math.round(hue / 12) * 12;
    let sprite = this.halos.get(bucket);
    if (!sprite) {
      sprite = document.createElement("canvas");
      sprite.width = sprite.height = 64;
      const ctx = sprite.getContext("2d");
      if (ctx) {
        const g = ctx.createRadialGradient(32, 32, 2, 32, 32, 32);
        g.addColorStop(0, `hsla(${bucket}, 85%, 65%, 0.5)`);
        g.addColorStop(0.4, `hsla(${bucket}, 85%, 60%, 0.14)`);
        g.addColorStop(1, `hsla(${bucket}, 85%, 60%, 0)`);
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, 64, 64);
      }
      this.halos.set(bucket, sprite);
    }
    return sprite;
  }

  creatureHue(c: Creature, world: World, mode: ColorMode): { hue: number; sat: number; light: number } {
    switch (mode) {
      case "species":
        return { hue: world.species.get(c.speciesId)?.hue ?? c.traits.hue, sat: 72, light: 60 };
      case "diet":
        return { hue: 150 - c.traits.diet * 150, sat: 75, light: 56 };
      case "energy":
        return { hue: 265, sat: 30 + c.energyFraction * 60, light: 28 + c.energyFraction * 44 };
      case "generation": {
        const max = world.history.last?.maxGeneration || 1;
        return { hue: 200 + (c.generation / max) * 130, sat: 75, light: 60 };
      }
      default:
        return { hue: c.traits.hue, sat: 72, light: 60 };
    }
  }

  draw(world: World, camera: Camera, view: ViewOptions): void {
    const ctx = this.ctx;
    const { width: W, height: H } = world.config;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.fillStyle = BG;
    ctx.fillRect(0, 0, camera.viewWidth, camera.viewHeight);

    if (this.terrainFor !== world) {
      this.terrain = this.buildTerrain(world);
      this.terrainFor = world;
    }

    const b = camera.bounds;
    const tx0 = Math.max(Math.floor(b.left / W), -2);
    const tx1 = Math.min(Math.floor(b.right / W), 2);
    const ty0 = Math.max(Math.floor(b.top / H), -2);
    const ty1 = Math.min(Math.floor(b.bottom / H), 2);
    const z = camera.zoom;
    const detail = z > 0.55;
    const winter = world.winter;

    for (let ty = ty0; ty <= ty1; ty++) {
      for (let tx = tx0; tx <= tx1; tx++) {
        ctx.setTransform(
          this.dpr * z,
          0,
          0,
          this.dpr * z,
          this.dpr * (camera.viewWidth / 2 + (tx * W - camera.x) * z),
          this.dpr * (camera.viewHeight / 2 + (ty * H - camera.y) * z),
        );
        const left = b.left - tx * W;
        const right = b.right - tx * W;
        const top = b.top - ty * H;
        const bottom = b.bottom - ty * H;
        const visible = (x: number, y: number, r: number): boolean =>
          x + r >= left && x - r <= right && y + r >= top && y - r <= bottom;

        if (this.terrain) {
          ctx.imageSmoothingEnabled = true;
          ctx.drawImage(this.terrain, 0, 0, W, H);
        }
        if (winter > 0.02) {
          ctx.fillStyle = `rgba(160, 190, 255, ${winter * 0.055})`;
          ctx.fillRect(0, 0, W, H);
        }
        ctx.strokeStyle = "rgba(167, 139, 250, 0.16)";
        ctx.lineWidth = 1 / z;
        ctx.strokeRect(0, 0, W, H);

        // plants
        ctx.fillStyle = "#34d399";
        ctx.globalAlpha = 0.85;
        const ps = detail ? 1.5 : 2.2;
        ctx.beginPath();
        for (const p of world.plants) {
          if (!visible(p.x, p.y, 3)) continue;
          ctx.moveTo(p.x + ps, p.y);
          ctx.arc(p.x, p.y, ps, 0, TAU);
        }
        ctx.fill();

        // meat
        ctx.fillStyle = "#f59e0b";
        ctx.globalAlpha = 0.8;
        ctx.beginPath();
        for (const m of world.meat) {
          if (!visible(m.x, m.y, 6)) continue;
          const r = 1.2 + Math.sqrt(m.energy) * 0.32;
          ctx.moveTo(m.x + r, m.y);
          ctx.arc(m.x, m.y, r, 0, TAU);
        }
        ctx.fill();
        ctx.globalAlpha = 1;

        // creatures
        const useHalos = view.halos && detail && world.creatures.length < 900;
        for (const c of world.creatures) {
          const s = c.traits.size;
          if (!visible(c.x, c.y, s * 4 + (c.id === view.selectedId ? c.traits.senseRange : 0))) continue;
          const dim = view.highlightSpecies !== null && c.speciesId !== view.highlightSpecies;
          const col = this.creatureHue(c, world, view.colorMode);
          const alpha = dim ? 0.12 : 0.5 + 0.5 * c.energyFraction;

          if (c.id === view.selectedId && view.vision) this.drawVision(c);
          if (useHalos && !dim) {
            ctx.globalCompositeOperation = "lighter";
            ctx.drawImage(this.halo(col.hue), c.x - s * 3.2, c.y - s * 3.2, s * 6.4, s * 6.4);
            ctx.globalCompositeOperation = "source-over";
          }
          ctx.globalAlpha = alpha;
          this.drawBody(c, col, detail);
          ctx.globalAlpha = 1;
          if (c.id === view.selectedId) {
            ctx.strokeStyle = "#ffffff";
            ctx.lineWidth = 1.4 / z;
            ctx.setLineDash([4 / z, 3 / z]);
            ctx.beginPath();
            ctx.arc(c.x, c.y, s + 5 / z + 2, 0, TAU);
            ctx.stroke();
            ctx.setLineDash([]);
          }
        }
      }
    }
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
  }

  private drawVision(c: Creature): void {
    const ctx = this.ctx;
    const half = c.traits.fieldOfView / 2;
    ctx.beginPath();
    ctx.moveTo(c.x, c.y);
    ctx.arc(c.x, c.y, c.traits.senseRange, c.heading - half, c.heading + half);
    ctx.closePath();
    ctx.fillStyle = "rgba(167, 139, 250, 0.07)";
    ctx.fill();
    ctx.strokeStyle = "rgba(167, 139, 250, 0.3)";
    ctx.lineWidth = 0.6;
    ctx.stroke();
    const third = c.traits.fieldOfView / 6;
    ctx.beginPath();
    for (const a of [-third, third]) {
      ctx.moveTo(c.x, c.y);
      ctx.lineTo(
        c.x + Math.cos(c.heading + a) * c.traits.senseRange,
        c.y + Math.sin(c.heading + a) * c.traits.senseRange,
      );
    }
    ctx.strokeStyle = "rgba(167, 139, 250, 0.14)";
    ctx.stroke();
  }

  private drawBody(c: Creature, col: { hue: number; sat: number; light: number }, detail: boolean): void {
    const ctx = this.ctx;
    const s = c.traits.size;
    const cos = Math.cos(c.heading);
    const sin = Math.sin(c.heading);
    const diet = c.traits.diet;
    const fill = `hsl(${col.hue}, ${col.sat}%, ${col.light}%)`;
    const dark = `hsl(${col.hue}, ${col.sat}%, ${col.light * 0.45}%)`;

    if (detail) {
      // tail: longer for fast swimmers
      const tail = s * (0.8 + c.traits.maxSpeed * 0.35);
      ctx.strokeStyle = dark;
      ctx.lineWidth = Math.max(0.8, s * 0.28);
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.moveTo(c.x - cos * s * 0.8, c.y - sin * s * 0.8);
      ctx.lineTo(c.x - cos * (s + tail), c.y - sin * (s + tail));
      ctx.stroke();
      // jaws grow with carnivory and open while biting
      if (diet > 0.3) {
        const open = c.biting ? 0.75 : 0.35;
        const len = s * (0.5 + diet * 0.9);
        ctx.strokeStyle = diet > 0.65 ? "#fb7185" : "#fbbf24";
        ctx.lineWidth = Math.max(0.8, s * 0.22);
        ctx.beginPath();
        for (const side of [-1, 1]) {
          const a = c.heading + side * open;
          ctx.moveTo(c.x + Math.cos(a) * s * 0.85, c.y + Math.sin(a) * s * 0.85);
          ctx.lineTo(c.x + Math.cos(a) * s * 0.85 + cos * len, c.y + Math.sin(a) * s * 0.85 + sin * len);
        }
        ctx.stroke();
      }
    }
    ctx.fillStyle = fill;
    ctx.beginPath();
    ctx.ellipse(c.x, c.y, s * 1.12, s * 0.88, c.heading, 0, TAU);
    ctx.fill();
    if (detail) {
      ctx.strokeStyle = dark;
      ctx.lineWidth = Math.max(0.6, s * 0.14);
      ctx.stroke();
      // eye
      ctx.fillStyle = "#0b0b10";
      ctx.beginPath();
      ctx.arc(c.x + cos * s * 0.55, c.y + sin * s * 0.55, Math.max(0.7, s * 0.22), 0, TAU);
      ctx.fill();
    }
  }
}
