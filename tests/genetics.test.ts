import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Rng } from "../src/core/rng.js";
import { Brain } from "../src/sim/brain.js";
import {
  crossover,
  decodeTraits,
  distance,
  GENOME_LENGTH,
  isGenome,
  mutate,
  N_HIDDEN,
  N_INPUTS,
  N_OUTPUTS,
  N_TRAITS,
  outputWeightIndex,
  inputWeightIndex,
  randomGenome,
} from "../src/sim/genome.js";
import { ESTABLISHED, SpeciesRegistry, speciesName } from "../src/sim/species.js";

describe("genome", () => {
  it("random genomes are valid and decode into physical ranges", () => {
    const rng = new Rng("g");
    for (let i = 0; i < 200; i++) {
      const g = randomGenome(rng, i % 2 ? "hunter" : "grazer");
      assert.ok(isGenome(g));
      const t = decodeTraits(g);
      assert.ok(t.size >= 3 && t.size <= 10);
      assert.ok(t.maxSpeed > 0 && t.maxSpeed < 4);
      assert.ok(t.diet >= 0 && t.diet <= 1);
      assert.ok(t.hue >= 0 && t.hue < 360);
      assert.ok(t.fieldOfView > 0 && t.fieldOfView < Math.PI);
      assert.ok(t.mutationRate > 0 && t.mutationRate < 0.25);
    }
  });

  it("extreme genes never leave the valid range", () => {
    const high = decodeTraits(new Array<number>(GENOME_LENGTH).fill(8));
    const low = decodeTraits(new Array<number>(GENOME_LENGTH).fill(-8));
    for (const t of [high, low]) {
      assert.ok(Object.values(t).every((v) => Number.isFinite(v)));
      assert.ok(t.size >= 3 && t.size <= 10 && t.diet >= 0 && t.diet <= 1);
    }
  });

  it("founders differ by instinct: grazers eat plants, hunters eat meat", () => {
    const rng = new Rng("instinct");
    assert.ok(decodeTraits(randomGenome(rng, "grazer")).diet < 0.35);
    assert.ok(decodeTraits(randomGenome(rng, "hunter")).diet > 0.65);
  });

  it("mutation changes some genes, keeps them bounded, and never mutates the parent", () => {
    const rng = new Rng("m");
    const parent = randomGenome(rng);
    const copy = parent.slice();
    const child = mutate(parent, rng, 1);
    assert.deepEqual(parent, copy);
    assert.equal(child.length, GENOME_LENGTH);
    const changed = child.filter((v, i) => v !== parent[i]).length;
    assert.ok(changed > 0 && changed < GENOME_LENGTH / 2, `changed ${changed}`);
    let g = parent;
    for (let i = 0; i < 300; i++) g = mutate(g, rng, 5);
    assert.ok(g.every((v) => v >= -8 && v <= 8));
    assert.deepEqual(mutate(parent, rng, 0), parent);
  });

  it("crossover takes every gene from one parent, in whole-neuron blocks", () => {
    const rng = new Rng("x");
    const a = new Array<number>(GENOME_LENGTH).fill(1);
    const b = new Array<number>(GENOME_LENGTH).fill(-1);
    const child = crossover(a, b, rng);
    assert.ok(child.every((v) => v === 1 || v === -1));
    for (let h = 0; h < N_HIDDEN; h++) {
      const block: (number | undefined)[] = [];
      for (let i = 0; i <= N_INPUTS; i++) block.push(child[inputWeightIndex(i, h)]);
      assert.equal(new Set(block).size, 1, `hidden neuron ${h} was split`);
    }
    assert.ok(new Set(child).size === 2, "child should mix both parents");
  });

  it("distance is a symmetric, zero-on-identity measure that grows with mutation", () => {
    const rng = new Rng("d");
    const a = randomGenome(rng);
    assert.equal(distance(a, a), 0);
    const near = mutate(a, rng, 1);
    let far = a;
    for (let i = 0; i < 80; i++) far = mutate(far, rng, 2);
    assert.equal(distance(a, near), distance(near, a));
    assert.ok(distance(a, near) < distance(a, far));
    assert.ok(distance(a, far) < 2.5);
  });

  it("rejects malformed genomes", () => {
    assert.equal(isGenome([1, 2, 3]), false);
    assert.equal(isGenome(new Array<number>(GENOME_LENGTH).fill(NaN)), false);
    assert.equal(isGenome("nope"), false);
  });
});

