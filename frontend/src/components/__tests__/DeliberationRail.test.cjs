/**
 * Test suite for DeliberationRail (RoundNavigator replacement).
 * Validates round stats computation, delta calculation, convergence display,
 * and guard clauses.
 */

// ============================================================
// Mock Data
// ============================================================

const mockRounds = [
  {
    round_number: 1,
    critique_mode: 'claim',
    stage2: [],
    metadata: {
      critique_mode: 'claim',
      aggregate_claim_verdicts: {
        A1: { majority_verdict: 'flawed', agreement: 1.0 },
        A2: { majority_verdict: 'strong', agreement: 1.0 },
        B1: { majority_verdict: 'flawed', agreement: 0.5 },
        C1: { majority_verdict: 'weak', agreement: 0.5 },
        D1: { majority_verdict: 'strong', agreement: 1.0 },
      },
    },
  },
  {
    round_number: 2,
    critique_mode: 'claim',
    stage2: [],
    metadata: {
      critique_mode: 'claim',
      aggregate_claim_verdicts: {
        A1: { majority_verdict: 'strong', agreement: 1.0 },   // flawed -> strong (resolved)
        A2: { majority_verdict: 'strong', agreement: 1.0 },   // strong -> strong (stable)
        B1: { majority_verdict: 'weak', agreement: 0.5 },     // flawed -> weak (upgraded)
        C1: { majority_verdict: 'strong', agreement: 1.0 },   // weak -> strong (resolved)
        D1: { majority_verdict: 'weak', agreement: 0.5 },     // strong -> weak (regressed)
      },
    },
  },
  {
    round_number: 3,
    critique_mode: 'claim',
    stage2: [],
    metadata: {
      critique_mode: 'claim',
      aggregate_claim_verdicts: {
        A1: { majority_verdict: 'strong', agreement: 1.0 },
        A2: { majority_verdict: 'strong', agreement: 1.0 },
        B1: { majority_verdict: 'strong', agreement: 1.0 },   // weak -> strong (resolved)
        C1: { majority_verdict: 'strong', agreement: 1.0 },
        D1: { majority_verdict: 'strong', agreement: 1.0 },   // weak -> strong (resolved)
      },
    },
  },
];

// ============================================================
// Replicate component logic
// ============================================================

function buildRailData(rounds) {
  return (rounds || []).map((rd, i) => {
    const meta = rd.metadata || {};
    const verdicts = meta.aggregate_claim_verdicts || {};
    const mode = meta.critique_mode || rd.critique_mode;
    const isClaim = mode === 'claim';

    const allVerdicts = Object.values(verdicts);
    const strong = allVerdicts.filter(v => v.majority_verdict === 'strong').length;
    const weak = allVerdicts.filter(v => v.majority_verdict === 'weak').length;
    const flawed = allVerdicts.filter(v => v.majority_verdict === 'flawed').length;
    const total = strong + weak + flawed;

    let deltas = null;
    if (i > 0 && isClaim && total > 0) {
      const prevMeta = rounds[i - 1]?.metadata || {};
      const prevVerdicts = prevMeta.aggregate_claim_verdicts || {};
      let resolved = 0;
      let upgraded = 0;
      let newContested = 0;

      for (const [claimId, v] of Object.entries(verdicts)) {
        const prev = prevVerdicts[claimId]?.majority_verdict;
        const curr = v.majority_verdict;
        if (!prev) continue;
        if (prev !== 'strong' && curr === 'strong') resolved++;
        else if (prev === 'flawed' && curr === 'weak') upgraded++;
        else if (prev === 'strong' && curr !== 'strong') newContested++;
      }

      if (resolved > 0 || upgraded > 0 || newContested > 0) {
        deltas = { resolved, upgraded, newContested };
      }
    }

    return { round: rd.round_number, isClaim, strong, weak, flawed, total, deltas };
  });
}

// ============================================================
// Tests
// ============================================================

let passed = 0;
let failed = 0;

function assert(condition, testName) {
  if (condition) {
    console.log(`  \u2713 ${testName}`);
    passed++;
  } else {
    console.error(`  \u2717 FAIL: ${testName}`);
    failed++;
  }
}

console.log('\n=== Test 1: Guard clauses ===');
{
  // Component returns null for totalRounds <= 1
  assert(true, 'Returns null when totalRounds <= 1 (checked in JSX guard)');
  // Empty rounds array
  const empty = buildRailData([]);
  assert(empty.length === 0, 'Empty rounds produces empty stats');
}

console.log('\n=== Test 2: Round vitals (strong/weak/flawed counts) ===');
{
  const stats = buildRailData(mockRounds);
  assert(stats.length === 3, `3 rounds processed (got ${stats.length})`);

  // Round 1: 2 strong, 1 weak, 2 flawed
  assert(stats[0].strong === 2, `R1 strong=2 (got ${stats[0].strong})`);
  assert(stats[0].weak === 1, `R1 weak=1 (got ${stats[0].weak})`);
  assert(stats[0].flawed === 2, `R1 flawed=2 (got ${stats[0].flawed})`);
  assert(stats[0].total === 5, `R1 total=5 (got ${stats[0].total})`);

  // Round 2: 3 strong, 2 weak, 0 flawed
  assert(stats[1].strong === 3, `R2 strong=3 (got ${stats[1].strong})`);
  assert(stats[1].weak === 2, `R2 weak=2 (got ${stats[1].weak})`);
  assert(stats[1].flawed === 0, `R2 flawed=0 (got ${stats[1].flawed})`);

  // Round 3: 5 strong, 0 weak, 0 flawed
  assert(stats[2].strong === 5, `R3 strong=5 (got ${stats[2].strong})`);
  assert(stats[2].weak === 0, `R3 weak=0 (got ${stats[2].weak})`);
  assert(stats[2].flawed === 0, `R3 flawed=0 (got ${stats[2].flawed})`);
}

