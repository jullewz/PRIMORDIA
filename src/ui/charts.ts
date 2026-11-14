/** Small canvas charts: line charts, stacked areas, the species stream and the phylogeny tree. */

import { N_HIDDEN, N_INPUTS, N_OUTPUTS, INPUT_LABELS, OUTPUT_LABELS } from "../sim/genome.js";
import type { Creature } from "../sim/creature.js";
import type { Sample } from "../sim/history.js";
import type { Species } from "../sim/species.js";

const GRID = "rgba(255,255,255,0.06)";
const TEXT = "#8a8a96";
const FONT = '10px "JetBrains Mono", ui-monospace, Menlo, Consolas, monospace';

/** Prepare a canvas for crisp drawing and return its CSS-pixel size. */
export function prepare(canvas: HTMLCanvasElement): { ctx: CanvasRenderingContext2D; w: number; h: number } | null {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  if (w === 0 || h === 0) return null;
  if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
  }
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);
  ctx.font = FONT;
  return { ctx, w, h };
}

export interface Series {
  label: string;
  color: string;
  values: number[];
}

export function lineChart(
  canvas: HTMLCanvasElement,
  series: Series[],
  opts: { min?: number; max?: number } = {},
): void {
  const p = prepare(canvas);
  if (!p) return;
  const { ctx, w, h } = p;
  const pad = { l: 30, r: 6, t: 6, b: 14 };
  const n = Math.max(...series.map((s) => s.values.length), 0);
  const all = series.flatMap((s) => s.values);
  const max = opts.max ?? Math.max(1, ...all) * 1.08;
  const min = opts.min ?? 0;
  const px = (i: number): number => pad.l + (n <= 1 ? 0 : (i / (n - 1)) * (w - pad.l - pad.r));
  const py = (v: number): number => h - pad.b - ((v - min) / (max - min || 1)) * (h - pad.t - pad.b);

  ctx.strokeStyle = GRID;
  ctx.fillStyle = TEXT;
  ctx.lineWidth = 1;
  for (let i = 0; i <= 2; i++) {
    const v = min + ((max - min) * i) / 2;
    const y = Math.round(py(v)) + 0.5;
    ctx.beginPath();
    ctx.moveTo(pad.l, y);
    ctx.lineTo(w - pad.r, y);
    ctx.stroke();
    ctx.fillText(v >= 100 ? String(Math.round(v)) : v.toFixed(v < 10 ? 1 : 0), 2, y + 3);
  }
  for (const s of series) {
    if (s.values.length < 2) continue;
    ctx.strokeStyle = s.color;
    ctx.lineWidth = 1.5;
    ctx.lineJoin = "round";
    ctx.beginPath();
    s.values.forEach((v, i) => (i === 0 ? ctx.moveTo(px(i), py(v)) : ctx.lineTo(px(i), py(v))));
    ctx.stroke();
  }
  let lx = pad.l + 4;
  for (const s of series) {
    ctx.fillStyle = s.color;
    ctx.fillRect(lx, h - 8, 7, 3);
    ctx.fillStyle = TEXT;
    ctx.fillText(s.label, lx + 10, h - 3);
    lx += ctx.measureText(s.label).width + 24;
  }
}

/** Stacked area chart. `layers` are drawn bottom to top. */
export function stackedArea(canvas: HTMLCanvasElement, layers: Series[], normalise = false): void {
  const p = prepare(canvas);
  if (!p) return;
  const { ctx, w, h } = p;
  const n = Math.max(...layers.map((l) => l.values.length), 0);
  if (n < 2) return;
  const totals = Array.from({ length: n }, (_, i) => layers.reduce((sum, l) => sum + (l.values[i] ?? 0), 0));
  const max = normalise ? 1 : Math.max(1, ...totals);
  const px = (i: number): number => (i / (n - 1)) * w;
  const base = new Array<number>(n).fill(0);
  for (const layer of layers) {
    const top = base.map((b, i) => {
      const v = layer.values[i] ?? 0;
      return b + (normalise ? v / (totals[i] || 1) : v);
    });
    ctx.beginPath();
    for (let i = 0; i < n; i++) ctx.lineTo(px(i), h - ((top[i] ?? 0) / max) * h);
    for (let i = n - 1; i >= 0; i--) ctx.lineTo(px(i), h - ((base[i] ?? 0) / max) * h);
    ctx.closePath();
    ctx.fillStyle = layer.color;
    ctx.fill();
    for (let i = 0; i < n; i++) base[i] = top[i] ?? 0;
  }
}

