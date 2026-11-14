/**
 * The world: plants, meat, creatures, species and the fixed-step update loop.
 *
 * One call to `step()` advances time by one tick:
 *
 *   1. seasons and environmental events update growth conditions
 *   2. plants grow where the land is fertile, corpses decay
 *   3. spatial grids are rebuilt
 *   4. every creature senses, thinks and acts (move, eat, bite, breed)
 *   5. the dead become meat, the newborn join their species
 *   6. statistics and the chronicle are updated
 *
 * All randomness comes from `this.rng`, and creatures are processed in a
 * stable order, so the same seed and config always produce the same history.
 */

import { makeConfig, type WorldConfig } from "../core/config.js";
import { TAU, normAngle, wrap, wrapDelta } from "../core/math.js";
import { Rng } from "../core/rng.js";
import { Creature, emptyStats, type DeathCause } from "./creature.js";
import { crossover, mutate, randomGenome, type Genome } from "./genome.js";
import { Chronicle, History, type Sample } from "./history.js";
import { FertilityMap } from "./noise.js";
import { SpatialGrid } from "./spatial.js";
import { SpeciesRegistry, type Species } from "./species.js";

export interface Plant {
  id: number;
  x: number;
  y: number;
  energy: number;
}

export interface Meat {
  id: number;
  x: number;
  y: number;
  energy: number;
}

export type EventKind = "meteor" | "drought" | "bloom" | "radiation" | "iceAge" | "invasion";

export interface ActiveEffect {
  kind: EventKind;
  until: number;
}

export const EVENT_INFO: Record<EventKind, { label: string; description: string }> = {
  meteor: { label: "Meteor strike", description: "Wipes out most life in a wide crater." },
  drought: { label: "Drought", description: "Plant growth drops to a fifth for 1,500 ticks." },
  bloom: { label: "Algal bloom", description: "A burst of food across fertile land." },
  radiation: { label: "Cosmic radiation", description: "Mutation rates quadruple for 1,000 ticks." },
  iceAge: { label: "Ice age", description: "Long, brutal winter: growth falls for 4,000 ticks." },
  invasion: { label: "Predator invasion", description: "A pack of unrelated hunters arrives." },
};

const MEAT_DECAY = 0.996;
const BREED_AGE = 150;
const BREED_COOLDOWN = 90;
const MIN_POPULATION = 8;

export class World {
  readonly config: WorldConfig;
  readonly seed: string;
  rng: Rng;
  tick = 0;
  creatures: Creature[] = [];
  plants: Plant[] = [];
  meat: Meat[] = [];
  species: SpeciesRegistry;
  history = new History();
  chronicle = new Chronicle();
  effects: ActiveEffect[] = [];
  readonly fertility: FertilityMap;

  private nextId = 1;
  private births = 0;
  private deaths = 0;
  private peakPopulation = 0;
  private recentPeak = 0;
  private recentPeakTick = 0;
  private generationMilestone = 0;
  private readonly plantGrid: SpatialGrid<Plant>;
  private readonly meatGrid: SpatialGrid<Meat>;
  private readonly creatureGrid: SpatialGrid<Creature>;

  constructor(seed: string | number, config: Partial<WorldConfig> = {}, options: { populate?: boolean } = {}) {
    this.seed = String(seed);
    this.config = makeConfig(config);
    this.rng = new Rng(this.seed);
    // The fertility map uses its own stream so terrain is identical regardless of population settings.
    this.fertility = new FertilityMap(
      new Rng(`${this.seed}:terrain`),
      this.config.width,
      this.config.height,
      this.config.fertilityScale,
    );
    this.species = new SpeciesRegistry(this.rng, this.config.speciesThreshold);
    const cell = 60;
    this.plantGrid = new SpatialGrid(this.config.width, this.config.height, cell);
    this.meatGrid = new SpatialGrid(this.config.width, this.config.height, cell);
    this.creatureGrid = new SpatialGrid(this.config.width, this.config.height, cell);
    if (options.populate !== false) this.populate();
  }

