import React from 'react';

/**
 * EvaluationBar Component
 * Renders a highly polished vertical mechanical gauge reflecting the engine's assessment.
 */
export default function EvaluationBar({ score, turn, isFlipped }) {
  // Score comes in units of centipawns (e.g., 1.50, -0.45)
  // Clamp evaluation between -10.0 and +10.0 for UI representation
  const maxScore = 10;
  
  // Format the visual percentage
  // 50% means 0.0 (even). 100% means White winning (+10), 0% means Black winning (-10)
  let percentage = 50;
  
  if (score !== undefined && !isNaN(score)) {
    // Clamp score
    const clampedScore = Math.max(-maxScore, Math.min(maxScore, score));
    // Calculate percentage: maps [-10, 10] to [0%, 100%]
    percentage = ((clampedScore + maxScore) / (maxScore * 2)) * 100;
  }

  // Determine label text
  let labelText = '0.00';
  if (score !== undefined) {
    if (Math.abs(score) > 90) {
      // Mate score
      const winner = score > 0 ? 'W' : 'B';
      labelText = `M`; // Mate imminent
    } else {
      const sign = score > 0 ? '+' : '';
      labelText = `${sign}${score.toFixed(2)}`;
    }
  }

  // Draw ticks on the bar
  const ticks = [-8, -6, -4, -2, 0, 2, 4, 6, 8];

  return (
    <div className="eval-bar-wrapper">
      {/* Visual Telemetry Header */}
      <div className="eval-header">
        <span className="eval-title">EVAL</span>
        <div className="eval-readout">{labelText}</div>
      </div>

      <div className="eval-gauge-container">
        {/* Metric Ticks */}
        <div className="eval-ticks">
          {ticks.map((tick) => {
            const tickPosition = ((tick + maxScore) / (maxScore * 2)) * 100;
            return (
              <div
                key={tick}
                className={`eval-tick ${tick === 0 ? 'center' : ''}`}
                style={{ bottom: `${tickPosition}%` }}
              >
                <span className="tick-mark"></span>
                {tick !== 0 && <span className="tick-label">{Math.abs(tick)}</span>}
              </div>
            );
          })}
        </div>

        {/* The Bar Track */}
        <div className="eval-track">
          {/* Black evaluation block (filling from top down to the percentage) */}
          <div className="eval-black-fill" style={{ height: `${100 - percentage}%` }}></div>
          
          {/* White evaluation block (filling from bottom up to percentage) */}
          <div className="eval-white-fill" style={{ height: `${percentage}%` }}></div>
          
          {/* Horizontal Balance Needle */}
          <div className="eval-needle" style={{ bottom: `${percentage}%` }}>
            <div className="needle-pointer"></div>
          </div>
        </div>
      </div>
      
      {/* Technical Status Ring */}
      <div className="eval-footer">
        <div className="telemetry-led"></div>
        <span className="telemetry-label">{score > 0 ? 'WHITE ADV' : score < 0 ? 'BLACK ADV' : 'STABLE'}</span>
      </div>
    </div>
  );
}
