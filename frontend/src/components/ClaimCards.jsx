import { useState } from 'react';
import { getShortModelName } from '../utils/modelHelpers';
import './ClaimCards.css';

export default function ClaimCards({ claims, labelToModel }) {
  if (!claims || Object.keys(claims).length === 0) return null;

  // Build a flat list of claims with their verdicts
  const flatClaims = [];
  for (const [label, claimList] of Object.entries(claims)) {
    for (const claim of claimList) {
      flatClaims.push({
        ...claim,
        sourceLabel: label,
        sourceModel: labelToModel?.[label] || label,
      });
    }
  }

  if (flatClaims.length === 0) return null;

  return (
    <div className="claim-cards">
      <h4>Canonical Claims</h4>
      <p className="claim-cards-description">
        Claims extracted from each response and evaluated by all peers.
      </p>
      <div className="claim-cards-grid">
        {flatClaims.map((claim) => (
          <ClaimCard key={claim.id} claim={claim} />
        ))}
      </div>
    </div>
  );
}

export function ClaimCardWithVerdicts({ claims, aggregatedVerdicts, labelToModel, stage2Results }) {
  if (!claims || Object.keys(claims).length === 0) return null;

  const flatClaims = [];
  for (const [label, claimList] of Object.entries(claims)) {
    for (const claim of claimList) {
      const verdictInfo = aggregatedVerdicts?.[claim.id] || {};
      // Collect per-evaluator verdicts
      const evaluatorVerdicts = [];
      if (stage2Results) {
        for (const result of stage2Results) {
          const cv = result.claim_verdicts?.[claim.id];
          if (cv) {
            evaluatorVerdicts.push({
              model: result.model,
              verdict: cv.verdict,
              reason: cv.reason,
            });
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

  // Group by source label
  const grouped = {};
  for (const claim of flatClaims) {
    const key = claim.sourceLabel;
    if (!grouped[key]) grouped[key] = [];
    grouped[key].push(claim);
  }

  return (
    <div className="claim-cards">
      <h4>Claim-Level Evaluation</h4>
      <p className="claim-cards-description">
        Each response was decomposed into claims and evaluated by all peers.
      </p>
      {Object.entries(grouped).map(([label, groupClaims]) => (
        <div key={label} className="claim-group">
          <div className="claim-group-header">
            <span className="claim-group-label">{label}</span>
            <span className="claim-group-model">
              {labelToModel?.[label] ? getShortModelName(labelToModel[label]) : ''}
            </span>
          </div>
          <div className="claim-cards-grid">
            {groupClaims.map((claim) => (
              <ClaimCardDetailed key={claim.id} claim={claim} />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function ClaimCard({ claim }) {
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

function ClaimCardDetailed({ claim }) {
  const [expanded, setExpanded] = useState(false);
  const verdictClass = claim.majority_verdict || 'unknown';
  const agreementPct = Math.round((claim.agreement || 0) * 100);

  return (
    <div className={`claim-card ${verdictClass}`} onClick={() => setExpanded(!expanded)}>
      <div className="claim-header">
        <span className="claim-id">{claim.id}</span>
        <span className={`claim-verdict ${verdictClass}`}>
          {(claim.majority_verdict || 'N/A').toUpperCase()}
        </span>
        {claim.agreement != null && (
          <span className="claim-agreement">{agreementPct}%</span>
        )}
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
