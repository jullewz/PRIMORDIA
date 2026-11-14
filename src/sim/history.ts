/**
 * Time series of world statistics, with automatic down-sampling so a run of
 * millions of ticks still fits in a bounded amount of memory.
 */

export interface Sample {
  tick: number;
  population: number;
  plants: number;
  meat: number;
  species: number;
  herbivores: number;
  omnivores: number;
  carnivores: number;
  avgSize: number;
  avgSpeed: number;
  avgSense: number;
  avgDiet: number;
  avgGeneration: number;
  maxGeneration: number;
  births: number;
  deaths: number;
  season: number;
  /** Population per established species id at this tick. */
  bySpecies: Record<number, number>;
}

export class History {
  samples: Sample[] = [];
  /** Current spacing between samples, in base intervals. Doubles each time the buffer is compacted. */
  stride = 1;
  private skipped = 0;

  constructor(readonly capacity = 1200) {}

  /** Called once per base interval. Keeps every `stride`-th call. */
  offer(make: () => Sample): void {
    this.skipped++;
    if (this.skipped < this.stride) return;
    this.skipped = 0;
    this.samples.push(make());
    if (this.samples.length > this.capacity) {
      this.samples = this.samples.filter((_, i) => i % 2 === 0);
      this.stride *= 2;
    }
  }

  get last(): Sample | undefined {
    return this.samples[this.samples.length - 1];
  }

  toJSON(): { samples: Sample[]; stride: number; skipped: number; capacity: number } {
    return { samples: this.samples, stride: this.stride, skipped: this.skipped, capacity: this.capacity };
  }

  static fromJSON(data: { samples: Sample[]; stride: number; skipped: number; capacity: number }): History {
    const history = new History(data.capacity);
    history.samples = data.samples;
    history.stride = data.stride;
    history.skipped = data.skipped;
    return history;
  }
}

export type ChronicleKind =
  | "genesis"
  | "speciation"
  | "extinction"
  | "milestone"
  | "record"
  | "crash"
  | "event"
  | "abiogenesis";

export interface ChronicleEntry {
  tick: number;
  kind: ChronicleKind;
  text: string;
  speciesId?: number;
}

/** A readable log of notable moments in the world's history. */
export class Chronicle {
  entries: ChronicleEntry[] = [];

  constructor(readonly capacity = 500) {}

  add(entry: ChronicleEntry): void {
    this.entries.push(entry);
    if (this.entries.length > this.capacity) this.entries.splice(0, this.entries.length - this.capacity);
  }

  since(tick: number): ChronicleEntry[] {
    return this.entries.filter((e) => e.tick > tick);
  }
}
