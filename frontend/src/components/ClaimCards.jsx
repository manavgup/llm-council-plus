import { useState } from 'react';
import { getShortModelName } from '../utils/modelHelpers';
import './ClaimCards.css';

export default function ClaimCards({ claims, labelToModel }) {
  if (!claims || Object.keys(claims).length === 0) return null;

  const flatClaims = [];
  for (const [label, claimList] of Object.entries(claims)) {
    for (const claim of claimList) {
      flatClaims.push({ ...claim, sourceLabel: label, sourceModel: labelToModel?.[label] || label });
    }
  }

  if (flatClaims.length === 0) return null;

  return (
    <div className="claim-cards">
      <h4>Canonical Claims</h4>
      <p className="claim-cards-description">Claims extracted from each response and evaluated by all peers.</p>
      <div className="claim-cards-grid">
        {flatClaims.map((claim) => (
          <ClaimCardSimple key={claim.id} claim={claim} />
        ))}
      </div>
    </div>
  );
}

function ClaimCardSimple({ claim }) {
  return (
    <div className="claim-card">
      <div className="claim-header">
        <span className="claim-id">{claim.id}</span>
        <span className="claim-source">{getShortModelName(claim.sourceModel)}</span>
      </div>
      <p className="claim-text">&ldquo;{claim.claim}&rdquo;</p>
    </div>
  );
}

/**
 * Main claim evaluation display for Stage 2 in claim mode.
 * Surfaces contested/flawed claims prominently at the top.
 */
