import './ConvergenceDashboard.css';

/**
 * Convergence Dashboard: radial ring + stat rows summarizing deliberation outcome.
 * Shows consensus percentage, strong/contested claim counts, and rounds completed.
 */
export default function ConvergenceDashboard({ rounds, totalRounds, converged }) {
  if (!rounds || rounds.length < 2) return null;

  // Use the last completed round's claim verdicts
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

  // SVG ring math
  const radius = 50;
  const circumference = 2 * Math.PI * radius;
  const dashoffset = circumference * (1 - pct / 100);

  return (
    <div className="convergence-dashboard">
      {/* Ring */}
      <div className="convergence-ring-container">
        <div className="convergence-ring">
          <svg viewBox="0 0 120 120">
            <circle className="ring-track" cx="60" cy="60" r={radius} />
            <circle
              className="ring-progress"
              cx="60"
              cy="60"
              r={radius}
              stroke="url(#convRingGrad)"
              strokeDasharray={circumference}
              strokeDashoffset={dashoffset}
            />
            <defs>
              <linearGradient id="convRingGrad" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stopColor="#22c55e" />
                <stop offset="100%" stopColor="#6ee7b7" />
              </linearGradient>
            </defs>
          </svg>
          <div className="ring-center-label">
            <div className="ring-pct">{pct}%</div>
            <div className="ring-pct-label">Consensus</div>
          </div>
        </div>
      </div>

      {/* Stats */}
      <div className="convergence-stats">
        <div className="convergence-stat-row">
          <div className="conv-stat-icon strong-bg">&#x2714;</div>
          <div className="conv-stat-detail">
            <div className="conv-stat-value">{strong} / {total}</div>
            <div className="conv-stat-label">Claims reached strong consensus</div>
            <div className="conv-mini-bar">
              <div
                className="conv-mini-bar-fill"
                style={{ width: `${pct}%`, background: 'var(--verdict-strong)' }}
              />
            </div>
          </div>
        </div>

        <div className="convergence-stat-row">
          <div className="conv-stat-icon contested-bg">&#x26A0;</div>
          <div className="conv-stat-detail">
            <div className="conv-stat-value">{contested}</div>
            <div className="conv-stat-label">
              Claims still contested after {roundsCompleted} round{roundsCompleted !== 1 ? 's' : ''}
            </div>
            <div className="conv-mini-bar">
              <div
                className="conv-mini-bar-fill"
                style={{ width: `${total > 0 ? Math.round((contested / total) * 100) : 0}%`, background: 'var(--verdict-flawed)' }}
              />
            </div>
          </div>
        </div>

        <div className="convergence-stat-row">
          <div className="conv-stat-icon rounds-bg">&#x27F3;</div>
          <div className="conv-stat-detail">
            <div className="conv-stat-value">{roundsCompleted} round{roundsCompleted !== 1 ? 's' : ''}</div>
            <div className="conv-stat-label">
              {converged
                ? `Converged at round ${roundsCompleted}`
                : `Completed (max configured: ${maxRounds})`
              }
            </div>
            <div className="conv-mini-bar">
              <div
                className="conv-mini-bar-fill"
                style={{ width: `${roundsPct}%`, background: 'var(--accent-primary)' }}
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