  // ------------------------------------------------------------------ setup
  private populate(): void {
    for (let i = 0; i < this.config.maxPlants * 0.6; i++) this.spawnPlant();
    // Two founding lineages: grazers, and a smaller group of hunters and scavengers.
    const grazer = this.species.found(randomGenome(this.rng), null, 0);
    const hunterGenome = randomGenome(this.rng, "hunter");
    hunterGenome[6] = (grazer.founder[6] ?? 0) + 3; // contrasting colour
    const hunter = this.species.found(hunterGenome, null, 0);
    this.chronicle.add({
      tick: 0,
      kind: "genesis",
      speciesId: grazer.id,
      text: `Life begins with two lineages: the grazing ${grazer.name} and the predatory ${hunter.name}.`,
    });
    const hunters = Math.max(2, Math.round(this.config.initialCreatures * 0.15));
    for (let i = 0; i < this.config.initialCreatures; i++) {
      const founder = i < hunters ? hunter : grazer;
      // Loose variation around each founder, so selection has material to work with.
      const genome = mutate(founder.founder, this.rng, 1.5);
      const { species } = this.species.classify(genome, founder.id, 0);
      this.spawn(
        genome,
        this.rng.range(0, this.config.width),
        this.rng.range(0, this.config.height),
        null,
        0,
        species,
        null,
      );
    }
  }

  newId(): number {
    return this.nextId++;
  }

  private spawn(
    genome: Genome,
    x: number,
    y: number,
    parent: Creature | null,
    generation: number,
    species: Species,
    mate: Creature | null,
    energy?: number,
    attach = true,
  ): Creature {
    const creature = new Creature(
      {
        id: this.newId(),
        genome,
        x: wrap(x, this.config.width),
        y: wrap(y, this.config.height),
        heading: this.rng.range(0, TAU),
        speed: 0,
        energy: 0,
        age: 0,
        generation,
        speciesId: species.id,
        parentId: parent?.id ?? null,
        mateId: mate?.id ?? null,
        bornTick: this.tick,
        breedCooldown: BREED_COOLDOWN,
        memory: [0, 0],
        stats: emptyStats(),
      },
      this.config.baseLifespan,
    );
    creature.energy = energy ?? creature.maxEnergy * 0.6;
    if (attach) this.creatures.push(creature);
    if (this.species.addMember(species) && species.parentId !== null) {
      const parentSpecies = this.species.get(species.parentId);
      const role = species.diet > 0.65 ? "predatory " : species.diet > 0.35 ? "omnivorous " : "";
      this.chronicle.add({
        tick: this.tick,
        kind: "speciation",
        speciesId: species.id,
        text: `A new ${role}species, ${species.name}, branches off from ${parentSpecies?.name ?? "an unknown ancestor"}.`,
      });
    }
    return creature;
  }

  private spawnPlant(x?: number, y?: number): void {
    if (this.plants.length >= this.config.maxPlants) return;
    let px = x ?? 0;
    let py = y ?? 0;
    if (x === undefined || y === undefined) {
      let placed = false;
      for (let attempt = 0; attempt < 8 && !placed; attempt++) {
        px = this.rng.range(0, this.config.width);
        py = this.rng.range(0, this.config.height);
        placed = this.rng.next() < this.fertility.at(px, py) * 0.95 + 0.03;
      }
      if (!placed) return;
    }
    this.plants.push({
      id: this.newId(),
      x: wrap(px, this.config.width),
      y: wrap(py, this.config.height),
      energy: this.config.plantEnergy,
    });
  }

  // ------------------------------------------------------------ environment
  /** Growth multiplier from seasons and active effects, in [0, 1+]. */
  get growthFactor(): number {
    const { seasonLength, seasonStrength } = this.config;
    let factor = 1 - seasonStrength * (0.5 - 0.5 * Math.cos((TAU * this.tick) / seasonLength));
    for (const e of this.effects) {
      if (e.kind === "drought") factor *= 0.2;
      if (e.kind === "iceAge") factor *= 0.35;
    }
    return factor;
  }

  /** 0 at the peak of summer, 1 in deepest winter. */
  get winter(): number {
    return 0.5 - 0.5 * Math.cos((TAU * this.tick) / this.config.seasonLength);
  }

  private get mutationMultiplier(): number {
    return this.config.mutationScale * (this.effects.some((e) => e.kind === "radiation") ? 4 : 1);
  }

