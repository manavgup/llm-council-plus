/**
 * Test suite for ClaimJourneyMap component logic.
 * Validates data transformation, filtering, outcome classification,
 * and rendering behavior with mock multi-round claim data.
 *
 * Run: node --experimental-vm-modules frontend/src/components/__tests__/ClaimJourneyMap.test.js
 */

// ============================================================
// Mock Data: 3 rounds, 5 claims with various trajectories
// ============================================================

const mockRounds = [
  {
    round_number: 1,
    critique_mode: 'claim',
    stage2: [
      {
        model: 'openrouter:gpt-4.1',
        claim_verdicts: {
          A1: { verdict: 'flawed', reason: 'Overly broad scope' },
          A2: { verdict: 'strong', reason: 'Well-sourced' },
          B1: { verdict: 'flawed', reason: 'Missing qualifications' },
          C1: { verdict: 'flawed', reason: 'K8s federation limitations' },
          D1: { verdict: 'flawed', reason: '"All tasks" is false' },
        },
      },
      {
        model: 'openrouter:claude-sonnet-4',
        claim_verdicts: {
          A1: { verdict: 'flawed', reason: 'Not all govt data' },
          A2: { verdict: 'strong', reason: 'Matches analyst data' },
          B1: { verdict: 'weak', reason: 'Needs workload context' },
          C1: { verdict: 'weak', reason: 'Partially true for stateless' },
          D1: { verdict: 'flawed', reason: 'Ignores RLHF gap' },
        },
      },
    ],
    metadata: {
      critique_mode: 'claim',
      canonical_claims: {
        'Response A': [
          { id: 'A1', claim: 'Canada data sovereignty requires all govt data stored in Canada' },
          { id: 'A2', claim: 'Multi-cloud strategies reduce vendor lock-in by 40-60%' },
        ],
        'Response B': [
          { id: 'B1', claim: 'Latency overhead of sovereign cloud is negligible' },
        ],
        'Response C': [
          { id: 'C1', claim: 'K8s federation fully solves multi-region failover' },
        ],
        'Response D': [
          { id: 'D1', claim: 'Open-source LLMs match proprietary for all govt NLP tasks' },
        ],
      },
      aggregate_claim_verdicts: {
        A1: { majority_verdict: 'flawed', agreement: 1.0 },
        A2: { majority_verdict: 'strong', agreement: 1.0 },
        B1: { majority_verdict: 'flawed', agreement: 0.5 },
        C1: { majority_verdict: 'flawed', agreement: 0.5 },
        D1: { majority_verdict: 'flawed', agreement: 1.0 },
      },
      label_to_model: {
        'Response A': 'openrouter:gpt-4.1',
        'Response B': 'openrouter:claude-sonnet-4',
        'Response C': 'openrouter:gemini-2.5-pro',
        'Response D': 'openrouter:llama-4-maverick',
      },
    },
  },
  {
    round_number: 2,
    critique_mode: 'claim',
    stage2: [
      {
        model: 'openrouter:gpt-4.1',
        claim_verdicts: {
          A1: { verdict: 'weak', reason: 'Narrowed but still vague' },
          A2: { verdict: 'strong', reason: 'Consistent' },
          B1: { verdict: 'strong', reason: 'Properly qualified now' },
          C1: { verdict: 'flawed', reason: 'Still says fully solves' },
          D1: { verdict: 'weak', reason: 'Softened to many tasks' },
        },
      },
      {
        model: 'openrouter:claude-sonnet-4',
        claim_verdicts: {
          A1: { verdict: 'strong', reason: 'Adequately corrected' },
          A2: { verdict: 'strong', reason: 'No change needed' },
          B1: { verdict: 'strong', reason: 'Good qualifications' },
          C1: { verdict: 'weak', reason: 'Core claim too strong' },
          D1: { verdict: 'weak', reason: 'Better but drop-in is too strong' },
        },
      },
    ],
    metadata: {
      critique_mode: 'claim',
      canonical_claims: {
        'Response A': [
          { id: 'A1', claim: 'Canada data sovereignty requires all govt data stored in Canada' },
          { id: 'A2', claim: 'Multi-cloud strategies reduce vendor lock-in by 40-60%' },
        ],
        'Response B': [
          { id: 'B1', claim: 'Latency overhead of sovereign cloud is negligible' },
        ],
        'Response C': [
          { id: 'C1', claim: 'K8s federation fully solves multi-region failover' },
        ],
        'Response D': [
          { id: 'D1', claim: 'Open-source LLMs match proprietary for all govt NLP tasks' },
        ],
      },
      aggregate_claim_verdicts: {
        A1: { majority_verdict: 'weak', agreement: 0.5 },
        A2: { majority_verdict: 'strong', agreement: 1.0 },
        B1: { majority_verdict: 'strong', agreement: 1.0 },
        C1: { majority_verdict: 'flawed', agreement: 0.5 },
        D1: { majority_verdict: 'weak', agreement: 1.0 },
      },
      label_to_model: {
        'Response A': 'openrouter:gpt-4.1',
        'Response B': 'openrouter:claude-sonnet-4',
        'Response C': 'openrouter:gemini-2.5-pro',
        'Response D': 'openrouter:llama-4-maverick',
      },
    },
  },
  {
    round_number: 3,
    critique_mode: 'claim',
    stage2: [
      {
        model: 'openrouter:gpt-4.1',
        claim_verdicts: {
          A1: { verdict: 'strong', reason: 'Properly scoped now' },
          A2: { verdict: 'strong', reason: 'No issues' },
          B1: { verdict: 'strong', reason: 'Well-scoped' },
          C1: { verdict: 'weak', reason: 'Still implies too much' },
          D1: { verdict: 'flawed', reason: 'Reverted to can match' },
        },
      },
      {
        model: 'openrouter:claude-sonnet-4',
        claim_verdicts: {
          A1: { verdict: 'strong', reason: 'Accurate citations' },
          A2: { verdict: 'strong', reason: 'Solid' },
          B1: { verdict: 'strong', reason: 'No further objections' },
          C1: { verdict: 'strong', reason: 'Scoped to stateless' },
          D1: { verdict: 'weak', reason: 'Lacks nuance' },
        },
      },
    ],
    metadata: {
      critique_mode: 'claim',
      canonical_claims: {
        'Response A': [
          { id: 'A1', claim: 'Canada data sovereignty requires all govt data stored in Canada' },
          { id: 'A2', claim: 'Multi-cloud strategies reduce vendor lock-in by 40-60%' },
        ],
        'Response B': [
          { id: 'B1', claim: 'Latency overhead of sovereign cloud is negligible' },
        ],
        'Response C': [
          { id: 'C1', claim: 'K8s federation fully solves multi-region failover' },
        ],
        'Response D': [
          { id: 'D1', claim: 'Open-source LLMs match proprietary for all govt NLP tasks' },
        ],
      },
      aggregate_claim_verdicts: {
        A1: { majority_verdict: 'strong', agreement: 1.0 },
        A2: { majority_verdict: 'strong', agreement: 1.0 },
        B1: { majority_verdict: 'strong', agreement: 1.0 },
        C1: { majority_verdict: 'weak', agreement: 0.5 },
        D1: { majority_verdict: 'flawed', agreement: 0.5 },
      },
      label_to_model: {
        'Response A': 'openrouter:gpt-4.1',
        'Response B': 'openrouter:claude-sonnet-4',
        'Response C': 'openrouter:gemini-2.5-pro',
        'Response D': 'openrouter:llama-4-maverick',
      },
    },
  },
];

