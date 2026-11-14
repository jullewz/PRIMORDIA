/**
 * World configuration, presets and validation.
 *
 * Every number that shapes evolution lives here, so experiments are
 * reproducible from (seed, config) alone.
 */

export interface WorldConfig {
  /** World size in simulation units. The world wraps around at the edges. */
  width: number;
  height: number;
  /** Creatures created at tick 0. */
  initialCreatures: number;
  /** Hard cap. Births beyond it fail, which models crowding. */
  maxCreatures: number;
  /** Plants added per tick at full fertility and peak season. */
  plantGrowth: number;
  maxPlants: number;
  /** Energy in one plant pellet. */
  plantEnergy: number;
  /** Season cycle length in ticks and how strongly seasons swing growth (0..1). */
  seasonLength: number;
  seasonStrength: number;
  /** Scale of the fertility noise field (smaller = larger fertile regions). */
  fertilityScale: number;
  /** Global multiplier on mutation strength. */
  mutationScale: number;
  /** Probability that a birth uses a nearby mate (sexual reproduction). */
  sexualReproduction: number;
  /** Genetic distance above which a newborn founds a new species. */
  speciesThreshold: number;
  /** Fraction of a creature's energy left behind as meat when it dies. */
  corpseEnergy: number;
  /** Lifespan in ticks for a creature of average size. */
  baseLifespan: number;
  /** Multiplier on all metabolic costs. */
  metabolism: number;
  /** Ticks between statistics samples. */
  sampleInterval: number;
}

export const DEFAULT_CONFIG: Readonly<WorldConfig> = Object.freeze({
  width: 1600,
  height: 1000,
  initialCreatures: 140,
  maxCreatures: 900,
  plantGrowth: 4,
  maxPlants: 2200,
  plantEnergy: 16,
  seasonLength: 6000,
  seasonStrength: 0.45,
  fertilityScale: 0.0032,
  mutationScale: 1,
  sexualReproduction: 0.35,
  speciesThreshold: 0.24,
  corpseEnergy: 0.6,
  baseLifespan: 4200,
  metabolism: 1,
  sampleInterval: 30,
});

export interface Preset {
  id: string;
  name: string;
  description: string;
  config: Partial<WorldConfig>;
}

export const PRESETS: readonly Preset[] = [
  { id: "balanced", name: "Balanced", description: "Default ecosystem with gentle seasons.", config: {} },
  {
    id: "garden",
    name: "Garden of plenty",
    description: "Abundant plants. Large populations, slow pressure, many species.",
    config: { plantGrowth: 7, maxPlants: 3600, seasonStrength: 0.15, maxCreatures: 1400 },
  },
  {
    id: "harsh",
    name: "Harsh winters",
    description: "Strong seasons and scarce food reward efficiency and predation.",
    config: { plantGrowth: 2.6, seasonStrength: 0.85, seasonLength: 4500, corpseEnergy: 0.8 },
  },
  {
    id: "volatile",
    name: "Volatile genes",
    description: "High mutation and frequent speciation: fast, chaotic evolution.",
    config: { mutationScale: 2.2, speciesThreshold: 0.2 },
  },
  {
    id: "archipelago",
    name: "Archipelago",
    description: "Small, isolated fertile islands encourage divergent lineages.",
    config: { fertilityScale: 0.0065, plantGrowth: 5, maxPlants: 3000, width: 2000, height: 1300, maxCreatures: 1100 },
  },
];

interface Bound {
  min: number;
  max: number;
  integer?: boolean;
}

const BOUNDS: Record<keyof WorldConfig, Bound> = {
  width: { min: 300, max: 8000, integer: true },
  height: { min: 300, max: 8000, integer: true },
  initialCreatures: { min: 2, max: 5000, integer: true },
  maxCreatures: { min: 10, max: 10000, integer: true },
  plantGrowth: { min: 0, max: 50 },
  maxPlants: { min: 0, max: 50000, integer: true },
  plantEnergy: { min: 1, max: 200 },
  seasonLength: { min: 100, max: 1_000_000, integer: true },
  seasonStrength: { min: 0, max: 1 },
  fertilityScale: { min: 0.0005, max: 0.05 },
  mutationScale: { min: 0, max: 10 },
  sexualReproduction: { min: 0, max: 1 },
  speciesThreshold: { min: 0.02, max: 2 },
  corpseEnergy: { min: 0, max: 1 },
  baseLifespan: { min: 100, max: 1_000_000, integer: true },
  metabolism: { min: 0.1, max: 10 },
  sampleInterval: { min: 1, max: 10_000, integer: true },
};

export class ConfigError extends Error {
  override name = "ConfigError";
}

/** Merge overrides onto the defaults and validate every field. */
export function makeConfig(overrides: Partial<Record<string, unknown>> = {}): WorldConfig {
  const config: WorldConfig = { ...DEFAULT_CONFIG };
  for (const [key, raw] of Object.entries(overrides)) {
    if (raw === undefined) continue;
    if (!(key in BOUNDS)) throw new ConfigError(`unknown setting "${key}"`);
    const bound = BOUNDS[key as keyof WorldConfig];
    const value = typeof raw === "string" && raw.trim() !== "" ? Number(raw) : raw;
    if (typeof value !== "number" || !Number.isFinite(value)) {
      throw new ConfigError(`setting "${key}" must be a number`);
    }
    if (value < bound.min || value > bound.max) {
      throw new ConfigError(`setting "${key}" must be between ${bound.min} and ${bound.max}, got ${value}`);
    }
    if (bound.integer && !Number.isInteger(value)) {
      throw new ConfigError(`setting "${key}" must be a whole number`);
    }
    config[key as keyof WorldConfig] = value;
  }
  if (config.initialCreatures > config.maxCreatures) {
    throw new ConfigError("initialCreatures cannot exceed maxCreatures");
  }
  return config;
}

export function presetConfig(id: string): WorldConfig {
  const preset = PRESETS.find((p) => p.id === id);
  if (!preset) throw new ConfigError(`unknown preset "${id}"`);
  return makeConfig(preset.config);
}

export const CONFIG_BOUNDS: Readonly<Record<keyof WorldConfig, Readonly<Bound>>> = BOUNDS;
