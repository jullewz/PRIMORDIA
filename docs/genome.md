# Genome reference

A genome is a flat array of **247 numbers** in the range −8 to 8.

| Index | Count | Content |
|---|---|---|
| 0–10 | 11 | Trait genes |
| 11–180 | 170 | Hidden layer: 10 neurons × (16 input weights + 1 bias) |
| 181–246 | 66 | Output layer: 6 outputs × (10 hidden weights + 1 bias) |

## Trait genes

Each gene `g` is an unbounded number mapped to a physical range with a sigmoid `σ`, so mutation never gets stuck
against a hard limit.

| # | Gene | Mapping | Range |
|---|---|---|---|
| 0 | size | `3 + 7σ(g)` | body radius 3 to 10 |
| 1 | speed | `(0.7 + 2.6σ(g)) × (1.15 − size / 40)` | top speed, slightly lower for big bodies |
| 2 | agility | `0.04 + 0.26σ(g)` | max turn per tick, radians |
| 3 | senseRange | `28 + 130σ(g)` | sight distance |
| 4 | fieldOfView | `0.5 + 2.4σ(g)` | cone angle, radians |
| 5 | diet | `σ(1.5g)` | 0 herbivore to 1 carnivore |
| 6 | hue | `60g mod 360` | body colour, no effect on survival |
| 7 | mutationRate | `0.01 + 0.2σ(g)` | per-gene mutation probability |
| 8 | breedThreshold | `0.45 + 0.5σ(g)` | energy fraction needed to breed |
| 9 | offspringShare | `0.2 + 0.4σ(g)` | energy fraction given to each child |
| 10 | clock | `0.005 + 0.12σ(g)` | frequency of the oscillator input |

The mutation rate is itself a gene. Lineages in stable niches tend to evolve lower rates, lineages under pressure
keep higher ones.

## Mutation

For each gene, with probability `mutationRate × mutationScale`:

```
gene += normal(0, 1) × strength × mutationScale      strength = 0.35 for traits, 0.5 for weights
```

With probability `0.02 × mutationScale` per birth, one random trait gene also receives a large step
(`normal(0, 1) × 1.5`).

## Crossover

Sexual reproduction builds the child from both parents before mutation:

- each **trait gene** comes from either parent with equal probability
- each **neuron** (all of its incoming weights and its bias) comes whole from one parent, so working circuits are
  not shredded

## Genetic distance

Used for species assignment. Genes are squashed with `tanh(g / 2)` first, so extreme values do not dominate.

```
distance = 1.2 × weighted mean trait difference + 0.8 × mean brain weight difference
```

Diet counts double, colour counts a quarter. Measured over 300 random pairs: two unrelated grazer founders are typically 0.5 to
0.75 apart, a grazer and a hunter 0.7 to 1.0, and a child about 0.01 to 0.07 from its parent. The default `speciesThreshold` is 0.24.

## Reading a brain

In the inspector, purple edges are positive weights and orange edges are negative. Node brightness shows the
current activation. Only weights stronger than 0.6 are drawn, to keep the diagram readable.
