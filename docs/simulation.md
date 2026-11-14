# The simulation, rule by rule

Everything below happens once per **tick**. All numbers are the defaults from `src/core/config.ts` and can be
changed per world.

## The world

- A rectangle of 1600 × 1000 units that wraps around at every edge (a torus), so there are no corners to hide in.
- A **fertility map** built from seamless value noise decides where plants prefer to grow. It never changes during
  a run and depends only on the seed.
- **Seasons** follow a cosine with a period of 6,000 ticks. Growth swings between 100% in summer and
  `1 − seasonStrength` in deepest winter.

## Food

| Kind | Source | Energy |
|---|---|---|
| Plant | Appears at `plantGrowth` per tick, placed by fertility, capped at `maxPlants` | `plantEnergy` (16) |
| Meat | Every dead creature leaves `corpseEnergy × (0.8 × maxEnergy + remaining energy)` | Decays 0.4% per tick |

## Senses

A creature sees inside a cone defined by its `senseRange` and `fieldOfView` genes. The cone is split into three
sectors: left, ahead, right. For plants, meat and other creatures separately, each sector reports the closeness of
the nearest item (1 touching, 0 at the edge of sight). That gives nine inputs. Seven more complete the picture:

| Input | Meaning |
|---|---|
| energy | Current energy as a fraction of the maximum |
| speed | Current speed as a fraction of top speed |
| relative size | Is the nearest visible creature bigger or smaller? |
| kinship | 1 same species, 0.5 parent or child species, 0 stranger |
| clock | A sine wave whose frequency is a gene |
| memory A, B | Two of the brain's own outputs from the previous tick |

## The brain

A fully connected network: 16 inputs → 10 `tanh` neurons → 6 outputs.

| Output | Effect |
|---|---|
| thrust | Target speed, from slight reverse to top speed |
| turn | Fraction of the maximum turn rate |
| bite | Above 0.5: eat what is in reach, or attack |
| breed | Above 0.5: reproduce if energy and age allow |
| memory A, B | Fed back as inputs next tick |

## Energy

```
maxEnergy = 8 × size²
cost/tick = metabolism × ( 0.003 × size²                  basal
                         + 0.0011 × size² × speed²        locomotion
                         + 0.0005 × senseRange            eyes
                         + 0.008 × fieldOfView            wide vision
                         + 0.02 )                         brain
          + 0.001 × size² while biting
```

Large bodies store more energy, live longer and hit harder, and pay for it every tick. Sharp senses find food
sooner and cost upkeep. These trade-offs are what selection works on.

## Eating and fighting

Diet is one gene between 0 (plants only) and 1 (meat only). Digestion efficiency follows it:

```
plants: (1 − diet)^1.15        meat: diet^0.9 × 0.9
```

When a creature bites, it tries in order:

1. **A plant in reach** (if it can digest plants): eat it whole.
2. **Meat in reach** (if it can digest meat): take a chunk of `3 + 1.5 × size`.
3. **A creature in front of the mouth**: deal damage of `(2 + 0.7 × size) × diet^0.9 × √(size / prey size)`.
   The attacker gains 70% of the damage as energy. Prey that drops to zero energy dies and leaves a corpse.

## Reproduction

A creature breeds when its brain asks to, it is older than 150 ticks, it has rested 90 ticks since the last birth,
and its energy is above its own `breedThreshold` gene. The child receives `offspringShare` of the parent's energy.

- With probability `sexualReproduction`, a nearby adult of the same species is the mate, and the child's genome is
  a **crossover**: each trait gene and each whole neuron comes from one parent or the other.
- The genome is then **mutated**: each gene changes with the genome's own `mutationRate`, by a normal step. About
  2% of births also get one large "macro" mutation in a trait.

## Death

Starvation (energy at zero), old age (`baseLifespan × (0.6 + size / 12)` ticks), predation, or a catastrophe.

## Species

A species is defined by its founder's genome. A newborn stays in its parent's species while its genetic distance
to that founder is below `speciesThreshold`. Otherwise it joins the closest living species within the threshold,
or founds a new one. A species is **established** once it has had five living members at the same time; only
established species appear in the tree of life and the chronicle.

If the population ever falls below eight, a small group of new random organisms appears ("abiogenesis"), so a world
never stays dead.

## Founders

Tick 0 starts with two lineages: grazers (85%) and hunters (15%). Their genomes are random except for a few
hard-wired instincts: steer towards food, keep moving, bite, breed. This only gets the first generation started.
All of it is free to mutate away, and usually has within a few hundred generations.

## Events

| Event | Effect |
|---|---|
| Meteor strike | Kills up to 90% of creatures within a crater, clears its plants |
| Drought | Plant growth × 0.2 for 1,500 ticks |
| Algal bloom | Fills fertile land with plants at once |
| Cosmic radiation | Mutation strength × 4 for 1,000 ticks |
| Ice age | Plant growth × 0.35 for 4,000 ticks |
| Predator invasion | 14 hunters of an unrelated lineage appear |
