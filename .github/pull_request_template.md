## Summary

<!-- What does this change and why? Link related issues with "Closes #123". -->

## Checklist

- [ ] `npm test` passes
- [ ] `npm run typecheck` and `npm run format:check` pass
- [ ] The simulation core stays deterministic (no `Math.random`, DOM or timers in `src/core` and `src/sim`)
- [ ] Balance changes are described with seeds and tick counts, and `docs/simulation.md` is updated
- [ ] `CHANGELOG.md` updated where relevant