  /** Trigger an environmental event. Returns a short description for the chronicle. */
  trigger(kind: EventKind, at?: { x: number; y: number }): string {
    const info = EVENT_INFO[kind];
    let text = `${info.label}.`;
    if (kind === "meteor") {
      const cx = at?.x ?? this.rng.range(0, this.config.width);
      const cy = at?.y ?? this.rng.range(0, this.config.height);
      const radius = Math.min(this.config.width, this.config.height) * 0.45;
      let killed = 0;
      for (const c of this.creatures) {
        const d = Math.hypot(wrapDelta(cx, c.x, this.config.width), wrapDelta(cy, c.y, this.config.height));
        if (c.alive && d < radius && this.rng.next() < 0.9 - (d / radius) * 0.4) {
          c.dead = "catastrophe";
          killed++;
        }
      }
      this.plants = this.plants.filter(
        (p) => Math.hypot(wrapDelta(cx, p.x, this.config.width), wrapDelta(cy, p.y, this.config.height)) > radius * 0.6,
      );
      text = `A meteor strikes. ${killed} creatures perish in the blast.`;
      this.removeDead();
    } else if (kind === "invasion") {
      const founder = this.species.found(randomGenome(this.rng, "hunter"), null, this.tick);
      const cx = at?.x ?? this.rng.range(0, this.config.width);
      const cy = at?.y ?? this.rng.range(0, this.config.height);
      let arrived = 0;
      for (let i = 0; i < 14 && this.creatures.length < this.config.maxCreatures; i++) {
        const genome = mutate(founder.founder, this.rng, 1.5);
        const { species } = this.species.classify(genome, founder.id, this.tick);
        this.spawn(genome, cx + this.rng.range(-120, 120), cy + this.rng.range(-120, 120), null, 0, species, null);
        arrived++;
      }
      text = `${arrived} hunters of an unknown lineage, ${founder.name}, invade.`;
    } else if (kind === "bloom") {
      for (let i = 0; i < this.config.maxPlants; i++) this.spawnPlant();
      text = "An algal bloom covers the fertile lands with food.";
    } else {
      const duration = kind === "drought" ? 1500 : kind === "radiation" ? 1000 : 4000;
      this.effects.push({ kind, until: this.tick + duration });
      text = `${info.label} begins. ${info.description}`;
    }
    this.chronicle.add({ tick: this.tick, kind: "event", text });
    return text;
  }

  /** Drop a handful of plants around a point (the UI's food brush). */
  feed(x: number, y: number, radius = 40, count = 12): void {
    for (let i = 0; i < count; i++) {
      const a = this.rng.range(0, TAU);
      const r = Math.sqrt(this.rng.next()) * radius;
      this.spawnPlant(x + Math.cos(a) * r, y + Math.sin(a) * r);
    }
  }

  // ------------------------------------------------------------------ update
  step(): void {
    this.tick++;
    this.effects = this.effects.filter((e) => e.until > this.tick);

    // plants
    const expected = this.config.plantGrowth * this.growthFactor;
    const whole = Math.floor(expected);
    for (let i = 0; i < whole; i++) this.spawnPlant();
    if (this.rng.next() < expected - whole) this.spawnPlant();

    // meat decays
    for (const m of this.meat) m.energy = m.energy * MEAT_DECAY - 0.01;
    this.meat = this.meat.filter((m) => m.energy > 0.5);

    this.plantGrid.rebuild(this.plants);
    this.meatGrid.rebuild(this.meat);
    this.creatureGrid.rebuild(this.creatures);

    const newborns: Creature[] = [];
    const eatenPlants = new Set<number>();
    for (const c of this.creatures) {
      if (!c.alive) continue;
      this.think(c);
      this.act(c, eatenPlants, newborns);
    }
    if (eatenPlants.size > 0) this.plants = this.plants.filter((p) => !eatenPlants.has(p.id));
    this.removeDead();
    for (const b of newborns) this.creatures.push(b);

    if (this.creatures.length < MIN_POPULATION) this.abiogenesis();
    if (this.tick % this.config.sampleInterval === 0) this.sample();
    if (this.tick % 5000 === 0) this.species.prune(this.tick);
  }

  /** Advance several ticks. */
  run(ticks: number): void {
    for (let i = 0; i < ticks; i++) this.step();
  }

