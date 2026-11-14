# Contributing to Primordia

Thanks for your interest. Experiments, bug reports and pull requests are all welcome.

## Setup

```bash
git clone https://github.com/jullewz/primordia.git
cd primordia
npm install
npm run watch     # terminal 1: recompile on change
npm run serve     # terminal 2: http://127.0.0.1:5173
```

## Before a pull request

```bash
npm test
npm run typecheck
npm run format:check
```

## Rules of the simulation core

`src/core` and `src/sim` must stay **pure and deterministic**:

- no DOM, timers, `Date` or `Math.random` (use the world's `Rng`)
- iterate arrays in a stable order, never rely on `Set` or `Map` order of objects created non-deterministically
- anything that affects the future must be in the save file (see `serialize.ts`)

The tests `is deterministic` and `saves and loads without changing the future` in `tests/world.test.ts` catch most
violations. Run them after any change to the tick loop.

## Changing the rules of life

Balance changes (costs, digestion, damage) alter every world's history. That is fine, but:

1. describe the ecological effect you observed, with seeds and tick counts
2. update `docs/simulation.md` so the documented formulas match the code
3. note it in `CHANGELOG.md` under "Changed", since old seeds will evolve differently

## Adding a gene

1. Append its name to `TRAIT_NAMES` in `src/sim/genome.ts` and map it in `decodeTraits`.
2. Use it in `world.ts` or `creature.ts`.
3. Bump `SNAPSHOT_VERSION` in `serialize.ts`: the genome length changes, so old saves no longer load.
4. Document it in `docs/genome.md`.

## Style

Strict TypeScript, Prettier formatting, no runtime dependencies. UI text from the simulation goes through
`textContent`, never `innerHTML`.