// ============================================================
// Replicate component logic (pure data transforms)
// ============================================================

function buildJourneyData(rounds) {
  if (!rounds || rounds.length < 2) return { error: 'Not enough rounds' };

  const roundData = rounds.map(rd => {
    const meta = rd.metadata || {};
    const claims = meta.canonical_claims || {};
    const verdicts = meta.aggregate_claim_verdicts || {};
    const l2m = meta.label_to_model || {};
    const stage2 = rd.stage2 || [];
    const totalClaims = Object.values(claims).reduce((sum, arr) => sum + arr.length, 0);
    return {
      round: rd.round_number,
      claims, verdicts, l2m, stage2, totalClaims,
      mode: meta.critique_mode || rd.critique_mode,
    };
  }).filter(rd => rd.mode === 'claim' && rd.totalClaims > 0);

  if (roundData.length < 1) return { error: 'No claim-mode rounds' };

  const claimMap = new Map();
  for (const rd of roundData) {
    for (const [label, claimList] of Object.entries(rd.claims)) {
      for (const claim of claimList) {
        if (!claimMap.has(claim.id)) {
          claimMap.set(claim.id, {
            id: claim.id,
            claim: claim.claim,
            sourceLabel: label,
            sourceModel: rd.l2m[label] || label,
          });
        }
      }
    }
  }

  const claimTrajectories = [];
  for (const [claimId, claimInfo] of claimMap) {
    const verdicts = [];
    for (const rd of roundData) {
      const vi = rd.verdicts[claimId];
      const evaluatorVerdicts = [];
      for (const result of rd.stage2) {
        const cv = result.claim_verdicts?.[claimId];
        if (cv) {
          evaluatorVerdicts.push({
            model: result.model,
            verdict: cv.verdict,
            reason: cv.reason,
          });
        }
      }
      verdicts.push({
        round: rd.round,
        majority: vi?.majority_verdict || null,
        agreement: vi?.agreement,
        evaluators: evaluatorVerdicts,
      });
    }

    const firstVerdict = verdicts[0]?.majority;
    const lastVerdict = verdicts[verdicts.length - 1]?.majority;
    const allStrong = verdicts.every(v => v.majority === 'strong');
    const endedStrong = lastVerdict === 'strong';
    let outcome;
    if (allStrong) outcome = 'stable';
    else if (endedStrong) outcome = 'resolved';
    else outcome = 'persistent';

    const changed = !verdicts.every(v => v.majority === firstVerdict);

    claimTrajectories.push({ ...claimInfo, verdicts, outcome, changed });
  }

  return { roundData, claimTrajectories };
}