export function ClaimCardWithVerdicts({ claims, aggregatedVerdicts, labelToModel, stage2Results }) {
  const [showAllStrong, setShowAllStrong] = useState(false);

  if (!claims || Object.keys(claims).length === 0) return null;

  const flatClaims = [];
  for (const [label, claimList] of Object.entries(claims)) {
    for (const claim of claimList) {
      const verdictInfo = aggregatedVerdicts?.[claim.id] || {};
      const evaluatorVerdicts = [];
      if (stage2Results) {
        for (const result of stage2Results) {
          const cv = result.claim_verdicts?.[claim.id];
          if (cv) {
            evaluatorVerdicts.push({ model: result.model, verdict: cv.verdict, reason: cv.reason });
          }
        }
      }
      flatClaims.push({
        ...claim,
        sourceLabel: label,
        sourceModel: labelToModel?.[label] || label,
        majority_verdict: verdictInfo.majority_verdict,
        agreement: verdictInfo.agreement,
        evaluator_verdicts: evaluatorVerdicts,
      });
    }
  }

  if (flatClaims.length === 0) return null;

  // Split into contested and strong
  const contested = flatClaims.filter(c => c.majority_verdict && c.majority_verdict !== 'strong');
  const strong = flatClaims.filter(c => c.majority_verdict === 'strong');
  const unknown = flatClaims.filter(c => !c.majority_verdict);
  const totalClaims = flatClaims.length;

  // Group strong claims by source for compact display
  const strongBySource = {};
  for (const claim of strong) {
    const key = claim.sourceLabel;
    if (!strongBySource[key]) strongBySource[key] = [];
    strongBySource[key].push(claim);
  }

  return (
    <div className="claim-cards">
      {/* Summary bar */}
      <div className="claim-summary-bar">
        <div className="claim-summary-title">
          <span className="claim-summary-icon">🔬</span>
          <span>Claim-Level Evaluation</span>
        </div>
        <div className="claim-summary-stats">
          {contested.length > 0 && (
            <span className="claim-stat contested">
              <span className="claim-stat-num">{contested.length}</span> contested
            </span>
          )}
          <span className="claim-stat strong">
            <span className="claim-stat-num">{strong.length}</span> strong
          </span>
          <span className="claim-stat total">{totalClaims} total</span>
        </div>
      </div>

      {/* Contested claims - always shown prominently */}
      {contested.length > 0 && (
        <div className="claim-contested-section">
          <div className="claim-section-label contested-label">
            <span className="pulse-dot"></span>
            Contested Claims
          </div>
          {contested.map((claim) => (
            <ClaimCardDetailed key={claim.id} claim={claim} prominent />
          ))}
        </div>
      )}

      {contested.length === 0 && (
        <div className="claim-all-strong-banner">
          <span className="check-icon">✓</span>
          All {totalClaims} claims reached <strong>STRONG</strong> consensus across evaluators.
        </div>
      )}

      {/* Unknown verdict claims */}
      {unknown.length > 0 && unknown.map((claim) => (
        <ClaimCardDetailed key={claim.id} claim={claim} />
      ))}

      {/* Strong claims - collapsed by default */}
      {strong.length > 0 && (
        <div className="claim-strong-section">
          <button
            className="claim-section-toggle"
            onClick={() => setShowAllStrong(!showAllStrong)}
          >
            <span className="toggle-icon">{showAllStrong ? '▾' : '▸'}</span>
            <span className="claim-section-label">
              {strong.length} Strong Claims
            </span>
            <span className="claim-section-hint">
              {showAllStrong ? 'click to collapse' : 'click to expand'}
            </span>
          </button>

          {showAllStrong && (
            <div className="claim-strong-list">
              {Object.entries(strongBySource).map(([label, groupClaims]) => (
                <div key={label} className="claim-source-group">
                  <div className="claim-source-header">
                    <span className="claim-source-label">{label}</span>
                    <span className="claim-source-model">
                      {labelToModel?.[label] ? getShortModelName(labelToModel[label]) : ''}
                    </span>
                    <span className="claim-source-count">{groupClaims.length} claims</span>
                  </div>
                  {groupClaims.map((claim) => (
                    <ClaimCardCompact key={claim.id} claim={claim} />
                  ))}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * Claim Journey Map: swimlane visualization tracking each claim across rounds.
 * Replaces the old ClaimEvolution aggregate bars with individual claim trajectories.
 */
export function ClaimJourneyMap({ rounds }) {
  const [expandedClaim, setExpandedClaim] = useState(null);
  const [filter, setFilter] = useState('all');

  if (!rounds || rounds.length < 2) return null;

  // Build per-round metadata (claim-mode rounds only)
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

  if (roundData.length < 1) return null;

  // Collect all unique claim IDs across all rounds, preserving first-seen order
  const claimMap = new Map(); // claimId -> { id, claim, sourceLabel, sourceModel }
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

  // Build per-claim trajectory: verdict at each round + evaluator details
  const claimTrajectories = [];
  for (const [claimId, claimInfo] of claimMap) {
    const verdicts = []; // one entry per round
    for (const rd of roundData) {
      const vi = rd.verdicts[claimId];
      // Collect per-evaluator verdicts from stage2 results
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

    // Determine outcome
    const firstVerdict = verdicts[0]?.majority;
    const lastVerdict = verdicts[verdicts.length - 1]?.majority;
    const allStrong = verdicts.every(v => v.majority === 'strong');
    const endedStrong = lastVerdict === 'strong';
    let outcome;
    if (allStrong) outcome = 'stable';
    else if (endedStrong) outcome = 'resolved';
    else outcome = 'persistent';

    // Did verdicts change across rounds?
    const changed = !verdicts.every(v => v.majority === firstVerdict);

    claimTrajectories.push({ ...claimInfo, verdicts, outcome, changed });
  }

  // Apply filter
  const filtered = claimTrajectories.filter(ct => {
    if (filter === 'changed') return ct.changed;
    if (filter === 'contested') return ct.outcome === 'persistent';
    return true;
  });

  const verdictAbbrev = (v) => {
    if (v === 'strong') return 'STR';
    if (v === 'weak') return 'WK';
    if (v === 'flawed') return 'FLW';
    return '—';
  };

  const handleDoubleClick = (claimId) => {
    setExpandedClaim(expandedClaim === claimId ? null : claimId);
  };

  return (
    <div className="journey-map">
      {/* Header */}
      <div className="journey-header">
        <div className="journey-title">
          <div className="journey-title-icon">📊</div>
          <div>
            <div className="journey-title-text">Claim Evolution Across Rounds</div>
            <div className="journey-title-sub">
              Track how each claim&rsquo;s verdict changed through deliberation
            </div>
          </div>
        </div>
        <div className="journey-filters">
          {['all', 'changed', 'contested'].map(f => (
            <button
              key={f}
              className={`journey-filter ${filter === f ? 'active' : ''}`}
              onClick={() => setFilter(f)}
            >
              {f.charAt(0).toUpperCase() + f.slice(1)}
            </button>
          ))}
        </div>
      </div>

      {/* Column headers */}
      <div
        className="journey-round-headers"
        style={{ gridTemplateColumns: `220px repeat(${roundData.length}, 1fr) 110px` }}
      >
        <span className="journey-col-label">Claim</span>
        {roundData.map(rd => (
          <span key={rd.round} className="journey-col-label">Round {rd.round}</span>
        ))}
        <span className="journey-col-label">Outcome</span>
      </div>

      {/* Claim lanes */}
      <div className="journey-lanes">
        {filtered.map(ct => (
          <div key={ct.id}>
            {/* Lane row */}
            <div
              className={`journey-lane ${ct.outcome === 'persistent' ? 'persistent-bg' : ''} ${expandedClaim === ct.id ? 'expanded' : ''}`}
              style={{ gridTemplateColumns: `220px repeat(${roundData.length}, 1fr) 110px` }}
              onDoubleClick={() => handleDoubleClick(ct.id)}
            >
              <div className="lane-claim">
                <span className="lane-claim-id">{ct.id}</span>
                <span className="lane-claim-text">&ldquo;{ct.claim}&rdquo;</span>
                <span className="lane-claim-source">{getShortModelName(ct.sourceModel)}</span>
              </div>
              {ct.verdicts.map((v, i) => (
                <div key={i} className="lane-round-cell">
                  <div
                    className={`verdict-node ${v.majority || 'empty'}`}
                    title={v.majority ? `${v.majority} (${Math.round((v.agreement || 0) * 100)}% agreement)` : 'No verdict'}
                  >
                    {verdictAbbrev(v.majority)}
                  </div>
                </div>
              ))}
              <div className="lane-outcome">
                {ct.outcome === 'resolved' && <span className="outcome-trend">✨</span>}
                <span className={`outcome-badge ${ct.outcome}`}>
                  {ct.outcome.charAt(0).toUpperCase() + ct.outcome.slice(1)}
                </span>
              </div>
            </div>

            {/* Expanded detail (full claim text + per-evaluator verdicts) */}
            {expandedClaim === ct.id && (
              <div className="lane-detail visible">
                <div className="lane-detail-claim-full">
                  <div className="lane-detail-claim-full-header">
                    <span className="lane-detail-claim-full-id">Claim {ct.id}</span>
                    <span className="lane-detail-claim-full-source">
                      Source: {getShortModelName(ct.sourceModel)}
                    </span>
                  </div>
                  <div className="lane-detail-claim-full-text">
                    &ldquo;{ct.claim}&rdquo;
                  </div>
                </div>
                <div className="lane-detail-grid">
                  {ct.verdicts.map((v, i) => (
                    <div key={i} className="lane-detail-round">
                      <div className="detail-round-label">
                        Round {v.round}
                        <span className={`detail-verdict ${v.majority || 'unknown'}`}>
                          {(v.majority || 'N/A').toUpperCase()}
                        </span>
                      </div>
                      {v.evaluators.length > 0 ? (
                        <div className="detail-evaluators">
                          {v.evaluators.map((ev, j) => (
                            <div key={j} className="detail-evaluator">
                              <span className="detail-ev-model">
                                {getShortModelName(ev.model)}
                              </span>
                              <span className={`detail-ev-verdict ${ev.verdict}`}>
                                {ev.verdict}
                              </span>
                              {ev.reason && (
                                <span className="detail-ev-reason">{ev.reason}</span>
                              )}
                            </div>
                          ))}
                        </div>
                      ) : (
                        <div className="detail-evaluators">
                          <span className="detail-ev-reason">No evaluator data available</span>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        ))}

        {filtered.length === 0 && (
          <div className="journey-empty">
            No claims match the selected filter.
          </div>
        )}
      </div>
    </div>
  );
}

// Keep backward-compatible export name
export { ClaimJourneyMap as ClaimEvolution };

function ClaimCardDetailed({ claim, prominent }) {
  const [expanded, setExpanded] = useState(prominent);
  const verdictClass = claim.majority_verdict || 'unknown';
  const agreementPct = Math.round((claim.agreement || 0) * 100);

  return (
    <div className={`claim-card-detailed ${verdictClass} ${prominent ? 'prominent' : ''}`} onClick={() => setExpanded(!expanded)}>
      <div className="claim-header">
        <span className="claim-id">{claim.id}</span>
        <span className={`claim-verdict-badge ${verdictClass}`}>
          {(claim.majority_verdict || 'N/A').toUpperCase()}
        </span>
        {claim.agreement != null && (
          <span className="claim-agreement">{agreementPct}%</span>
        )}
        <span className="claim-source-tag">{getShortModelName(claim.sourceModel)}</span>
      </div>
      <p className="claim-text">&ldquo;{claim.claim}&rdquo;</p>
      {expanded && claim.evaluator_verdicts && claim.evaluator_verdicts.length > 0 && (
        <div className="claim-evaluators">
          {claim.evaluator_verdicts.map((ev, i) => (
            <div key={i} className="evaluator-verdict">
              <span className="ev-model">{getShortModelName(ev.model)}</span>
              <span className={`ev-verdict ${ev.verdict}`}>{ev.verdict}</span>
              {ev.reason && <span className="ev-reason">{ev.reason}</span>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function ClaimCardCompact({ claim }) {
  const agreementPct = Math.round((claim.agreement || 0) * 100);
  return (
    <div className="claim-card-compact">
      <span className="claim-id">{claim.id}</span>
      <span className="claim-compact-text">{claim.claim}</span>
      <span className="claim-compact-pct">{agreementPct}%</span>
    </div>
  );
}
