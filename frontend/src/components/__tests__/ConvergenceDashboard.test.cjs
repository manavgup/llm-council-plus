/**
 * Test suite for ConvergenceDashboard component logic.
 * Validates consensus calculation, stat rows, ring math, guard clauses.
 */

// ============================================================
// Mock Data
// ============================================================

function makeRound(roundNum, verdictMap, mode = 'claim') {
  return {
    round_number: roundNum,
    critique_mode: mode,
    stage2: [],
    metadata: {
      critique_mode: mode,
      aggregate_claim_verdicts: verdictMap,
    },
  };
}

const fullConsensusRounds = [
  makeRound(1, {
    A1: { majority_verdict: 'flawed' },
    A2: { majority_verdict: 'strong' },
    B1: { majority_verdict: 'weak' },
  }),
  makeRound(2, {
    A1: { majority_verdict: 'strong' },
    A2: { majority_verdict: 'strong' },
    B1: { majority_verdict: 'strong' },
  }),
];

const partialConsensusRounds = [
  makeRound(1, {
    A1: { majority_verdict: 'flawed' },
    A2: { majority_verdict: 'strong' },
    B1: { majority_verdict: 'weak' },
    C1: { majority_verdict: 'flawed' },
    D1: { majority_verdict: 'strong' },
  }),
  makeRound(2, {
    A1: { majority_verdict: 'strong' },
    A2: { majority_verdict: 'strong' },
    B1: { majority_verdict: 'strong' },
    C1: { majority_verdict: 'weak' },
    D1: { majority_verdict: 'flawed' },
  }),
];

// ============================================================
// Replicate component logic
// ============================================================

function computeDashboard(rounds, totalRounds, converged) {
  if (!rounds || rounds.length < 2) return null;

  const lastRound = rounds[rounds.length - 1];
  const meta = lastRound?.metadata || {};
  const mode = meta.critique_mode || lastRound?.critique_mode;
  if (mode !== 'claim') return null;

  const verdicts = meta.aggregate_claim_verdicts || {};
  const allVerdicts = Object.values(verdicts);
  const total = allVerdicts.length;
  if (total === 0) return null;

  const strong = allVerdicts.filter(v => v.majority_verdict === 'strong').length;
  const contested = total - strong;
  const pct = Math.round((strong / total) * 100);

  const roundsCompleted = rounds.length;
  const maxRounds = totalRounds || roundsCompleted;
  const roundsPct = maxRounds > 0 ? Math.round((roundsCompleted / maxRounds) * 100) : 0;

  // Ring math
  const radius = 50;
  const circumference = 2 * Math.PI * radius;
  const dashoffset = circumference * (1 - pct / 100);

  return { total, strong, contested, pct, roundsCompleted, maxRounds, roundsPct, circumference, dashoffset, converged };
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
  assert(computeDashboard(null) === null, 'Returns null for null rounds');
  assert(computeDashboard([]) === null, 'Returns null for empty rounds');
  assert(computeDashboard([makeRound(1, { A: { majority_verdict: 'strong' } })]) === null, 'Returns null for single round');

  // Freeform mode
  const freeformRounds = [
    makeRound(1, {}, 'freeform'),
    makeRound(2, {}, 'freeform'),
  ];
  assert(computeDashboard(freeformRounds) === null, 'Returns null for freeform-only rounds');

  // Empty verdicts
  const emptyVerdictRounds = [
    makeRound(1, {}),
    makeRound(2, {}),
  ];
  assert(computeDashboard(emptyVerdictRounds) === null, 'Returns null for empty verdicts');
}

console.log('\n=== Test 2: Full consensus (100%) ===');
{
  const d = computeDashboard(fullConsensusRounds, 3, true);
  assert(d !== null, 'Dashboard renders');
  assert(d.total === 3, `Total claims = 3 (got ${d.total})`);
  assert(d.strong === 3, `Strong = 3 (got ${d.strong})`);
  assert(d.contested === 0, `Contested = 0 (got ${d.contested})`);
  assert(d.pct === 100, `Consensus = 100% (got ${d.pct})`);
  assert(d.roundsCompleted === 2, `Rounds completed = 2 (got ${d.roundsCompleted})`);
  assert(d.maxRounds === 3, `Max rounds = 3 (got ${d.maxRounds})`);
  assert(d.roundsPct === 67, `Rounds pct = 67% (got ${d.roundsPct})`);
  assert(d.converged === true, 'Converged flag is true');
}

