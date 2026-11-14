# Changelog

Follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and [Semantic Versioning](https://semver.org/).
Balance changes are listed under "Changed" because they alter how existing seeds evolve.

## [Unreleased]

## [0.1.0] - 2026-11-14

First public release.

### Added
- Deterministic artificial-life simulation: genomes with 11 trait genes and a 16-10-6 neural network per creature.
- Ecology with fertile terrain, seasons, plants, meat, grazing, scavenging and predation.
- Mutation with evolvable rates, neuron-preserving crossover, speciation with generated names, extinction tracking.
- Browser lab: pan/zoom world view, creature inspector with live brain diagram, tree of life, species stream,
  population and trait charts, chronicle, notable individuals.
- Lab controls: five presets, live settings, six environmental events, food brush, meteor tool, colour modes.
- Seeded worlds shareable by link (with optional `warp`), exact save and load.
- Headless command-line runner with presets, overrides, JSON output and save files.
- 43 tests covering determinism, save/load continuity, invariants, genetics, brains, species and the CLI.

[Unreleased]: https://github.com/jullewz/primordia/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/jullewz/primordia/releases/tag/v0.1.0