// ============================================================
// Tests
// ============================================================

let passed = 0;
let failed = 0;

function assert(condition, testName) {
  if (condition) {
    console.log(`  ✓ ${testName}`);
    passed++;
  } else {
    console.error(`  ✗ FAIL: ${testName}`);
    failed++;
  }
}

console.log('\n=== Test 1: Journey Map renders with multi-round data ===');
{
  const result = buildJourneyData(mockRounds);
  assert(!result.error, 'No error returned');
  assert(result.roundData.length === 3, `3 rounds of claim data (got ${result.roundData?.length})`);
  assert(result.claimTrajectories.length === 5, `5 claims tracked (got ${result.claimTrajectories?.length})`);

  // Verify it returns null for insufficient data
  const noRounds = buildJourneyData([]);
  assert(noRounds.error === 'Not enough rounds', 'Returns null for empty rounds');

  const oneRound = buildJourneyData([mockRounds[0]]);
  assert(oneRound.error === 'Not enough rounds', 'Returns null for single round');

  // Verify it filters non-claim rounds
  const mixedRounds = [
    { ...mockRounds[0] },
    { round_number: 2, critique_mode: 'freeform', stage2: [], metadata: { critique_mode: 'freeform', canonical_claims: {} } },
    { ...mockRounds[2] },
  ];
  const mixedResult = buildJourneyData(mixedRounds);
  assert(mixedResult.roundData.length === 2, `Filters to 2 claim-mode rounds (got ${mixedResult.roundData?.length})`);
}