describe("brain", () => {
  it("is a pure function of weights and inputs, with outputs in range", () => {
    const rng = new Rng("b");
    const g = randomGenome(rng);
    const a = new Brain(g);
    const b = new Brain(g);
    for (let step = 0; step < 50; step++) {
      for (let i = 0; i < N_INPUTS; i++) a.inputs[i] = b.inputs[i] = rng.range(-1, 1);
      const oa = a.think();
      assert.deepEqual(oa, b.think());
      assert.ok(oa.thrust >= -0.3 - 1e-9 && oa.thrust <= 1 + 1e-9);
      assert.ok(oa.turn >= -1 && oa.turn <= 1);
      assert.ok(oa.bite >= 0 && oa.bite <= 1 && oa.breed >= 0 && oa.breed <= 1);
    }
    assert.equal(a.outputs.length, N_OUTPUTS);
  });

  it("weight accessors match the genome layout", () => {
    const g = new Array<number>(GENOME_LENGTH).fill(0);
    g[inputWeightIndex(3, 2)] = 0.75;
    g[outputWeightIndex(N_HIDDEN, 1)] = -0.5;
    const brain = new Brain(g);
    assert.equal(brain.inputWeight(3, 2), 0.75);
    assert.equal(brain.outputWeight(N_HIDDEN, 1), -0.5);
    assert.equal(inputWeightIndex(0, 0), N_TRAITS);
  });

  it("the grazer instinct steers towards plants", () => {
    const g = randomGenome(new Rng("steer"), "grazer");
    const brain = new Brain(g);
    brain.inputs.fill(0);
    brain.inputs[4] = 1; // plant on the right
    const right = brain.think().turn;
    brain.inputs[4] = 0;
    brain.inputs[2] = 1; // plant on the left
    const left = brain.think().turn;
    assert.ok(right > left, `turn right ${right} should exceed turn left ${left}`);
  });
});

describe("species", () => {
  it("names are deterministic binomials", () => {
    const name = speciesName(new Rng("n"));
    assert.equal(name, speciesName(new Rng("n")));
    assert.match(name, /^[A-Z][a-z]+ [a-z]+$/);
  });

  it("keeps close relatives together and splits distant genomes", () => {
    const rng = new Rng("s");
    const reg = new SpeciesRegistry(rng, 0.2);
    const founderGenome = randomGenome(rng);
    const founder = reg.found(founderGenome, null, 0);
    reg.addMember(founder);
    const same = reg.classify(mutate(founderGenome, rng, 0.3), founder.id, 10);
    assert.equal(same.species.id, founder.id);
    assert.equal(same.isNew, false);
    let far = founderGenome;
    for (let i = 0; i < 200; i++) far = mutate(far, rng, 3);
    const split = reg.classify(far, founder.id, 20);
    assert.equal(split.isNew, true);
    assert.equal(split.species.parentId, founder.id);
    assert.deepEqual(
      reg.ancestry(split.species.id).map((s) => s.id),
      [founder.id, split.species.id],
    );
  });

  it("tracks establishment, extinction and survives a JSON round trip", () => {
    const rng = new Rng("e");
    const reg = new SpeciesRegistry(rng, 0.2);
    const s = reg.found(randomGenome(rng), null, 0);
    const established = Array.from({ length: ESTABLISHED }, () => reg.addMember(s));
    assert.deepEqual(established, [false, false, false, false, true]);
    assert.equal(s.peakPopulation, ESTABLISHED);
    for (let i = 0; i < ESTABLISHED - 1; i++) assert.equal(reg.removeMember(s, 50), false);
    assert.equal(reg.removeMember(s, 99), true);
    assert.equal(s.extinctTick, 99);
    assert.equal(reg.living.length, 0);
    const copy = SpeciesRegistry.fromJSON(JSON.parse(JSON.stringify(reg.toJSON())), rng, 0.2);
    assert.deepEqual(copy.all, reg.all);
    assert.equal(copy.found(randomGenome(rng), null, 1).id, 2);
  });

  it("prunes only forgotten, childless offshoots", () => {
    const rng = new Rng("p");
    const reg = new SpeciesRegistry(rng, 0.2);
    const root = reg.found(randomGenome(rng), null, 0);
    const child = reg.found(randomGenome(rng), root.id, 5);
    const twig = reg.found(randomGenome(rng), root.id, 6);
    for (const s of [root, child, twig]) {
      reg.addMember(s);
      reg.removeMember(s, 10);
    }
    reg.found(randomGenome(rng), child.id, 12);
    assert.equal(reg.prune(100_000), 1); // only the extinct, unreferenced twig
    assert.ok(reg.get(root.id) && reg.get(child.id));
    assert.equal(reg.get(twig.id), undefined);
  });
});
