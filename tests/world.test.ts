import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { loadWorld, saveWorld, SnapshotError } from "../src/sim/serialize.js";
import { World } from "../src/sim/world.js";

const SMALL = { width: 700, height: 500, initialCreatures: 50, maxCreatures: 300, maxPlants: 700, plantGrowth: 2.5 };

/** A compact fingerprint of the whole world state. */
function fingerprint(w: World): string {
  const c = w.creatures.map((x) => `${x.id}:${x.x.toFixed(6)}:${x.y.toFixed(6)}:${x.energy.toFixed(6)}:${x.speciesId}`);
  return [w.tick, w.creatures.length, w.plants.length, w.meat.length, w.species.all.length, ...c].join("|");
}

describe("World", () => {
  it("starts with two founding lineages and the configured population", () => {
    const w = new World("genesis", SMALL);
    assert.equal(w.creatures.length, 50);
    assert.ok(w.plants.length > 0);
    const roles = new Set(w.creatures.map((c) => c.role));
    assert.ok(roles.has("herbivore") && roles.has("carnivore"));
    assert.equal(w.chronicle.entries[0]?.kind, "genesis");
    assert.equal(
      w.species.living.reduce((n, s) => n + s.population, 0),
      50,
    );
  });

  it("is deterministic: same seed and config give the same history", () => {
    const a = new World("repeatable", SMALL);
    const b = new World("repeatable", SMALL);
    a.run(1500);
    b.run(1500);
    assert.equal(fingerprint(a), fingerprint(b));
    assert.deepEqual(a.chronicle.entries, b.chronicle.entries);
    const c = new World("different", SMALL);
    c.run(1500);
    assert.notEqual(fingerprint(a), fingerprint(c));
  });

  it("keeps every invariant over a long run", () => {
    const w = new World("invariants", SMALL);
    for (let i = 0; i < 40; i++) {
      w.run(100);
      assert.ok(w.creatures.length <= SMALL.maxCreatures);
      assert.ok(w.plants.length <= SMALL.maxPlants);
      const ids = new Set<number>();
      for (const c of w.creatures) {
        assert.ok(c.alive);
        assert.ok(Number.isFinite(c.x) && c.x >= 0 && c.x < SMALL.width, `x ${c.x}`);
        assert.ok(Number.isFinite(c.y) && c.y >= 0 && c.y < SMALL.height, `y ${c.y}`);
        assert.ok(Number.isFinite(c.energy) && c.energy > 0 && c.energy <= c.maxEnergy + 1e-9);
        assert.ok(Math.abs(c.speed) <= c.traits.maxSpeed + 1e-9);
        assert.ok(c.age <= c.lifespan + 1);
        assert.ok(w.species.get(c.speciesId), "creature must belong to a known species");
        assert.ok(!ids.has(c.id), "duplicate creature id");
        ids.add(c.id);
      }
      const counted = new Map<number, number>();
      for (const c of w.creatures) counted.set(c.speciesId, (counted.get(c.speciesId) ?? 0) + 1);
      for (const s of w.species.all) assert.equal(s.population, counted.get(s.id) ?? 0, `population of ${s.name}`);
    }
    assert.ok(w.history.samples.length > 100);
    assert.ok((w.history.last?.maxGeneration ?? 0) > 0, "creatures should have reproduced");
  });

  it("evolves: later generations differ from the founders", () => {
    const w = new World("evolve", SMALL);
    const founders = new Set(w.creatures.map((c) => c.genome.join(",")));
    w.run(6000);
    const last = w.history.last;
    assert.ok(last && last.maxGeneration >= 5, `generation ${last?.maxGeneration}`);
    assert.ok(
      w.creatures.every((c) => !founders.has(c.genome.join(","))),
      "no founder genome should survive unchanged",
    );
    assert.ok(w.species.all.length > 2, "new species should have appeared");
  });

  it("saves and loads without changing the future", () => {
    const original = new World("continuity", SMALL);
    original.run(800);
    const snapshot = JSON.parse(JSON.stringify(saveWorld(original))) as unknown;
    const restored = loadWorld(snapshot);
    assert.equal(fingerprint(restored), fingerprint(original));
    original.run(700);
    restored.run(700);
    assert.equal(fingerprint(restored), fingerprint(original));
    assert.deepEqual(restored.history.samples, original.history.samples);
    assert.deepEqual(restored.chronicle.entries, original.chronicle.entries);
  });

  it("rejects malformed save files with a clear error", () => {
    const good = JSON.parse(JSON.stringify(saveWorld(new World("s", SMALL)))) as Record<string, unknown>;
    const broken: [string, (d: Record<string, unknown>) => void][] = [
      ["version", (d) => (d["primordia"] = 99)],
      ["random generator", (d) => (d["rng"] = [1, 2])],
      ["entity lists", (d) => delete d["plants"]],
      ["genome", (d) => ((d["creatures"] as { genome: number[] }[])[0]!.genome = [1, 2, 3])],
      ["unknown species", (d) => ((d["creatures"] as { speciesId: number }[])[0]!.speciesId = 9999)],
      ["between", (d) => ((d["config"] as { width: number }).width = -5)],
    ];
    for (const [message, corrupt] of broken) {
      const copy = structuredClone(good);
      corrupt(copy);
      assert.throws(
        () => loadWorld(copy),
        (e) => e instanceof SnapshotError && e.message.includes(message),
        message,
      );
    }
    assert.throws(() => loadWorld(null), SnapshotError);
    assert.throws(() => loadWorld("text"), SnapshotError);
  });

  it("recovers from total extinction through abiogenesis", () => {
    const w = new World("apocalypse", SMALL);
    for (const c of [...w.creatures]) w.cull(c);
    assert.equal(w.creatures.length, 0);
    w.step();
    assert.ok(w.creatures.length >= 8);
    assert.ok(w.chronicle.entries.some((e) => e.kind === "abiogenesis"));
  });

  it("environmental events have their documented effects", () => {
    const w = new World("events", SMALL);
    w.run(50);
    const before = w.creatures.length;
    w.trigger("meteor", { x: 350, y: 250 });
    assert.ok(w.creatures.length < before, "meteor should kill");
    const normal = w.growthFactor;
    w.trigger("drought");
    assert.ok(w.growthFactor < normal * 0.25);
    w.run(1600);
    assert.ok(!w.effects.some((e) => e.kind === "drought"), "drought should expire");
    w.plants.length = 0;
    w.trigger("bloom");
    assert.ok(w.plants.length > 300);
    const pop = w.creatures.length;
    w.trigger("invasion");
    assert.ok(w.creatures.length > pop);
    assert.ok(w.chronicle.entries.filter((e) => e.kind === "event").length >= 4);
  });

  it("seasons swing growth between 1 and 1 - seasonStrength", () => {
    const w = new World("seasons", { ...SMALL, seasonLength: 1000, seasonStrength: 0.6 });
    assert.ok(Math.abs(w.growthFactor - 1) < 1e-9);
    w.run(500);
    assert.ok(Math.abs(w.growthFactor - 0.4) < 1e-6);
    assert.ok(Math.abs(w.winter - 1) < 1e-6);
  });

  it("interventions: feed, propagate, cull, adjust and lookup", () => {
    const w = new World("tools", SMALL);
    const plants = w.plants.length;
    w.feed(100, 100, 30, 10);
    assert.equal(w.plants.length, plants + 10);
    const c = w.creatures[0]!;
    assert.equal(w.creatureAt(c.x, c.y)?.id, c.id);
    assert.equal(w.findCreature(c.id), c);
    const n = w.creatures.length;
    assert.equal(w.propagate(c, 5), 5);
    assert.equal(w.creatures.length, n + 5);
    w.cull(c);
    assert.equal(w.findCreature(c.id), undefined);
    w.adjust("plantGrowth", 9);
    assert.equal(w.config.plantGrowth, 9);
    assert.throws(() => w.adjust("plantGrowth", -1));
    assert.throws(() => w.adjust("width", 900), /cannot change/);
  });

  it("kinship recognises the same and directly related species", () => {
    const w = new World("kin", SMALL);
    const [a, b] = [
      w.creatures[0]!,
      w.creatures.find((c) => c.speciesId === w.creatures[0]!.speciesId && c !== w.creatures[0])!,
    ];
    assert.equal(w.kinship(a, b), 1);
    const stranger = w.creatures.find((c) => c.role !== a.role)!;
    assert.ok(w.kinship(a, stranger) < 1);
  });
});

