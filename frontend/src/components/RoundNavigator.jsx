import { useState } from 'react';
import './RoundNavigator.css';

/**
 * Deliberation Progress Rail: vertical timeline replacing the old dot navigator.
 * Shows rich round cards with verdict vitals, delta chips, and convergence status.
 */
export default function DeliberationRail({
  currentRound,
  totalRounds,
  converged,
  convergenceRound,
  rounds,
}) {
  if (!totalRounds || totalRounds <= 1) return null;

  // Build per-round stats from completed rounds
  const roundStats = (rounds || []).map((rd, i) => {
    const meta = rd.metadata || {};
    const verdicts = meta.aggregate_claim_verdicts || {};
    const mode = meta.critique_mode || rd.critique_mode;
    const isClaim = mode === 'claim';

    const allVerdicts = Object.values(verdicts);
    const strong = allVerdicts.filter(v => v.majority_verdict === 'strong').length;
    const weak = allVerdicts.filter(v => v.majority_verdict === 'weak').length;
    const flawed = allVerdicts.filter(v => v.majority_verdict === 'flawed').length;
    const total = strong + weak + flawed;

    // Compute deltas from previous round
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

    return {
      round: rd.round_number,
      isClaim,
      strong, weak, flawed, total,
      deltas,
    };
  });

  // Label for each round
  const roundLabel = (num) => {
    if (num === 1) return 'Initial Assessment';
    if (num === totalRounds && converged) return 'Final Convergence';
    return 'Peer Revision';
  };

  // Compute consensus percentage from the last completed round
  const lastStats = roundStats[roundStats.length - 1];
  const consensusPct = lastStats && lastStats.total > 0
    ? Math.round((lastStats.strong / lastStats.total) * 100)
    : null;

  return (
    <div className="deliberation-rail">
      {/* Render completed rounds */}
      {roundStats.map((rs, i) => {
        const isLast = i === roundStats.length - 1;
        const showConvergence = isLast && converged;

        return (
          <div key={rs.round} className="rail-round">
            <div className="rail-node completed">R{rs.round}</div>
            <div className={`rail-card ${showConvergence ? 'active-round' : ''}`}>
              <div className="rail-card-top">
                <div className="rail-round-info">
                  <span className="rail-round-title">
                    Round {rs.round} &mdash; {roundLabel(rs.round)}
                  </span>
                </div>
                {rs.isClaim && rs.total > 0 && (
                  <div className="rail-vitals">
                    <div className="vital">
                      <span className="vital-dot strong"></span>
                      <span className="vital-num">{rs.strong}</span>
                      <span className="vital-label">strong</span>
                    </div>
                    {rs.weak > 0 && (
                      <div className="vital">
                        <span className="vital-dot weak"></span>
                        <span className="vital-num">{rs.weak}</span>
                        <span className="vital-label">weak</span>
                      </div>
                    )}
                    {rs.flawed > 0 && (
                      <div className="vital">
                        <span className="vital-dot flawed"></span>
                        <span className="vital-num">{rs.flawed}</span>
                        <span className="vital-label">flawed</span>
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Delta chips */}
              {rs.deltas && (
                <div className="rail-delta">
                  {rs.deltas.resolved > 0 && (
                    <span className="delta-chip resolved">
                      <span className="delta-arrow">&uarr;</span>
                      {rs.deltas.resolved} claim{rs.deltas.resolved !== 1 ? 's' : ''} resolved
                    </span>
                  )}
                  {rs.deltas.upgraded > 0 && (
                    <span className="delta-chip upgraded">
                      <span className="delta-arrow">&#x2197;</span>
                      {rs.deltas.upgraded} flawed&rarr;weak
                    </span>
                  )}
                  {rs.deltas.newContested > 0 && (
                    <span className="delta-chip new-contested">
                      <span className="delta-arrow">&darr;</span>
                      {rs.deltas.newContested} regressed
                    </span>
                  )}
                </div>
              )}

              {/* Convergence indicator */}
              {showConvergence && (
                <div className="rail-convergence">
                  <span className="convergence-check">&#x2714;</span>
                  Council converged{consensusPct != null ? ` \u2014 ${consensusPct}% consensus reached` : ''}
                </div>
              )}
            </div>
          </div>
        );
      })}

      {/* Pending rounds (not yet completed) */}
      {Array.from({ length: Math.max(0, totalRounds - roundStats.length) }, (_, i) => {
        const roundNum = roundStats.length + i + 1;
        const isActive = roundNum === currentRound;
        return (
          <div key={roundNum} className="rail-round">
            <div className={`rail-node ${isActive ? 'active' : 'pending'}`}>R{roundNum}</div>
            <div className="rail-card">
              <div className="rail-card-top">
                <div className="rail-round-info">
                  <span className="rail-round-title">
                    Round {roundNum} &mdash; {isActive ? 'In Progress' : 'Pending'}
                  </span>
                </div>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