  // --------------------------------------------------------- sense and think
  private think(c: Creature): void {
    const { width, height } = this.config;
    const t = c.traits;
    const range = t.senseRange;
    const half = t.fieldOfView / 2;
    const third = t.fieldOfView / 6;
    const plant = [0, 0, 0];
    const meat = [0, 0, 0];
    const crowd = [0, 0, 0];
    let nearest: Creature | null = null;
    let nearestD = Infinity;

    const sense = (x: number, y: number, into: number[]): number => {
      const dx = wrapDelta(c.x, x, width);
      const dy = wrapDelta(c.y, y, height);
      const d = Math.hypot(dx, dy);
      if (d > range || d === 0) return -1;
      const rel = normAngle(Math.atan2(dy, dx) - c.heading);
      if (rel < -half || rel > half) return -1;
      const sector = rel < -third ? 0 : rel > third ? 2 : 1;
      const intensity = 1 - d / range;
      if (intensity > (into[sector] ?? 0)) into[sector] = intensity;
      return d;
    };

    this.plantGrid.forEachNear(c.x, c.y, range, (p) => {
      sense(p.x, p.y, plant);
    });
    this.meatGrid.forEachNear(c.x, c.y, range, (m) => {
      sense(m.x, m.y, meat);
    });
    this.creatureGrid.forEachNear(c.x, c.y, range, (o) => {
      if (o === c || !o.alive) return;
      const d = sense(o.x, o.y, crowd);
      if (d >= 0 && d < nearestD) {
        nearestD = d;
        nearest = o;
      }
    });

    const x = c.brain.inputs;
    x[0] = c.energyFraction;
    x[1] = c.speed / t.maxSpeed;
    x[2] = plant[0] ?? 0;
    x[3] = plant[1] ?? 0;
    x[4] = plant[2] ?? 0;
    x[5] = crowd[0] ?? 0;
    x[6] = crowd[1] ?? 0;
    x[7] = crowd[2] ?? 0;
    x[8] = meat[0] ?? 0;
    x[9] = meat[1] ?? 0;
    x[10] = meat[2] ?? 0;
    const other = nearest as Creature | null;
    x[11] = other ? Math.tanh(other.traits.size / t.size - 1) : 0;
    x[12] = other ? this.kinship(c, other) : 0;
    x[13] = Math.sin(c.age * t.clock * TAU);
    x[14] = c.memory[0];
    x[15] = c.memory[1];
    c.lastOutput = c.brain.think();
  }

  /** 1 for the same species, 0.5 for parent or child species, 0 otherwise. */
  kinship(a: Creature, b: Creature): number {
    if (a.speciesId === b.speciesId) return 1;
    const sa = this.species.get(a.speciesId);
    const sb = this.species.get(b.speciesId);
    if (sa?.parentId === b.speciesId || sb?.parentId === a.speciesId) return 0.5;
    return 0;
  }

  // ---------------------------------------------------------------- act
  private act(c: Creature, eatenPlants: Set<number>, newborns: Creature[]): void {
    const out = c.lastOutput;
    if (!out) return;
    const { width, height, metabolism } = this.config;
    const t = c.traits;
    c.memory[0] = out.memoryA;
    c.memory[1] = out.memoryB;

    // movement with a little inertia
    c.heading = normAngle(c.heading + out.turn * t.agility);
    c.speed += (out.thrust * t.maxSpeed - c.speed) * 0.25;
    c.x = wrap(c.x + Math.cos(c.heading) * c.speed, width);
    c.y = wrap(c.y + Math.sin(c.heading) * c.speed, height);
    c.stats.distance += Math.abs(c.speed);

    // metabolism: basal (mass), locomotion (mass x speed^2), senses and brain upkeep
    const mass = t.size * t.size;
    const cost =
      metabolism *
      (0.003 * mass + 0.0011 * mass * c.speed * c.speed + 0.0005 * t.senseRange + 0.0004 * t.fieldOfView * 20 + 0.02);
    c.energy -= cost;

    c.biting = out.bite > 0.5;
    if (c.biting) {
      c.energy -= 0.001 * mass * metabolism;
      this.feed_(c, eatenPlants);
    }

    if (c.breedCooldown > 0) c.breedCooldown--;
    if (
      out.breed > 0.5 &&
      c.age > BREED_AGE &&
      c.breedCooldown === 0 &&
      c.energy > t.breedThreshold * c.maxEnergy &&
      this.creatures.length + newborns.length < this.config.maxCreatures
    ) {
      const child = this.breed(c);
      if (child) newborns.push(child);
    }

    c.age++;
    if (c.energy > c.maxEnergy) c.energy = c.maxEnergy;
    if (c.energy <= 0) c.dead = "starvation";
    else if (c.age > c.lifespan) c.dead = "old age";
  }

