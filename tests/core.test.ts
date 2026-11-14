import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ConfigError, DEFAULT_CONFIG, makeConfig, presetConfig, PRESETS } from "../src/core/config.js";
import { clamp, mean, normAngle, wrap, wrapDelta } from "../src/core/math.js";
import { hashSeed, Rng } from "../src/core/rng.js";
import { Chronicle, History, type Sample } from "../src/sim/history.js";
import { FertilityMap, TileableNoise } from "../src/sim/noise.js";
import { SpatialGrid } from "../src/sim/spatial.js";

describe("Rng", () => {
  it("is deterministic per seed and differs between seeds", () => {
    const a = new Rng("primordia");
    const b = new Rng("primordia");
    const c = new Rng("other");
    const seqA = Array.from({ length: 50 }, () => a.nextU32());
    assert.deepEqual(
      seqA,
      Array.from({ length: 50 }, () => b.nextU32()),
    );
    assert.notDeepEqual(
      seqA,
      Array.from({ length: 50 }, () => c.nextU32()),
    );
    assert.equal(hashSeed(42), hashSeed("42"));
  });

  it("restores exactly from saved state", () => {
    const a = new Rng(7);
    for (let i = 0; i < 100; i++) a.next();
    a.gaussian(); // leaves a cached spare value behind
    const b = Rng.fromState(a.state, a.spare);
    for (let i = 0; i < 100; i++) assert.equal(a.gaussian(), b.gaussian());
    for (let i = 0; i < 100; i++) assert.equal(a.nextU32(), b.nextU32());
  });

  it("produces uniform floats in [0, 1) with a sane mean", () => {
    const rng = new Rng("uniform");
    const values = Array.from({ length: 20000 }, () => rng.next());
    assert.ok(values.every((v) => v >= 0 && v < 1));
    assert.ok(Math.abs(mean(values) - 0.5) < 0.01);
  });

  it("produces gaussians with mean 0 and variance 1", () => {
    const rng = new Rng("normal");
    const values = Array.from({ length: 40000 }, () => rng.gaussian());
    const m = mean(values);
    const variance = mean(values.map((v) => (v - m) ** 2));
    assert.ok(Math.abs(m) < 0.02, `mean ${m}`);
    assert.ok(Math.abs(variance - 1) < 0.04, `variance ${variance}`);
  });

  it("int, range, pick and chance stay in bounds", () => {
    const rng = new Rng(1);
    for (let i = 0; i < 2000; i++) {
      const n = rng.int(3, 9);
      assert.ok(Number.isInteger(n) && n >= 3 && n < 9);
      const r = rng.range(-2, 2);
      assert.ok(r >= -2 && r < 2);
    }
    assert.ok(["a", "b"].includes(rng.pick(["a", "b"])));
    assert.throws(() => rng.pick([]));
    assert.equal(rng.chance(0), false);
    assert.equal(rng.chance(1), true);
  });
});

describe("math", () => {
  it("wraps coordinates and finds the shortest path around the torus", () => {
    assert.equal(wrap(105, 100), 5);
    assert.equal(wrap(-5, 100), 95);
    assert.equal(wrapDelta(95, 5, 100), 10);
    assert.equal(wrapDelta(5, 95, 100), -10);
    assert.equal(wrapDelta(10, 30, 100), 20);
  });

  it("normalises angles into (-PI, PI]", () => {
    assert.ok(Math.abs(normAngle(3 * Math.PI) - Math.PI) < 1e-9);
    assert.ok(Math.abs(normAngle(-3.5 * Math.PI) - 0.5 * Math.PI) < 1e-9);
    assert.equal(clamp(5, 0, 3), 3);
  });
});

describe("config", () => {
  it("applies overrides and accepts numeric strings", () => {
    const c = makeConfig({ plantGrowth: "3.5", maxCreatures: 500 });
    assert.equal(c.plantGrowth, 3.5);
    assert.equal(c.maxCreatures, 500);
    assert.equal(c.width, DEFAULT_CONFIG.width);
  });

  it("rejects unknown, out-of-range and non-integer values", () => {
    assert.throws(() => makeConfig({ plantGrowht: 1 }), ConfigError);
    assert.throws(() => makeConfig({ seasonStrength: 2 }), /between 0 and 1/);
    assert.throws(() => makeConfig({ width: 1000.5 }), /whole number/);
    assert.throws(() => makeConfig({ width: "wide" }), /must be a number/);
    assert.throws(() => makeConfig({ initialCreatures: 500, maxCreatures: 100 }), /cannot exceed/);
  });

  it("every preset is valid", () => {
    for (const p of PRESETS) assert.ok(presetConfig(p.id).width > 0, p.id);
    assert.throws(() => presetConfig("nope"), ConfigError);
  });
});