console.log('\n=== Test 3: Partial consensus (60%) ===');
{
  const d = computeDashboard(partialConsensusRounds, 4, false);
  assert(d.total === 5, `Total claims = 5 (got ${d.total})`);
  assert(d.strong === 3, `Strong = 3 (got ${d.strong})`);
  assert(d.contested === 2, `Contested = 2 (got ${d.contested})`);
  assert(d.pct === 60, `Consensus = 60% (got ${d.pct})`);
  assert(d.roundsCompleted === 2, `Rounds completed = 2 (got ${d.roundsCompleted})`);
  assert(d.maxRounds === 4, `Max rounds = 4 (got ${d.maxRounds})`);
  assert(d.roundsPct === 50, `Rounds pct = 50% (2/4) (got ${d.roundsPct})`);
  assert(d.converged === false, 'Converged flag is false');
}

console.log('\n=== Test 4: SVG ring math ===');
{
  const d = computeDashboard(fullConsensusRounds, 3, true);
  const expectedCirc = 2 * Math.PI * 50;
  assert(Math.abs(d.circumference - expectedCirc) < 0.01, `Circumference = ${expectedCirc.toFixed(2)} (got ${d.circumference.toFixed(2)})`);
  assert(d.dashoffset === 0, 'Dashoffset = 0 at 100% (full ring)');

  const d60 = computeDashboard(partialConsensusRounds, 4, false);
  const expected60 = expectedCirc * 0.4; // 40% unfilled
  assert(Math.abs(d60.dashoffset - expected60) < 0.01, `Dashoffset at 60% = ${expected60.toFixed(2)} (got ${d60.dashoffset.toFixed(2)})`);
}

console.log('\n=== Test 5: Edge case — totalRounds not provided ===');
{
  const d = computeDashboard(fullConsensusRounds, undefined, false);
  assert(d.maxRounds === 2, `Falls back to rounds.length (got ${d.maxRounds})`);
  assert(d.roundsPct === 100, `Rounds pct = 100% when max = completed (got ${d.roundsPct})`);
}

console.log('\n=== Test 6: File structure ===');
{
  const fs = require('fs');
  const path = require('path');

  const jsx = fs.readFileSync(path.join(__dirname, '..', 'ConvergenceDashboard.jsx'), 'utf-8');
  assert(jsx.includes('export default function ConvergenceDashboard'), 'Component exported');
  assert(jsx.includes('ring-progress'), 'Renders SVG ring');
  assert(jsx.includes('convergence-stats'), 'Renders stats section');
  assert(jsx.includes('conv-mini-bar'), 'Renders mini bars');
  assert(jsx.includes('convRingGrad'), 'Has gradient definition');

  const css = fs.readFileSync(path.join(__dirname, '..', 'ConvergenceDashboard.css'), 'utf-8');
  assert(css.includes('.convergence-dashboard'), 'CSS has dashboard container');
  assert(css.includes('.convergence-ring'), 'CSS has ring styles');
  assert(css.includes('@media (max-width: 768px)'), 'CSS has mobile breakpoint');
  assert(css.includes('grid-template-columns: 1fr'), 'Mobile: stacks to single column');

  const chat = fs.readFileSync(path.join(__dirname, '..', 'ChatInterface.jsx'), 'utf-8');
  assert(chat.includes("import ConvergenceDashboard from './ConvergenceDashboard'"), 'ChatInterface imports ConvergenceDashboard');
  assert(chat.includes('<ConvergenceDashboard'), 'ChatInterface renders ConvergenceDashboard');
}

// ============================================================
// Summary
// ============================================================
console.log(`\n${'='.repeat(50)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);
console.log(`${'='.repeat(50)}\n`);

process.exit(failed > 0 ? 1 : 0);
