import React from 'react';

/**
 * GameStatusModal Component
 * Shows a premium retro-industrial diagnostic screen when the game terminates.
 */
export default function GameStatusModal({
  status, // 'checkmate', 'stalemate', 'draw', 'resign', 'timeout', null
  winner, // 'w', 'b', null
  opponentType,
  playerColor = 'w',
  onRestart,
  pgn
}) {
  if (!status) return null;

  // Determine industrial-flavored text
  let headerText = 'SIMULATION CONCLUDED';
  let messageText = 'The game has ended under normal parameters.';
  let themeClass = 'info'; // 'victory', 'defeat', 'draw'

  const playerWon = winner === playerColor;
  const opponentWon = winner && winner !== playerColor;

  if (status === 'checkmate') {
    if (playerWon) {
      headerText = 'TARGET DEFEATED';
      messageText = `Success. Hostile ${getOpponentName(opponentType)} database terminated via Checkmate.`;
      themeClass = 'victory';
    } else if (opponentWon) {
      headerText = 'CORE SYSTEM BREACH';
      messageText = `Failure. Your King structure was dismantled by ${getOpponentName(opponentType)}.`;
      themeClass = 'defeat';
    }
  } else if (status === 'resign') {
    if (winner === playerColor) {
      headerText = 'OPPONENT DEACTIVATED';
      messageText = `Hostile engine aborted search and resigned.`;
      themeClass = 'victory';
    } else {
      headerText = 'SESSION ABORTED';
      messageText = `User terminated connection and surrendered.`;
      themeClass = 'defeat';
    }
  } else if (['draw', 'stalemate', 'threefold', 'insufficient', '50move'].includes(status)) {
    headerText = 'MUTUAL DE-ESCALATION';
    themeClass = 'draw';
    
    if (status === 'stalemate') {
      messageText = 'Stalemate detected. Active grid has no legal trajectories remaining.';
    } else if (status === 'threefold') {
      messageText = 'Draw by Threefold Repetition. Board state loop detected.';
    } else if (status === 'insufficient') {
      messageText = 'Draw by Insufficient Material. Inadequate forces to achieve resolution.';
    } else {
      messageText = 'Draw by Mutual Agreement or 50-move Rule limit.';
    }
  }

  function getOpponentName(type) {
    switch (type) {
      case 'random': return 'Random Bot';
      case 'core': return 'Core AI Engine';
      case 'shadow': return 'Shadow Clone';
      case 'clone': return 'Mirror Clone';
      default: return 'Automaton';
    }
  }

  // Copy PGN log helper
  const handleCopyPgn = () => {
    navigator.clipboard.writeText(pgn || '');
    // Alert or signal copy complete
    const btn = document.getElementById('modal-copy-btn');
    if (btn) {
      const orig = btn.innerText;
      btn.innerText = 'COPIED TO CLIPBOARD';
      btn.style.borderColor = 'var(--neon-glow)';
      setTimeout(() => {
        btn.innerText = orig;
        btn.style.borderColor = '';
      }, 1500);
    }
  };

  return (
    <div className={`modal-overlay opponent-${opponentType}`}>
      <div className={`industrial-modal ${themeClass}`}>
        {/* Warning Hazard Stripes */}
        <div className="hazard-stripes"></div>

        {/* Modal Content */}
        <div className="modal-inner">
          <div className="modal-header-container">
            <div className="telemetry-bracket top-l"></div>
            <div className="telemetry-bracket top-r"></div>
            
            <span className="status-code">SYS_STATUS // RESOLVED</span>
            <h1 className="modal-title">{headerText}</h1>
          </div>

          <div className="modal-body">
            <p className="modal-desc">{messageText}</p>

            {/* Telemetry log list */}
            <div className="modal-telemetry-box">
              <div className="telemetry-row">
                <span className="tel-label">OPPONENT TYPE:</span>
                <span className="tel-val uppercase">{opponentType} MODULE</span>
              </div>
              <div className="telemetry-row">
                <span className="tel-label">OUTCOME PATH:</span>
                <span className="tel-val uppercase">{status}</span>
              </div>
              <div className="telemetry-row">
                <span className="tel-label">VICTOR ASSIGNMENT:</span>
                <span className="tel-val uppercase">{winner ? (winner === 'w' ? 'WHITE' : 'BLACK') : 'NONE (NEUTRAL)'}</span>
              </div>
            </div>

            <div className="modal-pgn-section">
              <span className="pgn-title">FINAL PGN DATA LOG:</span>
              <textarea className="modal-pgn-textarea" readOnly value={pgn || 'No move record.'}></textarea>
            </div>
          </div>

          <div className="modal-actions">
            <button id="modal-copy-btn" className="modal-btn secondary" onClick={handleCopyPgn}>
              COPY DATA LOG
            </button>
            <button className="modal-btn primary" onClick={onRestart}>
              RE-INITIALIZE CORE
            </button>
          </div>
          
          <div className="telemetry-bracket bottom-l"></div>
          <div className="telemetry-bracket bottom-r"></div>
        </div>

        {/* Warning Hazard Stripes */}
        <div className="hazard-stripes bottom"></div>
      </div>
    </div>
  );
}