describe("noise and fertility", () => {
  it("tiles seamlessly", () => {
    const noise = new TileableNoise(new Rng(3), 8, 5);
    for (const [x, y] of [
      [0.3, 1.7],
      [7.9, 4.2],
      [3.3, 0.1],
    ] as const) {
      assert.ok(Math.abs(noise.sample(x, y) - noise.sample(x + 8, y)) < 1e-12);
      assert.ok(Math.abs(noise.sample(x, y) - noise.sample(x, y + 5)) < 1e-12);
    }
  });

  it("fertility is normalised to [0, 1] and deterministic", () => {
    const a = new FertilityMap(new Rng("t"), 800, 600, 0.004);
    const b = new FertilityMap(new Rng("t"), 800, 600, 0.004);
    assert.deepEqual([...a.values], [...b.values]);
    assert.ok(a.values.every((v) => v >= 0 && v <= 1));
    assert.ok(Math.max(...a.values) === 1);
    assert.ok(a.at(-5, 99999) >= 0);
  });
});

describe("SpatialGrid", () => {
  it("finds every item within the radius, across the wrap", () => {
    const rng = new Rng("grid");
    const items = Array.from({ length: 400 }, (_, id) => ({ id, x: rng.range(0, 500), y: rng.range(0, 300) }));
    const grid = new SpatialGrid<(typeof items)[number]>(500, 300, 40);
    grid.rebuild(items);
    for (const [qx, qy, radius] of [
      [5, 5, 60],
      [490, 295, 45],
      [250, 150, 90],
    ] as const) {
      const found = new Set<number>();
      grid.forEachNear(qx, qy, radius, (it) => found.add(it.id));
      for (const it of items) {
        const d = Math.hypot(wrapDelta(qx, it.x, 500), wrapDelta(qy, it.y, 300));
        if (d <= radius) assert.ok(found.has(it.id), `missed item at distance ${d}`);
      }
    }
  });

  it("never visits an item twice, even with a radius larger than the world", () => {
    const grid = new SpatialGrid<{ x: number; y: number }>(100, 100, 30);
    const item = { x: 50, y: 50 };
    grid.insert(item);
    let visits = 0;
    grid.forEachNear(10, 10, 5000, () => visits++);
    assert.equal(visits, 1);
  });
});

describe("History and Chronicle", () => {
  const sample = (tick: number): Sample => ({
    tick,
    population: 1,
    plants: 0,
    meat: 0,
    species: 0,
    herbivores: 0,
    omnivores: 0,
    carnivores: 0,
    avgSize: 0,
    avgSpeed: 0,
    avgSense: 0,
    avgDiet: 0,
    avgGeneration: 0,
    maxGeneration: 0,
    births: 0,
    deaths: 0,
    season: 0,
    bySpecies: {},
  });

  it("down-samples instead of growing without bound", () => {
    const h = new History(100);
    for (let i = 0; i < 5000; i++) h.offer(() => sample(i));
    assert.ok(h.samples.length <= 100);
    assert.ok(h.stride > 1);
    const ticks = h.samples.map((s) => s.tick);
    assert.deepEqual(
      ticks,
      [...ticks].sort((a, b) => a - b),
    );
    assert.ok((h.last?.tick ?? 0) > 4800);
    const copy = History.fromJSON(JSON.parse(JSON.stringify(h.toJSON())));
    assert.deepEqual(copy.samples, h.samples);
  });

  it("chronicle is bounded and filters by tick", () => {
    const c = new Chronicle(10);
    for (let i = 0; i < 25; i++) c.add({ tick: i, kind: "event", text: `e${i}` });
    assert.equal(c.entries.length, 10);
    assert.equal(c.since(22).length, 2);
  });
});
