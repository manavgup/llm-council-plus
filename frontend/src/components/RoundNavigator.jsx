import React from 'react';
import './RoundNavigator.css';

export default function RoundNavigator({ currentRound, totalRounds, converged, convergenceRound }) {
  if (!totalRounds || totalRounds <= 1) return null;

  return (
    <div className="round-navigator">
      <div className="round-dots">
        {Array.from({ length: totalRounds }, (_, i) => {
          const roundNum = i + 1;
          const isCompleted = roundNum < currentRound;
          const isActive = roundNum === currentRound;
          return (
            <div
              key={roundNum}
              className={`round-dot ${isCompleted ? 'completed' : ''} ${isActive ? 'active' : ''}`}
              title={`Round ${roundNum}`}
            />
          );
        })}
      </div>
      <span className="round-label">
        Round {currentRound} of {totalRounds}
        {converged && ` \u2014 Converged`}
      </span>
    </div>
  );
}