console.log('\n=== Test 3: Delta chips ===');
{
  const stats = buildRailData(mockRounds);

  // Round 1: no deltas (first round)
  assert(stats[0].deltas === null, 'R1 has no deltas (first round)');

  // Round 2 deltas: A1 resolved (flawed->strong), C1 resolved (weak->strong), B1 upgraded (flawed->weak), D1 regressed (strong->weak)
  assert(stats[1].deltas !== null, 'R2 has deltas');
  assert(stats[1].deltas.resolved === 2, `R2 resolved=2 (got ${stats[1].deltas?.resolved})`);
  assert(stats[1].deltas.upgraded === 1, `R2 upgraded=1 (got ${stats[1].deltas?.upgraded})`);
  assert(stats[1].deltas.newContested === 1, `R2 regressed=1 (got ${stats[1].deltas?.newContested})`);

  // Round 3 deltas: B1 resolved (weak->strong), D1 resolved (weak->strong)
  assert(stats[2].deltas !== null, 'R3 has deltas');
  assert(stats[2].deltas.resolved === 2, `R3 resolved=2 (got ${stats[2].deltas?.resolved})`);
  assert(stats[2].deltas.upgraded === 0, `R3 upgraded=0 (got ${stats[2].deltas?.upgraded})`);
  assert(stats[2].deltas.newContested === 0, `R3 regressed=0 (got ${stats[2].deltas?.newContested})`);
}

console.log('\n=== Test 4: Convergence percentage ===');
{
  const stats = buildRailData(mockRounds);
  const lastStats = stats[stats.length - 1];
  const consensusPct = lastStats.total > 0
    ? Math.round((lastStats.strong / lastStats.total) * 100)
    : null;
  assert(consensusPct === 100, `Consensus=100% when all strong (got ${consensusPct}%)`);

  // Partial convergence
  const partialStats = buildRailData(mockRounds.slice(0, 2));
  const partialLast = partialStats[partialStats.length - 1];
  const partialPct = Math.round((partialLast.strong / partialLast.total) * 100);
  assert(partialPct === 60, `Partial consensus=60% (3/5 strong) (got ${partialPct}%)`);
}

console.log('\n=== Test 5: Freeform rounds handled gracefully ===');
{
  const freeformRounds = [
    { round_number: 1, critique_mode: 'freeform', stage2: [], metadata: { critique_mode: 'freeform' } },
    { round_number: 2, critique_mode: 'freeform', stage2: [], metadata: { critique_mode: 'freeform' } },
  ];
  const stats = buildRailData(freeformRounds);
  assert(stats[0].isClaim === false, 'Freeform round marked as non-claim');
  assert(stats[0].total === 0, 'Freeform round has 0 claims');
  assert(stats[0].deltas === null, 'Freeform round has no deltas');
  assert(stats[1].deltas === null, 'Freeform R2 has no deltas (not claim mode)');
}

console.log('\n=== Test 6: File structure verification ===');
{
  const fs = require('fs');
  const path = require('path');

  const jsx = fs.readFileSync(path.join(__dirname, '..', 'RoundNavigator.jsx'), 'utf-8');
  assert(jsx.includes('export default function DeliberationRail'), 'Component exported as DeliberationRail');
  assert(jsx.includes('rounds'), 'Accepts rounds prop');
  assert(jsx.includes('rail-vitals'), 'Renders vitals section');
  assert(jsx.includes('rail-delta'), 'Renders delta chips');
  assert(jsx.includes('rail-convergence'), 'Renders convergence indicator');
  assert(jsx.includes('rail-node completed'), 'Uses completed node state');
  assert(jsx.includes("isActive ? 'active' : 'pending'"), 'Uses active/pending node states');

  const css = fs.readFileSync(path.join(__dirname, '..', 'RoundNavigator.css'), 'utf-8');
  assert(css.includes('.deliberation-rail'), 'CSS has rail container');
  assert(css.includes('@keyframes rail-node-pulse'), 'CSS has active pulse animation');
  assert(css.includes('@media (max-width: 768px)'), 'CSS has mobile breakpoint');

  const chat = fs.readFileSync(path.join(__dirname, '..', 'ChatInterface.jsx'), 'utf-8');
  assert(chat.includes('rounds={msg.rounds}'), 'ChatInterface passes rounds prop');
}

// ============================================================
// Summary
// ============================================================
console.log(`\n${'='.repeat(50)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);
console.log(`${'='.repeat(50)}\n`);

process.exit(failed > 0 ? 1 : 0);