  private feed_(c: Creature, eatenPlants: Set<number>): void {
    const { width, height } = this.config;
    const t = c.traits;
    const reach = t.size + 3;
    const herb = (1 - t.diet) ** 1.15;
    const carn = t.diet ** 0.9;

    if (herb > 0.05) {
      let target: Plant | null = null;
      this.plantGrid.forEachNear(c.x, c.y, reach, (p) => {
        if (target || eatenPlants.has(p.id)) return;
        if (Math.hypot(wrapDelta(c.x, p.x, width), wrapDelta(c.y, p.y, height)) <= reach) target = p;
      });
      const plant = target as Plant | null;
      if (plant) {
        eatenPlants.add(plant.id);
        c.energy += plant.energy * herb;
        c.stats.plantsEaten++;
        return;
      }
    }

    if (carn > 0.05) {
      let food: Meat | null = null;
      this.meatGrid.forEachNear(c.x, c.y, reach, (m) => {
        if (food || m.energy <= 0) return;
        if (Math.hypot(wrapDelta(c.x, m.x, width), wrapDelta(c.y, m.y, height)) <= reach + 2) food = m;
      });
      const chunk = food as Meat | null;
      if (chunk) {
        const bite = Math.min(chunk.energy, 3 + t.size * 1.5);
        chunk.energy -= bite;
        c.energy += bite * carn * 0.9;
        c.stats.meatEaten++;
        return;
      }
      // attack the closest creature in front of the mouth
      let prey: Creature | null = null;
      let best = Infinity;
      this.creatureGrid.forEachNear(c.x, c.y, reach + 12, (o) => {
        if (o === c || !o.alive) return;
        const dx = wrapDelta(c.x, o.x, width);
        const dy = wrapDelta(c.y, o.y, height);
        const d = Math.hypot(dx, dy) - o.traits.size;
        if (d > reach || d >= best) return;
        if (Math.abs(normAngle(Math.atan2(dy, dx) - c.heading)) > 0.9) return;
        best = d;
        prey = o;
      });
      const victim = prey as Creature | null;
      if (victim) {
        const damage = (2 + t.size * 0.7) * carn * Math.sqrt(t.size / victim.traits.size);
        victim.energy -= damage;
        c.energy += damage * carn * 0.7;
        if (victim.energy <= 0 && victim.alive) {
          victim.dead = "predation";
          c.stats.kills++;
        }
      }
    }
  }

  private breed(parent: Creature): Creature | null {
    const t = parent.traits;
    let mate: Creature | null = null;
    if (this.rng.next() < this.config.sexualReproduction) {
      let best = Infinity;
      this.creatureGrid.forEachNear(parent.x, parent.y, 60, (o) => {
        if (o === parent || !o.alive || o.speciesId !== parent.speciesId || o.age < BREED_AGE) return;
        const d = Math.hypot(wrapDelta(parent.x, o.x, this.config.width), wrapDelta(parent.y, o.y, this.config.height));
        if (d < 60 && d < best && o.energyFraction > 0.3) {
          best = d;
          mate = o;
        }
      });
    }
    const partner = mate as Creature | null;
    const base = partner ? crossover(parent.genome, partner.genome, this.rng) : parent.genome;
    const genome = mutate(base, this.rng, this.mutationMultiplier);
    const childEnergy = parent.energy * t.offspringShare;
    parent.energy -= childEnergy * 1.08;
    if (partner) partner.energy -= childEnergy * 0.15;
    parent.breedCooldown = BREED_COOLDOWN;
    parent.stats.children++;
    if (partner) partner.stats.children++;

    const { species } = this.species.classify(genome, parent.speciesId, this.tick);
    const behind = parent.heading + Math.PI + this.rng.range(-0.6, 0.6);
    const dist = t.size * 2.2;
    const child = this.spawn(
      genome,
      parent.x + Math.cos(behind) * dist,
      parent.y + Math.sin(behind) * dist,
      parent,
      Math.max(parent.generation, partner?.generation ?? 0) + 1,
      species,
      partner,
      childEnergy,
      false,
    );
    this.births++;
    return child;
  }

