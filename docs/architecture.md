# Architecture

## Layers

```
src/ui    browser only     main.ts, renderer.ts, charts.ts, camera.ts
src/cli   Node only        run.ts
src/sim   pure TypeScript  world, genome, brain, creature, species, history, spatial, noise, serialize
src/core  pure TypeScript  rng, math, config
```

`src/core` and `src/sim` never touch the DOM, timers or `Math.random`. That single rule gives three things:
the simulation is deterministic, it runs unchanged in Node, and it can be unit-tested without a browser.

## Determinism

- **One random stream.** Every random choice uses the world's `Rng` (xoshiro128\*\*, seeded through SplitMix32 from
  an FNV-1a hash of the seed string). Terrain uses a separate stream derived from the seed, so it does not depend
  on population settings.
- **Stable order.** Creatures act in array order. Births are appended at the end of the tick, deaths are removed
  with a stable filter. The spatial grid visits cells in a fixed order.
- **Complete snapshots.** A save file includes the generator's four state words *and* its cached Box-Muller value.
  The test-suite found that omitting the cached value makes a restored world drift from the original after the
  next gaussian sample, which is why it is part of the format.

## The tick loop

`World.step()` in `src/sim/world.ts`:

1. expire effects, grow plants, decay meat
2. rebuild three spatial grids (plants, meat, creatures): O(n)
3. for each living creature: `think()` fills the 16 inputs and runs the network, `act()` applies the outputs
4. remove eaten plants and the dead (leaving corpses), update species counts and the chronicle
5. append newborns
6. every `sampleInterval` ticks: record statistics and check milestones

## Performance

- **Spatial hashing.** Sensing only looks at grid cells within sight range, so cost grows with local density, not
  with the square of the population.
- **Typed arrays** hold network weights and activations.
- **No allocation in the hot path** beyond a few small arrays per creature per tick.
- **Bounded history.** When the statistics buffer fills, every second sample is dropped and the sampling stride
  doubles, so memory stays constant over millions of ticks.
- **Frame budget.** The UI runs as many ticks as fit in about 10 ms per frame. "max" speed uses the whole budget.

On the reference machine used for development, the headless runner reaches roughly 500 to 1,900 ticks per second
with 50 to 200 creatures.

## Rendering

`Renderer` draws to a 2D canvas, scaled for high-DPI screens:

- the fertility map is rendered once to a small off-screen canvas and stretched
- the wrap-around world is drawn as tiles, only for the tiles the camera sees
- entities outside the view are skipped
- glow halos are pre-rendered sprites per hue bucket and blended additively
- details (tails, jaws, eyes) are skipped when zoomed far out

## Save format (version 1)

A JSON object: `primordia` (version), `seed`, `config`, `tick`, `rng`, `rngSpare`, `counters`, `creatures`
(genome and state), `plants`, `meat`, `effects`, `species`, `history`, `chronicle`. `loadWorld` validates the
structure, every genome and every species reference, and reports problems as `SnapshotError`.

## Security notes

- All simulation text reaches the page through `textContent`, never `innerHTML`.
- Loaded files are validated before use and limited to 200 MB.
- The development server binds to `127.0.0.1` and refuses paths outside the project folder.
- The page makes no network requests and stores nothing.
