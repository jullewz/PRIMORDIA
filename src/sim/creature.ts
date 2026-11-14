/** A living creature: body state, decoded traits, brain and life statistics. */

import { Brain, type BrainOutput } from "./brain.js";
import { decodeTraits, type Genome, type Traits } from "./genome.js";

export interface CreatureStats {
  children: number;
  kills: number;
  plantsEaten: number;
  meatEaten: number;
  distance: number;
}

export interface CreatureState {
  id: number;
  genome: Genome;
  x: number;
  y: number;
  heading: number;
  speed: number;
  energy: number;
  age: number;
  generation: number;
  speciesId: number;
  parentId: number | null;
  mateId: number | null;
  bornTick: number;
  breedCooldown: number;
  memory: [number, number];
  stats: CreatureStats;
}

export type DeathCause = "starvation" | "old age" | "predation" | "catastrophe";

export class Creature {
  readonly id: number;
  readonly genome: Genome;
  readonly traits: Traits;
  readonly brain: Brain;
  readonly maxEnergy: number;
  readonly lifespan: number;
  x: number;
  y: number;
  heading: number;
  speed: number;
  energy: number;
  age: number;
  generation: number;
  speciesId: number;
  parentId: number | null;
  mateId: number | null;
  bornTick: number;
  breedCooldown: number;
  memory: [number, number];
  stats: CreatureStats;
  /** Set during a tick; dead creatures are removed at the end of the tick. */
  dead: DeathCause | null = null;
  /** Last brain decision, kept for the inspector. */
  lastOutput: BrainOutput | null = null;
  /** True while biting something this tick (drawn as an open mouth). */
  biting = false;

  constructor(state: CreatureState, baseLifespan: number) {
    this.id = state.id;
    this.genome = state.genome;
    this.traits = decodeTraits(state.genome);
    this.brain = new Brain(state.genome);
    this.maxEnergy = 8 * this.traits.size * this.traits.size;
    this.lifespan = Math.round(baseLifespan * (0.6 + this.traits.size / 12));
    this.x = state.x;
    this.y = state.y;
    this.heading = state.heading;
    this.speed = state.speed;
    this.energy = state.energy;
    this.age = state.age;
    this.generation = state.generation;
    this.speciesId = state.speciesId;
    this.parentId = state.parentId;
    this.mateId = state.mateId;
    this.bornTick = state.bornTick;
    this.breedCooldown = state.breedCooldown;
    this.memory = [state.memory[0], state.memory[1]];
    this.stats = { ...state.stats };
  }

  get alive(): boolean {
    return this.dead === null;
  }

  get energyFraction(): number {
    return Math.max(0, Math.min(1, this.energy / this.maxEnergy));
  }

  /** Coarse ecological role derived from diet. */
  get role(): "herbivore" | "omnivore" | "carnivore" {
    const d = this.traits.diet;
    return d < 0.35 ? "herbivore" : d > 0.65 ? "carnivore" : "omnivore";
  }

  toState(): CreatureState {
    return {
      id: this.id,
      genome: this.genome,
      x: this.x,
      y: this.y,
      heading: this.heading,
      speed: this.speed,
      energy: this.energy,
      age: this.age,
      generation: this.generation,
      speciesId: this.speciesId,
      parentId: this.parentId,
      mateId: this.mateId,
      bornTick: this.bornTick,
      breedCooldown: this.breedCooldown,
      memory: [this.memory[0], this.memory[1]],
      stats: { ...this.stats },
    };
  }
}

export function emptyStats(): CreatureStats {
  return { children: 0, kills: 0, plantsEaten: 0, meatEaten: 0, distance: 0 };
}