  private removeDead(): void {
    if (!this.creatures.some((c) => !c.alive)) return;
    const survivors: Creature[] = [];
    for (const c of this.creatures) {
      if (c.alive) {
        survivors.push(c);
        continue;
      }
      this.deaths++;
      this.dropCorpse(c);
      const species = this.species.get(c.speciesId);
      if (species && this.species.removeMember(species, this.tick) && species.established) {
        const age = this.tick - species.bornTick;
        this.chronicle.add({
          tick: this.tick,
          kind: "extinction",
          speciesId: species.id,
          text: `${species.name} goes extinct after ${age.toLocaleString("en-US")} ticks (peak ${species.peakPopulation}).`,
        });
      }
    }
    this.creatures = survivors;
  }

  private dropCorpse(c: Creature): void {
    const energy = this.config.corpseEnergy * (c.maxEnergy * 0.8 + Math.max(0, c.energy));
    if (energy > 1) this.meat.push({ id: this.newId(), x: c.x, y: c.y, energy });
  }

  private abiogenesis(): void {
    const count = Math.min(20, this.config.initialCreatures);
    const founder = this.species.found(randomGenome(this.rng), null, this.tick);
    for (let i = 0; i < count; i++) {
      const genome = mutate(founder.founder, this.rng, 2);
      const { species } = this.species.classify(genome, founder.id, this.tick);
      this.spawn(
        genome,
        this.rng.range(0, this.config.width),
        this.rng.range(0, this.config.height),
        null,
        0,
        species,
        null,
      );
    }
    this.chronicle.add({
      tick: this.tick,
      kind: "abiogenesis",
      speciesId: founder.id,
      text: `Life nearly vanished. ${count} new organisms of ${founder.name} arise from the primordial soup.`,
    });
  }

  // ------------------------------------------------------------- statistics
  private sample(): void {
    const n = this.creatures.length;
    let size = 0;
    let speed = 0;
    let sense = 0;
    let diet = 0;
    let gen = 0;
    let maxGen = 0;
    let herb = 0;
    let omni = 0;
    let carn = 0;
    const bySpecies: Record<number, number> = {};
    for (const c of this.creatures) {
      size += c.traits.size;
      speed += c.traits.maxSpeed;
      sense += c.traits.senseRange;
      diet += c.traits.diet;
      gen += c.generation;
      if (c.generation > maxGen) maxGen = c.generation;
      const role = c.role;
      if (role === "herbivore") herb++;
      else if (role === "carnivore") carn++;
      else omni++;
    }
    const living = this.species.living;
    for (const s of living) if (s.established) bySpecies[s.id] = s.population;
    const div = n || 1;
    const sample: Sample = {
      tick: this.tick,
      population: n,
      plants: this.plants.length,
      meat: this.meat.length,
      species: living.filter((s) => s.established).length,
      herbivores: herb,
      omnivores: omni,
      carnivores: carn,
      avgSize: size / div,
      avgSpeed: speed / div,
      avgSense: sense / div,
      avgDiet: diet / div,
      avgGeneration: gen / div,
      maxGeneration: maxGen,
      births: this.births,
      deaths: this.deaths,
      season: this.winter,
      bySpecies,
    };
    // `births` and `deaths` are per sample window
    this.births = 0;
    this.deaths = 0;
    this.history.offer(() => sample);
    this.checkMilestones(sample);
  }

