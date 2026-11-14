/**
 * Save and load complete worlds as JSON.
 *
 * A snapshot holds everything needed to continue a run exactly where it
 * stopped, including the random generator state, so a loaded world evolves
 * the same way the original would have.
 */

import { makeConfig, type WorldConfig } from "../core/config.js";
import { Rng, type RngState } from "../core/rng.js";
import { Creature, type CreatureState } from "./creature.js";
import { isGenome } from "./genome.js";
import { Chronicle, History, type ChronicleEntry, type Sample } from "./history.js";
import { SpeciesRegistry, type Species } from "./species.js";
import { World, type ActiveEffect, type Meat, type Plant } from "./world.js";

export const SNAPSHOT_VERSION = 1;

export interface Snapshot {
  primordia: number;
  seed: string;
  config: WorldConfig;
  tick: number;
  rng: RngState;
  rngSpare: number | null;
  counters: World["counters"];
  creatures: CreatureState[];
  plants: Plant[];
  meat: Meat[];
  effects: ActiveEffect[];
  species: { nextId: number; species: Species[] };
  history: { samples: Sample[]; stride: number; skipped: number; capacity: number };
  chronicle: ChronicleEntry[];
}

export class SnapshotError extends Error {
  override name = "SnapshotError";
}

export function saveWorld(world: World): Snapshot {
  return {
    primordia: SNAPSHOT_VERSION,
    seed: world.seed,
    config: { ...world.config },
    tick: world.tick,
    rng: world.rng.state,
    rngSpare: world.rng.spare,
    counters: world.counters,
    creatures: world.creatures.map((c) => c.toState()),
    plants: world.plants.map((p) => ({ ...p })),
    meat: world.meat.map((m) => ({ ...m })),
    effects: world.effects.map((e) => ({ ...e })),
    species: world.species.toJSON(),
    history: world.history.toJSON(),
    chronicle: world.chronicle.entries.map((e) => ({ ...e })),
  };
}

function fail(message: string): never {
  throw new SnapshotError(`invalid save file: ${message}`);
}

export function loadWorld(data: unknown): World {
  if (typeof data !== "object" || data === null) fail("not an object");
  const snap = data as Partial<Snapshot>;
  if (snap.primordia !== SNAPSHOT_VERSION) fail(`unsupported version ${String(snap.primordia)}`);
  if (typeof snap.seed !== "string" || typeof snap.tick !== "number" || !Number.isFinite(snap.tick)) {
    fail("missing seed or tick");
  }
  if (!Array.isArray(snap.rng) || snap.rng.length !== 4 || !snap.rng.every((v) => Number.isInteger(v))) {
    fail("bad random generator state");
  }
  if (!Array.isArray(snap.creatures) || !Array.isArray(snap.plants) || !Array.isArray(snap.meat)) {
    fail("missing entity lists");
  }
  if (!snap.species || !Array.isArray(snap.species.species) || !snap.history || !snap.counters) {
    fail("missing species, history or counters");
  }
  let config: WorldConfig;
  try {
    config = makeConfig({ ...(snap.config ?? {}) });
  } catch (error) {
    fail(error instanceof Error ? error.message : "bad config");
  }

  const world = new World(snap.seed, config, { populate: false });
  world.tick = snap.tick;
  const spare = typeof snap.rngSpare === "number" && Number.isFinite(snap.rngSpare) ? snap.rngSpare : null;
  world.rng = Rng.fromState(snap.rng, spare);
  world.species = SpeciesRegistry.fromJSON(snap.species, world.rng, config.speciesThreshold);
  for (const state of snap.creatures) {
    if (!isGenome(state.genome)) fail(`creature ${String(state.id)} has a malformed genome`);
    if (![state.x, state.y, state.energy, state.heading].every((v) => Number.isFinite(v))) {
      fail(`creature ${String(state.id)} has non-numeric state`);
    }
    if (!world.species.get(state.speciesId)) fail(`creature ${String(state.id)} references an unknown species`);
    world.creatures.push(new Creature(state, config.baseLifespan));
  }
  world.plants = snap.plants.map((p) => ({ ...p }));
  world.meat = snap.meat.map((m) => ({ ...m }));
  world.effects = (snap.effects ?? []).map((e) => ({ ...e }));
  world.history = History.fromJSON(snap.history);
  world.chronicle = new Chronicle();
  world.chronicle.entries = (snap.chronicle ?? []).map((e) => ({ ...e }));
  world.restoreCounters(snap.counters);
  world.recountSpecies();
  return world;
}