export function speciesColor(s: Species, alpha = 1): string {
  return `hsla(${s.hue}, 70%, 58%, ${alpha})`;
}

/** Species populations over time as a stacked stream. */
export function speciesStream(
  canvas: HTMLCanvasElement,
  samples: Sample[],
  species: Map<number, Species>,
  highlight: number | null,
): void {
  const ids = new Map<number, number>();
  for (const s of samples)
    for (const [id, n] of Object.entries(s.bySpecies)) ids.set(Number(id), (ids.get(Number(id)) ?? 0) + n);
  const order = [...ids.keys()].sort(
    (a, b) => (species.get(a)?.bornTick ?? 0) - (species.get(b)?.bornTick ?? 0) || a - b,
  );
  const layers: Series[] = order.map((id) => {
    const sp = species.get(id);
    const dim = highlight !== null && highlight !== id;
    return {
      label: sp?.name ?? String(id),
      color: sp ? speciesColor(sp, dim ? 0.18 : 0.9) : "#555",
      values: samples.map((s) => s.bySpecies[id] ?? 0),
    };
  });
  stackedArea(canvas, layers);
}

export interface TreeHit {
  speciesId: number;
  x0: number;
  x1: number;
  y: number;
}

/**
 * Phylogeny: one horizontal life-line per established species (birth to
 * extinction), joined to its parent at the moment it branched off.
 * Returns hit boxes so the caller can make lines clickable.
 */
export function phylogeny(canvas: HTMLCanvasElement, all: Species[], now: number, highlight: number | null): TreeHit[] {
  const p = prepare(canvas);
  if (!p) return [];
  const { ctx, w, h } = p;
  const shown = new Set(all.filter((s) => s.established).map((s) => s.id));
  const byId = new Map(all.map((s) => [s.id, s]));
  // nearest shown ancestor, so hidden short-lived offshoots do not break the tree
  const parentOf = (s: Species): number | null => {
    let pid = s.parentId;
    while (pid !== null) {
      if (shown.has(pid)) return pid;
      pid = byId.get(pid)?.parentId ?? null;
    }
    return null;
  };
  const children = new Map<number | null, Species[]>();
  for (const s of all) {
    if (!shown.has(s.id)) continue;
    const key = parentOf(s);
    children.set(key, [...(children.get(key) ?? []), s]);
  }
  const rows: Species[] = [];
  const visit = (id: number | null): void => {
    for (const s of (children.get(id) ?? []).sort((a, b) => a.bornTick - b.bornTick)) {
      rows.push(s);
      visit(s.id);
    }
  };
  visit(null);
  if (rows.length === 0) return [];

  const pad = { l: 6, r: 6, t: 6, b: 14 };
  const maxRows = Math.max(1, Math.floor((h - pad.t - pad.b) / 5));
  // too many species: keep the living and the longest-lived
  let visible = rows;
  if (rows.length > maxRows) {
    const keep = new Set(
      [...rows]
        .sort(
          (a, b) =>
            Number(b.extinctTick === null) - Number(a.extinctTick === null) || b.peakPopulation - a.peakPopulation,
        )
        .slice(0, maxRows)
        .map((s) => s.id),
    );
    visible = rows.filter((s) => keep.has(s.id));
  }
  const rowH = Math.min(14, (h - pad.t - pad.b) / visible.length);
  const start = Math.min(...visible.map((s) => s.bornTick));
  const span = Math.max(1, now - start);
  const x = (tick: number): number => pad.l + ((tick - start) / span) * (w - pad.l - pad.r);
  const yOf = new Map<number, number>();
  visible.forEach((s, i) => yOf.set(s.id, pad.t + rowH * (i + 0.5)));

  const hits: TreeHit[] = [];
  for (const s of visible) {
    const y = yOf.get(s.id) ?? 0;
    const x0 = x(s.bornTick);
    const x1 = x(s.extinctTick ?? now);
    const alive = s.extinctTick === null;
    const dim = highlight !== null && highlight !== s.id;
    const parentY = yOf.get(parentOf(s) ?? -1);
    ctx.strokeStyle = speciesColor(s, dim ? 0.15 : alive ? 0.95 : 0.4);
    if (parentY !== undefined) {
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x0, parentY);
      ctx.lineTo(x0, y);
      ctx.stroke();
    }
    ctx.lineWidth = alive ? Math.min(4, 1.5 + Math.log10(1 + s.population)) : 1.4;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(x0, y);
    ctx.lineTo(Math.max(x1, x0 + 1), y);
    ctx.stroke();
    if (!alive && !dim) {
      ctx.fillStyle = speciesColor(s, 0.5);
      ctx.fillRect(x1 - 1, y - 3, 2, 6);
    }
    hits.push({ speciesId: s.id, x0, x1: Math.max(x1, x0 + 4), y });
  }
  ctx.fillStyle = TEXT;
  ctx.fillText(`tick ${start.toLocaleString("en-US")}`, pad.l, h - 3);
  const label = `now ${now.toLocaleString("en-US")}`;
  ctx.fillText(label, w - pad.r - ctx.measureText(label).width, h - 3);
  return hits;
}

