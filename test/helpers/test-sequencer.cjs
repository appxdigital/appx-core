/**
 * Deterministic test ordering.
 *
 * Jest's default sequencer orders by file size (largest first) when there's no
 * timing cache — as on a fresh CI runner. That makes ordering fragile: editing
 * a spec's size can reshuffle the run.
 *
 * Two rules:
 *   1. `create-parity.spec.ts` runs LAST. It's a heavy end-to-end test that
 *      spawns `cli.js create` (npm install + `prisma migrate dev`, ~70s) and
 *      shares the one test container. Anything that runs after it can observe a
 *      perturbed database/connection state, so we make sure nothing does.
 *   2. Everything else runs in a stable alphabetical order.
 */
const Sequencer = require('@jest/test-sequencer').default;

const LAST = ['create-parity.spec.ts'];

function rank(testPath) {
    return LAST.some((name) => testPath.endsWith(name)) ? 1 : 0;
}

class DeterministicSequencer extends Sequencer {
    sort(tests) {
        return [...tests].sort((a, b) => {
            const byRank = rank(a.path) - rank(b.path);
            return byRank !== 0 ? byRank : a.path.localeCompare(b.path);
        });
    }
}

module.exports = DeterministicSequencer;
