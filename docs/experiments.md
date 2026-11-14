# Experiments to run

Primordia is deterministic, so each of these is a repeatable experiment: change one setting, keep the seed, and
compare.

## 1. Does food abundance create diversity?

```bash
node dist/src/cli/run.js --seed e1 --ticks 60000 --preset garden --json > garden.json
node dist/src/cli/run.js --seed e1 --ticks 60000 --preset harsh  --json > harsh.json
```

Compare `speciesEver`, `extinctions` and the average traits. Rich worlds usually hold more individuals. Whether
they hold more *species* is the interesting part.

## 2. The cost of being big

```bash
node dist/src/cli/run.js --seed e2 --ticks 40000 --set metabolism=0.6
node dist/src/cli/run.js --seed e2 --ticks 40000 --set metabolism=1.6
```

Watch the `size` column. Cheap energy lets large bodies persist. Expensive energy favours small, frugal grazers.

## 3. Can predators persist?

Predator and prey populations chase each other in cycles. In small worlds the cycle often overshoots and the
predators starve. Try the same seed at two world sizes:

```bash
node dist/src/cli/run.js --seed e3 --ticks 50000
node dist/src/cli/run.js --seed e3 --ticks 50000 --set width=2600 --set height=1700 --set maxPlants=5000 --set plantGrowth=9
```

Follow the `carn` column. Larger worlds give prey somewhere to recover.

## 4. Evolvability

```bash
node dist/src/cli/run.js --seed e4 --ticks 50000 --set mutationScale=0.3
node dist/src/cli/run.js --seed e4 --ticks 50000 --set mutationScale=2.5
```

Too little mutation and lineages cannot adapt to seasons. Too much and good genomes fall apart.

## 5. Recovery after catastrophe (in the browser)

1. Open a world and let it reach tick 20,000.
2. Save it.
3. Trigger a meteor strike, run 10,000 more ticks, and note which lineages fill the crater.
4. Load the save and try an ice age instead.

Because the save restores the exact state, both runs start from the same world.

## Checking reproducibility

```bash
node dist/src/cli/run.js --seed check --ticks 20000 --json > a.json
node dist/src/cli/run.js --seed check --ticks 20000 --json > b.json
diff a.json b.json && echo identical
```