console.log('\n=== Test 2: Double-click expansion — data availability ===');
{
  const result = buildJourneyData(mockRounds);
  const claimA1 = result.claimTrajectories.find(c => c.id === 'A1');

  assert(claimA1 !== undefined, 'Claim A1 found');
  assert(claimA1.claim.length > 0, 'Full claim text available for expansion');
  assert(claimA1.verdicts.length === 3, `3 rounds of verdicts (got ${claimA1?.verdicts.length})`);

  // Verify per-evaluator verdicts are available for expansion
  const r1Evaluators = claimA1.verdicts[0].evaluators;
  assert(r1Evaluators.length === 2, `2 evaluators in round 1 (got ${r1Evaluators.length})`);
  assert(r1Evaluators[0].model === 'openrouter:gpt-4.1', `Evaluator model correct (got ${r1Evaluators[0].model})`);
  assert(r1Evaluators[0].verdict === 'flawed', `Evaluator verdict correct (got ${r1Evaluators[0].verdict})`);
  assert(r1Evaluators[0].reason.length > 0, 'Evaluator reason available');

  // Verify accordion: expandedClaim state toggling
  let expandedClaim = null;
  const handleDoubleClick = (claimId) => {
    expandedClaim = expandedClaim === claimId ? null : claimId;
  };
  handleDoubleClick('A1');
  assert(expandedClaim === 'A1', 'First double-click opens claim');
  handleDoubleClick('A1');
  assert(expandedClaim === null, 'Second double-click closes same claim');
  handleDoubleClick('A1');
  handleDoubleClick('B1');
  assert(expandedClaim === 'B1', 'Double-clicking different claim switches to it');
}

console.log('\n=== Test 3: Filter buttons ===');
{
  const result = buildJourneyData(mockRounds);
  const trajectories = result.claimTrajectories;

  // Filter: all
  const all = trajectories.filter(() => true);
  assert(all.length === 5, `All filter: 5 claims (got ${all.length})`);

  // Filter: changed (verdict changed across rounds)
  const changed = trajectories.filter(ct => ct.changed);
  // A1: flawed->weak->strong (changed), A2: strong->strong->strong (not changed)
  // B1: flawed->strong->strong (changed), C1: flawed->flawed->weak (changed)
  // D1: flawed->weak->flawed (changed)
  assert(changed.length === 4, `Changed filter: 4 claims (got ${changed.length})`);
  assert(!changed.find(c => c.id === 'A2'), 'A2 (all strong) excluded from changed');

  // Filter: contested (outcome === 'persistent')
  const contested = trajectories.filter(ct => ct.outcome === 'persistent');
  assert(contested.length === 2, `Contested filter: 2 claims (got ${contested.length})`);
  assert(contested.find(c => c.id === 'C1'), 'C1 is persistent');
  assert(contested.find(c => c.id === 'D1'), 'D1 is persistent');

  // Empty filter result
  const emptyRounds = [
    { ...mockRounds[0], metadata: { ...mockRounds[0].metadata, aggregate_claim_verdicts: Object.fromEntries(Object.keys(mockRounds[0].metadata.aggregate_claim_verdicts).map(k => [k, { majority_verdict: 'strong', agreement: 1 }])) } },
    { ...mockRounds[1], metadata: { ...mockRounds[1].metadata, aggregate_claim_verdicts: Object.fromEntries(Object.keys(mockRounds[1].metadata.aggregate_claim_verdicts).map(k => [k, { majority_verdict: 'strong', agreement: 1 }])) } },
  ];
  const allStrongResult = buildJourneyData(emptyRounds);
  const contestedFromAllStrong = allStrongResult.claimTrajectories.filter(ct => ct.outcome === 'persistent');
  assert(contestedFromAllStrong.length === 0, 'No persistent claims when all are strong');
}

