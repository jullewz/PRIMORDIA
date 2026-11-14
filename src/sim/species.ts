/**
 * Species bookkeeping and phylogeny.
 *
 * A species is defined by its founder's genome (as in NEAT). A newborn
 * joins its parent's species while it stays within `threshold` genetic
 * distance of the founder; otherwise it founds a new species whose parent
 * is the old one. The resulting tree is the phylogeny drawn in the UI.
 */

import type { Rng } from "../core/rng.js";
import { distance, decodeTraits, type Genome } from "./genome.js";

const ONSETS = [
  "V",
  "Th",
  "K",
  "M",
  "S",
  "L",
  "Qu",
  "Z",
  "R",
  "N",
  "Pr",
  "Gl",
  "Ph",
  "C",
  "D",
  "Br",
  "Sk",
  "T",
  "X",
  "Ae",
];
const VOWELS = ["a", "e", "i", "o", "u", "ae", "y", "ia", "eo"];
const CODAS = ["", "", "", "n", "r", "l", "s", "x", "th", "m"];
const ENDINGS = ["us", "a", "is", "on", "ix", "ora", "ella", "ium", "ax", "ens"];

/** Deterministic Latin-flavoured binomial name, e.g. "Velora quinthis". */
export function speciesName(rng: Rng): string {
  const word = (syllables: number, ending: boolean): string => {
    let out = "";
    for (let i = 0; i < syllables; i++) out += rng.pick(ONSETS) + rng.pick(VOWELS) + rng.pick(CODAS);
    out = out.toLowerCase();
    if (ending) out += rng.pick(ENDINGS);
    return out;
  };
  const genus = word(rng.int(1, 3), true);
  const epithet = word(rng.int(1, 3), true);
  return `${genus.charAt(0).toUpperCase()}${genus.slice(1)} ${epithet}`;
}

export interface Species {
  id: number;
  name: string;
  parentId: number | null;
  founder: Genome;
  hue: number;
  bornTick: number;
  extinctTick: number | null;
  population: number;
  peakPopulation: number;
  totalBorn: number;
  /** Becomes true once the species reaches ESTABLISHED members. Short-lived offshoots stay hidden. */
  established: boolean;
  /** Mean diet of the founder: 0 plant eater .. 1 meat eater. */
  diet: number;
}

export const ESTABLISHED = 5;

export class SpeciesRegistry {
  private readonly byId = new Map<number, Species>();
  private nextId = 1;

  constructor(
    private readonly rng: Rng,
    public threshold: number,
  ) {}

  get all(): Species[] {
    return [...this.byId.values()];
  }

  get living(): Species[] {
    return this.all.filter((s) => s.population > 0);
  }

  get(id: number): Species | undefined {
    return this.byId.get(id);
  }

  found(genome: Genome, parentId: number | null, tick: number): Species {
    const traits = decodeTraits(genome);
    const species: Species = {
      id: this.nextId++,
      name: speciesName(this.rng),
      parentId,
      founder: genome.slice(),
      hue: traits.hue,
      bornTick: tick,
      extinctTick: null,
      population: 0,
      peakPopulation: 0,
      totalBorn: 0,
      established: false,
      diet: traits.diet,
    };
    this.byId.set(species.id, species);
    return species;
  }

  /**
   * Species for a newborn. Returns the species and whether it is new.
   * Checks the parent's species first, then every living species, then founds a new one.
   */
  classify(genome: Genome, parentSpeciesId: number | null, tick: number): { species: Species; isNew: boolean } {
    const parent = parentSpeciesId !== null ? this.byId.get(parentSpeciesId) : undefined;
    if (parent && distance(genome, parent.founder) < this.threshold) return { species: parent, isNew: false };
    let best: Species | undefined;
    let bestDistance = Infinity;
    for (const s of this.byId.values()) {
      if (s.population <= 0 || s === parent) continue;
      const d = distance(genome, s.founder);
      if (d < bestDistance) {
        bestDistance = d;
        best = s;
      }
    }
    if (best && bestDistance < this.threshold) return { species: best, isNew: false };
    return { species: this.found(genome, parent?.id ?? null, tick), isNew: true };
  }

  /** Record a birth. Returns true when the species just became established. */
  addMember(species: Species): boolean {
    species.population++;
    species.totalBorn++;
    if (species.population > species.peakPopulation) species.peakPopulation = species.population;
    if (!species.established && species.population >= ESTABLISHED) {
      species.established = true;
      return true;
    }
    return false;
  }

  /** Record a death. Returns true when the species just went extinct. */
  removeMember(species: Species, tick: number): boolean {
    species.population = Math.max(0, species.population - 1);
    if (species.population === 0 && species.extinctTick === null) {
      species.extinctTick = tick;
      return true;
    }
    return false;
  }

  /** Lineage from the root species down to `id`. */
  ancestry(id: number): Species[] {
    const chain: Species[] = [];
    let current = this.byId.get(id);
    while (current) {
      chain.unshift(current);
      current = current.parentId !== null ? this.byId.get(current.parentId) : undefined;
    }
    return chain;
  }

  /** Drop long-extinct, never-established species to bound memory on very long runs. */
  prune(tick: number, keepTicks = 20000): number {
    let removed = 0;
    const referenced = new Set<number>();
    for (const s of this.byId.values()) if (s.parentId !== null) referenced.add(s.parentId);
    for (const [id, s] of this.byId) {
      if (!s.established && s.extinctTick !== null && tick - s.extinctTick > keepTicks && !referenced.has(id)) {
        this.byId.delete(id);
        removed++;
      }
    }
    return removed;
  }

  toJSON(): { nextId: number; species: Species[] } {
    return { nextId: this.nextId, species: this.all };
  }

  static fromJSON(data: { nextId: number; species: Species[] }, rng: Rng, threshold: number): SpeciesRegistry {
    const registry = new SpeciesRegistry(rng, threshold);
    registry.nextId = data.nextId;
    for (const s of data.species) registry.byId.set(s.id, { ...s, founder: s.founder.slice() });
    return registry;
  }
}
