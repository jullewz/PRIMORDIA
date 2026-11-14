#!/usr/bin/env node
/**
 * Headless runner: evolve a world without a browser.
 *
 *   node dist/src/cli/run.js --seed darwin --ticks 50000 --preset harsh --save world.json
 *
 * Prints a progress table, the surviving species and the chronicle. Useful
 * for long experiments, benchmarks and reproducibility checks.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { CONFIG_BOUNDS, ConfigError, PRESETS, presetConfig, type WorldConfig } from "../core/config.js";
import { loadWorld, saveWorld, SnapshotError } from "../sim/serialize.js";
import { World } from "../sim/world.js";

interface Options {
  seed: string;
  ticks: number;
  preset: string;
  report: number;
  save: string | null;
  load: string | null;
  json: boolean;
  quiet: boolean;
  overrides: Partial<Record<string, unknown>>;
}

const HELP = `primordia: evolve an artificial-life world without a browser

Usage: primordia [options]

  --seed TEXT        world seed (default: "primordia")
  --ticks N          ticks to simulate (default: 20000)
  --preset ID        ${PRESETS.map((p) => p.id).join(" | ")}
  --set KEY=VALUE    override a setting, repeatable (e.g. --set plantGrowth=3)
  --report N         print a progress row every N ticks (default: ticks / 10)
  --save FILE        write the final world to a JSON save file
  --load FILE        continue from a save file instead of creating a world
  --json             print the final summary as JSON
  --quiet            only print the final summary
  --settings         list every setting with its allowed range
  -h, --help         show this help

Created by jullewz. https://github.com/jullewz/primordia
`;

class UsageError extends Error {}

function parseArgs(argv: string[]): Options | "help" | "settings" {
  const o: Options = {
    seed: "primordia",
    ticks: 20000,
    preset: "balanced",
    report: 0,
    save: null,
    load: null,
    json: false,
    quiet: false,
    overrides: {},
  };
  const need = (i: number, flag: string): string => {
    const value = argv[i];
    if (value === undefined) throw new UsageError(`${flag} needs a value`);
    return value;
  };
  const int = (text: string, flag: string): number => {
    const n = Number(text);
    if (!Number.isInteger(n) || n < 0) throw new UsageError(`${flag} must be a non-negative whole number`);
    return n;
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    switch (arg) {
      case "-h":
      case "--help":
        return "help";
      case "--settings":
        return "settings";
      case "--seed":
        o.seed = need(++i, arg);
        break;
      case "--ticks":
        o.ticks = int(need(++i, arg), arg);
        break;
      case "--report":
        o.report = int(need(++i, arg), arg);
        break;
      case "--preset":
        o.preset = need(++i, arg);
        break;
      case "--save":
        o.save = need(++i, arg);
        break;
      case "--load":
        o.load = need(++i, arg);
        break;
      case "--json":
        o.json = true;
        break;
      case "--quiet":
        o.quiet = true;
        break;
      case "--set": {
        const pair = need(++i, arg);
        const eq = pair.indexOf("=");
        if (eq < 1) throw new UsageError(`--set expects KEY=VALUE, got "${pair}"`);
        o.overrides[pair.slice(0, eq)] = pair.slice(eq + 1);
        break;
      }
      default:
        throw new UsageError(`unknown option "${String(arg)}"`);
    }
  }
  return o;
}

function summary(world: World): Record<string, unknown> {
  const last = world.history.last;
  const species = world.species.living
    .filter((s) => s.established)
    .sort((a, b) => b.population - a.population)
    .map((s) => ({
      name: s.name,
      population: s.population,
      diet: Number(s.diet.toFixed(2)),
      bornTick: s.bornTick,
      lineageDepth: world.species.ancestry(s.id).length,
    }));
  const all = world.species.all.filter((s) => s.established);
  return {
    seed: world.seed,
    tick: world.tick,
    population: world.creatures.length,
    plants: world.plants.length,
    speciesAlive: species.length,
    speciesEver: all.length,
    extinctions: all.filter((s) => s.extinctTick !== null).length,
    maxGeneration: last?.maxGeneration ?? 0,
    averages: last
      ? {
          size: Number(last.avgSize.toFixed(2)),
          speed: Number(last.avgSpeed.toFixed(2)),
          sense: Number(last.avgSense.toFixed(1)),
          diet: Number(last.avgDiet.toFixed(3)),
        }
      : null,
    roles: last ? { herbivores: last.herbivores, omnivores: last.omnivores, carnivores: last.carnivores } : null,
    species,
  };
}

function main(): number {
  let options: Options | "help" | "settings";
  try {
    options = parseArgs(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`primordia: ${(error as Error).message}\n\n${HELP}`);
    return 2;
  }
  if (options === "help") {
    process.stdout.write(HELP);
    return 0;
  }
  if (options === "settings") {
    for (const [key, b] of Object.entries(CONFIG_BOUNDS)) {
      process.stdout.write(
        `${key.padEnd(20)} ${String(b.min).padStart(8)} .. ${String(b.max).padEnd(10)}${b.integer ? " (whole number)" : ""}\n`,
      );
    }
    return 0;
  }

  let world: World;
  try {
    if (options.load) {
      world = loadWorld(JSON.parse(readFileSync(options.load, "utf8")));
    } else {
      const config: Partial<WorldConfig> = { ...presetConfig(options.preset) };
      world = new World(options.seed, { ...config, ...options.overrides } as Partial<WorldConfig>);
    }
  } catch (error) {
    if (
      error instanceof ConfigError ||
      error instanceof SnapshotError ||
      error instanceof SyntaxError ||
      (error as NodeJS.ErrnoException).code === "ENOENT"
    ) {
      process.stderr.write(`primordia: ${(error as Error).message}\n`);
      return 2;
    }
    throw error;
  }

  const every = options.report || Math.max(1, Math.floor(options.ticks / 10));
  const log = (line: string): void => {
    if (!options.quiet && !options.json) process.stdout.write(line + "\n");
  };
  log(`seed "${world.seed}"  world ${world.config.width}x${world.config.height}  preset ${options.preset}`);
  log("      tick    pop  plants  species   gen   size  speed   diet   herb  omni  carn");
  const started = performance.now();
  const row = (): void => {
    const s = world.history.last;
    if (!s) return;
    log(
      `${String(world.tick).padStart(10)} ${String(world.creatures.length).padStart(6)} ${String(world.plants.length).padStart(7)} ` +
        `${String(s.species).padStart(8)} ${String(s.maxGeneration).padStart(5)} ${s.avgSize.toFixed(2).padStart(6)} ` +
        `${s.avgSpeed.toFixed(2).padStart(6)} ${s.avgDiet.toFixed(3).padStart(6)} ${String(s.herbivores).padStart(6)} ` +
        `${String(s.omnivores).padStart(5)} ${String(s.carnivores).padStart(5)}`,
    );
  };
  for (let done = 0; done < options.ticks; ) {
    const chunk = Math.min(every, options.ticks - done);
    world.run(chunk);
    done += chunk;
    row();
  }
  const seconds = (performance.now() - started) / 1000;

  const result = summary(world);
  if (options.json) {
    process.stdout.write(JSON.stringify(result, null, 2) + "\n");
  } else {
    process.stdout.write(
      `\n${options.ticks.toLocaleString("en-US")} ticks in ${seconds.toFixed(1)}s ` +
        `(${Math.round(options.ticks / Math.max(seconds, 0.001)).toLocaleString("en-US")} ticks/s)\n`,
    );
    process.stdout.write(
      `population ${world.creatures.length}, ${String(result.speciesAlive)} living species, ` +
        `${String(result.extinctions)} extinct, generation ${String(result.maxGeneration)}\n\nliving species:\n`,
    );
    for (const s of result.species as { name: string; population: number; diet: number; lineageDepth: number }[]) {
      const role = s.diet > 0.65 ? "carnivore" : s.diet > 0.35 ? "omnivore" : "herbivore";
      process.stdout.write(
        `  ${String(s.population).padStart(5)}  ${s.name.padEnd(28)} ${role.padEnd(10)} lineage depth ${s.lineageDepth}\n`,
      );
    }
    if (!options.quiet) {
      process.stdout.write("\nchronicle (last 12):\n");
      for (const e of world.chronicle.entries.slice(-12)) {
        process.stdout.write(`  ${String(e.tick).padStart(9)}  ${e.text}\n`);
      }
    }
  }
  if (options.save) {
    writeFileSync(options.save, JSON.stringify(saveWorld(world)));
    process.stderr.write(`saved world to ${options.save}\n`);
  }
  return 0;
}

// Piping into `head` closes stdout early. That is not an error worth a stack trace.
process.stdout.on("error", (error: NodeJS.ErrnoException) => {
  if (error.code === "EPIPE") process.exit(0);
  throw error;
});

process.exitCode = main();