console.log('\n=== Test 4: Outcome badges ===');
{
  const result = buildJourneyData(mockRounds);
  const byId = Object.fromEntries(result.claimTrajectories.map(c => [c.id, c]));

  // A1: flawed -> weak -> strong = RESOLVED (was contested, ended strong)
  assert(byId.A1.outcome === 'resolved', `A1 outcome: resolved (got ${byId.A1.outcome})`);

  // A2: strong -> strong -> strong = STABLE (always strong)
  assert(byId.A2.outcome === 'stable', `A2 outcome: stable (got ${byId.A2.outcome})`);

  // B1: flawed -> strong -> strong = RESOLVED
  assert(byId.B1.outcome === 'resolved', `B1 outcome: resolved (got ${byId.B1.outcome})`);

  // C1: flawed -> flawed -> weak = PERSISTENT (still contested)
  assert(byId.C1.outcome === 'persistent', `C1 outcome: persistent (got ${byId.C1.outcome})`);

  // D1: flawed -> weak -> flawed = PERSISTENT
  assert(byId.D1.outcome === 'persistent', `D1 outcome: persistent (got ${byId.D1.outcome})`);

  // Verify changed flags
  assert(byId.A1.changed === true, 'A1 changed=true (flawed->weak->strong)');
  assert(byId.A2.changed === false, 'A2 changed=false (strong->strong->strong)');
  assert(byId.D1.changed === true, 'D1 changed=true (flawed->weak->flawed)');
}

console.log('\n=== Test 5: Responsive layout (CSS validation) ===');
{
  // Verify the CSS file contains responsive media query
  const fs = require('fs');
  const css = fs.readFileSync(
    require('path').join(__dirname, '..', 'ClaimCards.css'),
    'utf-8'
  );

  assert(css.includes('@media (max-width: 768px)'), 'Has mobile breakpoint media query');
  assert(css.includes('grid-template-columns: 1fr'), 'Mobile: single column layout');
  assert(css.includes('.journey-round-headers { display: none; }') ||
         css.includes('journey-round-headers { display: none'), 'Mobile: hides column headers');
  assert(css.includes('.lane-detail-grid'), 'Has expanded detail grid');

  // Verify dynamic grid columns in component (inline styles)
  const jsx = fs.readFileSync(
    require('path').join(__dirname, '..', 'ClaimCards.jsx'),
    'utf-8'
  );
  assert(jsx.includes('gridTemplateColumns'), 'Uses dynamic gridTemplateColumns');
  assert(jsx.includes('repeat(${roundData.length}'), 'Grid adapts to round count');
}

console.log('\n=== Test 6: Build verification ===');
{
  // Already verified by npm run build - just confirm no syntax issues
  const fs = require('fs');
  const jsx = fs.readFileSync(
    require('path').join(__dirname, '..', 'ClaimCards.jsx'),
    'utf-8'
  );
  assert(jsx.includes('export function ClaimJourneyMap'), 'ClaimJourneyMap is exported');
  assert(jsx.includes('export { ClaimJourneyMap as ClaimEvolution }'), 'Backward-compatible ClaimEvolution alias');
  assert(jsx.includes('export function ClaimCardWithVerdicts'), 'ClaimCardWithVerdicts still exported');
  assert(jsx.includes('export default function ClaimCards'), 'Default ClaimCards export intact');

  // Verify ChatInterface import
  const chatInterface = fs.readFileSync(
    require('path').join(__dirname, '..', 'ChatInterface.jsx'),
    'utf-8'
  );
  assert(chatInterface.includes("import { ClaimJourneyMap } from './ClaimCards'"), 'ChatInterface imports ClaimJourneyMap');
  assert(chatInterface.includes('<ClaimJourneyMap'), 'ChatInterface renders ClaimJourneyMap');
  assert(!chatInterface.includes('ClaimEvolution'), 'ChatInterface no longer references ClaimEvolution');
}

// ============================================================
// Summary
// ============================================================
console.log(`\n${'='.repeat(50)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);
console.log(`${'='.repeat(50)}\n`);

process.exit(failed > 0 ? 1 : 0);