describe("headless CLI", () => {
  const cli = fileURLToPath(new URL("../src/cli/run.js", import.meta.url));

  it("runs a world, prints a summary and writes a loadable save", () => {
    const dir = mkdtempSync(join(tmpdir(), "primordia-"));
    const save = join(dir, "world.json");
    const args = [
      "--seed",
      "cli",
      "--ticks",
      "600",
      "--set",
      "width=700",
      "--set",
      "height=500",
      "--set",
      "initialCreatures=40",
      "--json",
      "--save",
      save,
    ];
    const out = JSON.parse(
      execFileSync(process.execPath, [cli, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }),
    ) as { tick: number; seed: string; population: number };
    assert.equal(out.tick, 600);
    assert.equal(out.seed, "cli");
    const world = loadWorld(JSON.parse(readFileSync(save, "utf8")));
    assert.equal(world.tick, 600);
    assert.equal(world.creatures.length, out.population);
    const again = JSON.parse(
      execFileSync(process.execPath, [cli, "--load", save, "--ticks", "100", "--json"], { encoding: "utf8" }),
    ) as { tick: number };
    assert.equal(again.tick, 700);
  });

  it("reports usage errors with exit code 2", () => {
    for (const args of [
      ["--bogus"],
      ["--ticks", "many"],
      ["--preset", "nope"],
      ["--set", "plantGrowth=99999"],
      ["--load", "/no/such/file.json"],
    ]) {
      const r = spawnSync(process.execPath, [cli, ...args], { encoding: "utf8" });
      assert.equal(r.status, 2, args.join(" "));
      assert.match(r.stderr, /primordia:/);
    }
    const help = spawnSync(process.execPath, [cli, "--help"], { encoding: "utf8" });
    assert.equal(help.status, 0);
    assert.match(help.stdout, /--seed/);
  });
});