/** Live diagram of a creature's neural network: node brightness is activation, edges are weights. */
export function brainDiagram(canvas: HTMLCanvasElement, c: Creature): void {
  const p = prepare(canvas);
  if (!p) return;
  const { ctx, w, h } = p;
  const colX = [86, w / 2 + 6, w - 70];
  const yFor = (i: number, n: number): number => 10 + (i + 0.5) * ((h - 20) / n);
  const edge = (weight: number): string => {
    const a = Math.min(0.85, Math.abs(weight) * 0.22);
    return weight >= 0 ? `rgba(167,139,250,${a})` : `rgba(251,146,60,${a})`;
  };
  ctx.lineWidth = 1;
  for (let hn = 0; hn < N_HIDDEN; hn++) {
    for (let i = 0; i < N_INPUTS; i++) {
      const wt = c.brain.inputWeight(i, hn);
      if (Math.abs(wt) < 0.6) continue;
      ctx.strokeStyle = edge(wt * Math.abs(c.brain.inputs[i] ?? 0) + wt * 0.25);
      ctx.beginPath();
      ctx.moveTo(colX[0] ?? 0, yFor(i, N_INPUTS));
      ctx.lineTo(colX[1] ?? 0, yFor(hn, N_HIDDEN));
      ctx.stroke();
    }
    for (let o = 0; o < N_OUTPUTS; o++) {
      const wt = c.brain.outputWeight(hn, o);
      if (Math.abs(wt) < 0.6) continue;
      ctx.strokeStyle = edge(wt * Math.abs(c.brain.hidden[hn] ?? 0) + wt * 0.25);
      ctx.beginPath();
      ctx.moveTo(colX[1] ?? 0, yFor(hn, N_HIDDEN));
      ctx.lineTo(colX[2] ?? 0, yFor(o, N_OUTPUTS));
      ctx.stroke();
    }
  }
  const node = (x: number, y: number, activation: number, r: number): void => {
    const a = Math.max(-1, Math.min(1, activation));
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fillStyle = a >= 0 ? `rgba(196,181,253,${0.15 + a * 0.85})` : `rgba(251,146,60,${0.15 - a * 0.85})`;
    ctx.fill();
    ctx.strokeStyle = "rgba(255,255,255,0.25)";
    ctx.stroke();
  };
  ctx.textBaseline = "middle";
  for (let i = 0; i < N_INPUTS; i++) {
    const y = yFor(i, N_INPUTS);
    node(colX[0] ?? 0, y, c.brain.inputs[i] ?? 0, 4);
    ctx.fillStyle = TEXT;
    ctx.textAlign = "right";
    ctx.fillText(INPUT_LABELS[i] ?? "", (colX[0] ?? 0) - 9, y);
  }
  for (let hn = 0; hn < N_HIDDEN; hn++) node(colX[1] ?? 0, yFor(hn, N_HIDDEN), c.brain.hidden[hn] ?? 0, 5);
  const out = c.lastOutput;
  const outValues = out ? [out.thrust, out.turn, out.bite * 2 - 1, out.breed * 2 - 1, out.memoryA, out.memoryB] : [];
  for (let o = 0; o < N_OUTPUTS; o++) {
    const y = yFor(o, N_OUTPUTS);
    node(colX[2] ?? 0, y, outValues[o] ?? 0, 5);
    ctx.fillStyle = TEXT;
    ctx.textAlign = "left";
    ctx.fillText(OUTPUT_LABELS[o] ?? "", (colX[2] ?? 0) + 10, y);
  }
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
}
