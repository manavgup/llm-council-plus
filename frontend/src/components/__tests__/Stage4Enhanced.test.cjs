/**
 * Test suite for enhanced Stage4 component logic.
 * Validates marker parsing, stats counting, clean copy, claims summary.
 */

// ============================================================
// Replicate component logic (pure functions)
// ============================================================

function highlightRevisionMarkers(text) {
  if (!text) return text;
  return text
    .replace(/\[REVISED[:\s]*/gi, '<span class="marker-revised">REVISED</span> <span class="revised-text">')
    .replace(/\[NEW[:\s]*/gi, '<span class="marker-new">NEW</span> <span class="new-text">')
    .replace(/\](?=\s|$|\.)/g, '</span>');
}

function countMarkers(text) {
  if (!text) return { revised: 0, newSections: 0 };
  const revised = (text.match(/\[REVISED/gi) || []).length;
  const newSections = (text.match(/\[NEW/gi) || []).length;
  return { revised, newSections };
}

function stripMarkers(text) {
  if (!text) return '';
  return text
    .replace(/\[REVISED[:\s]*/gi, '')
    .replace(/\[NEW[:\s]*/gi, '')
    .replace(/\](?=\s|$|\.)/g, '');
}

function buildClaimsSummary(rounds) {
  if (!rounds || rounds.length < 2) return null;
  const claimRounds = rounds.filter(rd => {
    const mode = rd.metadata?.critique_mode || rd.critique_mode;
    return mode === 'claim';
  });
  if (claimRounds.length < 1) return null;

  const firstRound = claimRounds[0];
  const lastRound = claimRounds[claimRounds.length - 1];
  const firstVerdicts = firstRound.metadata?.aggregate_claim_verdicts || {};
  const lastVerdicts = lastRound.metadata?.aggregate_claim_verdicts || {};
  const claims = lastRound.metadata?.canonical_claims || firstRound.metadata?.canonical_claims || {};

  const summary = [];
  for (const [label, claimList] of Object.entries(claims)) {
    for (const claim of claimList) {
      const first = firstVerdicts[claim.id]?.majority_verdict;
      const last = lastVerdicts[claim.id]?.majority_verdict;
      let action;
      if (first && first !== 'strong' && last === 'strong') action = 'revised';
      else if (first === 'strong' && last === 'strong') action = 'kept';
      else if (!first && last) action = 'revised';
      else action = 'revised';
      summary.push({ id: claim.id, claim: claim.claim, action, lastVerdict: last });
    }
  }
  return summary.length > 0 ? summary : null;
}

// ============================================================
// Mock data
// ============================================================

const sampleText = `## Cloud Strategy

[REVISED: Canadian data sovereignty regulations require Protected B+ data to be stored within Canadian borders.]

Multi-cloud strategies reduce vendor lock-in by 40-60%.

[NEW: For stateful workloads, implement CRDTs alongside K8s federation.]

[REVISED: Open-source LLMs have competitive performance on standard NLP benchmarks but do not match proprietary models on complex reasoning.]`;

const mockRounds = [
  {
    round_number: 1,
    metadata: {
      critique_mode: 'claim',
      canonical_claims: {
        'Response A': [
          { id: 'A1', claim: 'Data sovereignty requires all govt data in Canada' },
          { id: 'A2', claim: 'Multi-cloud reduces lock-in by 40-60%' },
        ],
        'Response B': [
          { id: 'B1', claim: 'K8s federation solves failover' },
        ],
      },
      aggregate_claim_verdicts: {
        A1: { majority_verdict: 'flawed' },
        A2: { majority_verdict: 'strong' },
        B1: { majority_verdict: 'weak' },
      },
    },
  },
  {
    round_number: 2,
    metadata: {
      critique_mode: 'claim',
      canonical_claims: {
        'Response A': [
          { id: 'A1', claim: 'Data sovereignty requires all govt data in Canada' },
          { id: 'A2', claim: 'Multi-cloud reduces lock-in by 40-60%' },
        ],
        'Response B': [
          { id: 'B1', claim: 'K8s federation solves failover' },
        ],
      },
      aggregate_claim_verdicts: {
        A1: { majority_verdict: 'strong' },
        A2: { majority_verdict: 'strong' },
        B1: { majority_verdict: 'weak' },
      },
    },
  },
];

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

console.log('\n=== Test 1: Marker counting ===');
{
  const { revised, newSections } = countMarkers(sampleText);
  assert(revised === 2, `2 REVISED markers (got ${revised})`);
  assert(newSections === 1, `1 NEW marker (got ${newSections})`);

  // Empty/null
  const empty = countMarkers('');
  assert(empty.revised === 0, 'Empty text: 0 revised');
  assert(empty.newSections === 0, 'Empty text: 0 new');

  const none = countMarkers(null);
  assert(none.revised === 0, 'Null text: 0 revised');

  // Case insensitive
  const mixed = countMarkers('[revised: foo] [Revised bar] [NEW baz]');
  assert(mixed.revised === 2, `Case insensitive: 2 revised (got ${mixed.revised})`);
  assert(mixed.newSections === 1, `Case insensitive: 1 new (got ${mixed.newSections})`);
}

console.log('\n=== Test 2: Marker highlighting ===');
{
  const result = highlightRevisionMarkers(sampleText);
  assert(result.includes('class="marker-revised"'), 'Contains marker-revised span');
  assert(result.includes('class="marker-new"'), 'Contains marker-new span');
  assert(result.includes('class="revised-text"'), 'Contains revised-text span');
  assert(result.includes('class="new-text"'), 'Contains new-text span');
  assert(!result.includes('[REVISED'), 'Original [REVISED tag removed');
  assert(!result.includes('[NEW'), 'Original [NEW tag removed');

  // Null passthrough
  assert(highlightRevisionMarkers(null) === null, 'Null returns null');
}

console.log('\n=== Test 3: Strip markers (clean copy) ===');
{
  const clean = stripMarkers(sampleText);
  assert(!clean.includes('[REVISED'), 'No [REVISED in clean text');
  assert(!clean.includes('[NEW'), 'No [NEW in clean text');
  assert(clean.includes('Canadian data sovereignty'), 'Content preserved');
  assert(clean.includes('CRDTs alongside K8s'), 'New content preserved');

  // Null
  assert(stripMarkers(null) === '', 'Null returns empty string');
  assert(stripMarkers('') === '', 'Empty returns empty string');
}

console.log('\n=== Test 4: Claims summary from rounds ===');
{
  const summary = buildClaimsSummary(mockRounds);
  assert(summary !== null, 'Summary generated');
  assert(summary.length === 3, `3 claims in summary (got ${summary?.length})`);

  const byId = Object.fromEntries(summary.map(c => [c.id, c]));

  // A1: flawed -> strong = revised
  assert(byId.A1.action === 'revised', `A1 action: revised (got ${byId.A1.action})`);
  // A2: strong -> strong = kept
  assert(byId.A2.action === 'kept', `A2 action: kept (got ${byId.A2.action})`);
  // B1: weak -> weak = revised (still contested)
  assert(byId.B1.action === 'revised', `B1 action: revised (got ${byId.B1.action})`);
}

console.log('\n=== Test 5: Claims summary guard clauses ===');
{
  assert(buildClaimsSummary(null) === null, 'Null rounds: null');
  assert(buildClaimsSummary([]) === null, 'Empty rounds: null');
  assert(buildClaimsSummary([mockRounds[0]]) === null, 'Single round: null');

  // Freeform-only rounds
  const freeform = [
    { round_number: 1, metadata: { critique_mode: 'freeform' } },
    { round_number: 2, metadata: { critique_mode: 'freeform' } },
  ];
  assert(buildClaimsSummary(freeform) === null, 'Freeform rounds: null');
}

console.log('\n=== Test 6: File structure ===');
{
  const fs = require('fs');
  const path = require('path');

  const jsx = fs.readFileSync(path.join(__dirname, '..', 'Stage4.jsx'), 'utf-8');
  assert(jsx.includes('export default function Stage4'), 'Component exported');
  assert(jsx.includes('draft-banner'), 'Has banner section');
  assert(jsx.includes('draft-stats-bar'), 'Has stats bar');
  assert(jsx.includes('draft-claims-footer'), 'Has claims footer');
  assert(jsx.includes('stripMarkers'), 'Uses stripMarkers for copy');
  assert(jsx.includes('countMarkers'), 'Uses countMarkers for stats');
  assert(jsx.includes('buildClaimsSummary'), 'Builds claims summary');
  assert(jsx.includes('rounds'), 'Accepts rounds prop');
  assert(jsx.includes('export function Stage4Skeleton'), 'Skeleton still exported');

  const css = fs.readFileSync(path.join(__dirname, '..', 'Stage4.css'), 'utf-8');
  assert(css.includes('.corrected-draft-section'), 'CSS has section container');
  assert(css.includes('.draft-banner'), 'CSS has banner');
  assert(css.includes('.marker-revised'), 'CSS has revised marker');
  assert(css.includes('.marker-new'), 'CSS has new marker');
  assert(css.includes('.revised-text'), 'CSS has revised text highlight');
  assert(css.includes('.claim-ref'), 'CSS has claim ref styles');
  assert(css.includes('@media (max-width: 768px)'), 'CSS has mobile breakpoint');

  const chat = fs.readFileSync(path.join(__dirname, '..', 'ChatInterface.jsx'), 'utf-8');
  assert(chat.includes('rounds={msg.rounds}') && chat.includes('Stage4'), 'ChatInterface passes rounds to Stage4');
}

// ============================================================
// Summary
// ============================================================
console.log(`\n${'='.repeat(50)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);
console.log(`${'='.repeat(50)}\n`);

process.exit(failed > 0 ? 1 : 0);