  private checkMilestones(s: Sample): void {
    if (s.population > this.peakPopulation && this.tick > 2000 && s.population > this.peakPopulation * 1.1) {
      this.chronicle.add({
        tick: this.tick,
        kind: "record",
        text: `Population reaches a new record of ${s.population}.`,
      });
    }
    this.peakPopulation = Math.max(this.peakPopulation, s.population);
    if (s.population > this.recentPeak || this.tick - this.recentPeakTick > 3000) {
      this.recentPeak = s.population;
      this.recentPeakTick = this.tick;
    } else if (this.recentPeak >= 40 && s.population < this.recentPeak * 0.4) {
      this.chronicle.add({
        tick: this.tick,
        kind: "crash",
        text: `Population crash: from ${this.recentPeak} to ${s.population} in ${(this.tick - this.recentPeakTick).toLocaleString("en-US")} ticks.`,
      });
      this.recentPeak = s.population;
      this.recentPeakTick = this.tick;
    }
    const milestones = [10, 50, 100, 250, 500, 1000, 2500, 5000, 10000];
    for (const m of milestones) {
      if (s.maxGeneration >= m && this.generationMilestone < m) {
        this.generationMilestone = m;
        this.chronicle.add({
          tick: this.tick,
          kind: "milestone",
          text: `Generation ${m.toLocaleString("en-US")} is born.`,
        });
      }
    }
  }

  // ------------------------------------------------------------ interventions
  /** Clone a creature `count` times around it (with normal mutation). Returns the number spawned. */
  propagate(source: Creature, count: number): number {
    const species = this.species.get(source.speciesId);
    if (!species) return 0;
    let made = 0;
    for (let i = 0; i < count && this.creatures.length < this.config.maxCreatures; i++) {
      const genome = mutate(source.genome, this.rng, this.mutationMultiplier);
      const { species: target } = this.species.classify(genome, species.id, this.tick);
      const a = this.rng.range(0, TAU);
      const r = this.rng.range(10, 50);
      this.spawn(
        genome,
        source.x + Math.cos(a) * r,
        source.y + Math.sin(a) * r,
        source,
        source.generation + 1,
        target,
        null,
      );
      made++;
    }
    if (made > 0) {
      this.chronicle.add({
        tick: this.tick,
        kind: "event",
        speciesId: species.id,
        text: `An observer propagates ${made} descendants of a ${species.name}.`,
      });
    }
    return made;
  }

  /** Remove one creature (the inspector's cull button). */
  cull(creature: Creature): void {
    if (!creature.alive) return;
    creature.dead = "catastrophe";
    this.removeDead();
  }

  /** Change a setting while the world runs. Validated against the same bounds as at creation. */
  adjust(key: keyof WorldConfig, value: number): void {
    const next = makeConfig({ ...this.config, [key]: value });
    if (key === "width" || key === "height" || key === "fertilityScale") {
      throw new Error(`"${key}" cannot change after the world is created`);
    }
    (this.config as WorldConfig)[key] = next[key];
    if (key === "speciesThreshold") this.species.threshold = next.speciesThreshold;
  }

  // ---------------------------------------------------------------- queries
  creatureAt(x: number, y: number, slack = 6): Creature | null {
    let best: Creature | null = null;
    let bestD = Infinity;
    for (const c of this.creatures) {
      const d = Math.hypot(wrapDelta(x, c.x, this.config.width), wrapDelta(y, c.y, this.config.height));
      if (d < c.traits.size + slack && d < bestD) {
        best = c;
        bestD = d;
      }
    }
    return best;
  }

  findCreature(id: number): Creature | undefined {
    return this.creatures.find((c) => c.id === id);
  }

  /** Internal counters, exposed for serialisation. */
  get counters(): {
    nextId: number;
    peakPopulation: number;
    recentPeak: number;
    recentPeakTick: number;
    generationMilestone: number;
    births: number;
    deaths: number;
  } {
    return {
      nextId: this.nextId,
      peakPopulation: this.peakPopulation,
      recentPeak: this.recentPeak,
      recentPeakTick: this.recentPeakTick,
      generationMilestone: this.generationMilestone,
      births: this.births,
      deaths: this.deaths,
    };
  }

  restoreCounters(c: World["counters"]): void {
    this.nextId = c.nextId;
    this.peakPopulation = c.peakPopulation;
    this.recentPeak = c.recentPeak;
    this.recentPeakTick = c.recentPeakTick;
    this.generationMilestone = c.generationMilestone;
    this.births = c.births;
    this.deaths = c.deaths;
  }

  /** Recompute species populations from the creature list (used after loading). */
  recountSpecies(): void {
    for (const s of this.species.all) s.population = 0;
    for (const c of this.creatures) {
      const s = this.species.get(c.speciesId);
      if (s) s.population++;
    }
  }
}

export type { DeathCause };
