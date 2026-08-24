import React, { useRef, useEffect } from 'react';
import { ChessPiece } from './ChessPieces';

/**
 * Sidebar Component
 * Control panel containing telemetry readouts, bot configuration, move history logs, and terminal text feeds.
 */
export default function Sidebar({
  opponentType,
  setOpponentType,
  movesHistory,
  capturedPieces,
  telemetry,
  botLogs,
  isThinking,
  onNewGame,
  onUndo,
  onFlipBoard,
  onResign,
  turn,
  gameMode,
  setGameMode,
  onPlayYouClick
}) {
  const moveHistoryContainerRef = useRef(null);
  const botTerminalLogsRef = useRef(null);

  // Auto scroll terminal logs and move history without shifting the page
  useEffect(() => {
    if (botTerminalLogsRef.current) {
      botTerminalLogsRef.current.scrollTop = botTerminalLogsRef.current.scrollHeight;
    }
  }, [botLogs]);

  useEffect(() => {
    if (moveHistoryContainerRef.current) {
      moveHistoryContainerRef.current.scrollTop = moveHistoryContainerRef.current.scrollHeight;
    }
  }, [movesHistory]);

  // Group moves into pairs (1. e4 e5) for clean list display
  const renderMovePairs = () => {
    const pairs = [];
    for (let i = 0; i < movesHistory.length; i += 2) {
      pairs.push({
        num: Math.floor(i / 2) + 1,
        white: movesHistory[i],
        black: movesHistory[i + 1] || null
      });
    }

    if (pairs.length === 0) {
      return (
        <div className="empty-moves-terminal">
          <span className="blink-cursor">// WAITING FOR FIRST SEQUENCE...</span>
        </div>
      );
    }

    return (
      <div className="move-pairs-list">
        {pairs.map((pair) => (
          <div key={pair.num} className="move-row">
            <span className="move-number">{pair.num}.</span>
            <span className="move-san white-move">{pair.white.san}</span>
            <span className="move-san black-move">
              {pair.black ? pair.black.san : <span className="move-pending-cursor"></span>}
            </span>
          </div>
        ))}
      </div>
    );
  };

  // Render captured pieces helper
  const renderCaptured = (color) => {
    const list = capturedPieces[color];
    const items = [];
    
    // Ordered by values standard
    const pieceTypes = ['p', 'n', 'b', 'r', 'q'];
    
    pieceTypes.forEach(type => {
      const count = list[type] || 0;
      for (let i = 0; i < count; i++) {
        items.push(
          <div key={`${color}-${type}-${i}`} className="captured-piece-mini">
            <ChessPiece type={type} color={color === 'w' ? 'b' : 'w'} />
          </div>
        );
      }
    });

    if (items.length === 0) {
      return <span className="no-captured-telemetry">ZERO_LOSS</span>;
    }

    return <div className="captured-pieces-row">{items}</div>;
  };

  // Format CPU speed (Nodes Per Second)
  const calculateNps = () => {
    if (!telemetry || !telemetry.nodes || !telemetry.timeMs) return '0';
    const nps = (telemetry.nodes / (telemetry.timeMs / 1000));
    if (nps > 1000000) return `${(nps / 1000000).toFixed(2)}M N/S`;
    if (nps > 1000) return `${(nps / 1000).toFixed(1)}K N/S`;
    return `${Math.round(nps)} N/S`;
  };

  const getThemeLabel = () => {
    switch (opponentType) {
      case 'random': return 'Random Moves Engine';
      case 'core': return 'Minimax Decision Tree';
      case 'shadow': return 'Aggressive Mimic Engine';
      case 'clone': return 'Cloned Style Imitator';
      default: return 'Active Core Engine';
    }
  };

  if (!gameMode) {
    return (
      <aside className="sidebar-panel play-lobby-panel">
        <div className="lobby-header">
          <span className="lobby-header-icon">🖐️</span>
          <h2>Play Chess</h2>
        </div>
        
        <div className="lobby-menu-list">
          <div className="lobby-menu-item active-menu-item" onClick={onPlayYouClick}>
            <span className="lobby-item-icon yellow-bolt">⚡</span>
            <div className="lobby-item-details">
              <span className="lobby-item-title">Play Clone</span>
              <span className="lobby-item-desc">Play vs a clone of your own style</span>
            </div>
            <span className="lobby-item-badge">PLAY</span>
          </div>

          <div className="lobby-menu-item active-menu-item" onClick={() => setGameMode('bots')}>
            <span className="lobby-item-icon green-computer">💻</span>
            <div className="lobby-item-details">
              <span className="lobby-item-title">Play Bots</span>
              <span className="lobby-item-desc">Challenge a bot from Easy to Master</span>
            </div>
            <span className="lobby-item-badge">PLAY</span>
          </div>

          <div className="lobby-menu-item disabled-menu-item" title="Feature coming soon!">
            <span className="lobby-item-icon brown-handshake">🤝</span>
            <div className="lobby-item-details">
              <span className="lobby-item-title">Play a Friend</span>
              <span className="lobby-item-desc">Invite a friend to a game of chess</span>
            </div>
          </div>

          <div className="lobby-menu-item disabled-menu-item" title="Feature coming soon!">
            <span className="lobby-item-icon gold-medal">🏅</span>
            <div className="lobby-item-details">
              <span className="lobby-item-title">Tournaments</span>
              <span className="lobby-item-desc">Join an Arena where anyone can win</span>
            </div>
          </div>

          <div className="lobby-menu-item disabled-menu-item" title="Feature coming soon!">
            <span className="lobby-item-icon green-die">🎲</span>
            <div className="lobby-item-details">
              <span className="lobby-item-title">Chess Variants</span>
              <span className="lobby-item-desc">Find fun new ways to play chess</span>
            </div>
          </div>
        </div>
      </aside>
    );
  }

  return (
    <aside className="sidebar-panel">
      {/* 1. Header & Telemetry Grid */}
      <div className="sidebar-section panel-header">
        <div className="header-top-row">
          <button className="lobby-back-btn" onClick={() => setGameMode(null)} title="Back to Lobby">
            ← Lobby
          </button>
          <div className="indicator-row">
            <div className="pulse-dot active"></div>
            <span className="terminal-title">Engine Telemetry</span>
          </div>
        </div>
        <span className="sub-module-label">{getThemeLabel()}</span>
      </div>

      {/* 2. Opponent Module Choice */}
      <div className="sidebar-section opponent-selector">
        <label className="sidebar-label">Opponent Profile</label>
        <div className="custom-select-wrapper">
          <select
            value={opponentType}
            onChange={(e) => setOpponentType(e.target.value)}
            className="industrial-select"
            disabled={isThinking}
          >
            <option value="random">Random Bot (Casual)</option>
            <option value="core">Core AI Engine (Intermediate)</option>
            <option value="shadow">Shadow Clone (Aggressive)</option>
          </select>
        </div>
      </div>

      {/* 3. Engine Metrics */}
      <div className="sidebar-section metrics-grid">
        <div className="metric-box">
          <span className="metric-title">Calc Time</span>
          <span className="metric-value">{telemetry.timeMs ? `${telemetry.timeMs.toFixed(0)}ms` : '0ms'}</span>
        </div>
        <div className="metric-box">
          <span className="metric-title">Depth</span>
          <span className="metric-value">{telemetry.depth ? `${telemetry.depth} PLY` : '0 PLY'}</span>
        </div>
        <div className="metric-box">
          <span className="metric-title">Nodes</span>
          <span className="metric-value">{telemetry.nodes || 0}</span>
        </div>
        <div className="metric-box">
          <span className="metric-title">Speed</span>
          <span className="metric-value">{calculateNps()}</span>
        </div>
      </div>

      {/* 4. Move Log History Component */}
      <div className="sidebar-section move-history-section">
        <div className="panel-sub-header">
          <span className="sub-title">Move History</span>
          <span className="telemetry-tag">PGN</span>
        </div>
        <div className="move-history-terminal" ref={moveHistoryContainerRef}>
          {renderMovePairs()}
        </div>
      </div>

      {/* 5. Captured Assets Section */}
      <div className="sidebar-section captured-section">
        <div className="panel-sub-header">
          <span className="sub-title">Captured Pieces</span>
        </div>
        <div className="captured-assets-box">
          <div className="captured-row-container">
            <span className="captured-side-label">White Losses:</span>
            {renderCaptured('b')} {/* Black captured White pieces */}
          </div>
          <div className="captured-row-container">
            <span className="captured-side-label">Black Losses:</span>
            {renderCaptured('w')} {/* White captured Black pieces */}
          </div>
        </div>
      </div>

      {/* 6. Bot Chat Console Output */}
      <div className="sidebar-section bot-terminal-section">
        <div className="panel-sub-header">
          <span className="sub-title">Engine Stream</span>
          {isThinking && (
            <div className="thinking-loader">
              <span className="thinking-bar"></span>
            </div>
          )}
        </div>
        <div className="bot-terminal-logs" ref={botTerminalLogsRef}>
          {botLogs.map((log, idx) => (
            <div key={idx} className="terminal-log-line">
              <span className="terminal-prompt">&gt;</span>
              <span className="terminal-text">{log}</span>
            </div>
          ))}
          {isThinking && (
            <div className="terminal-log-line thinking-text">
              <span className="terminal-prompt">&gt;</span>
              <span className="terminal-text blink">Calculating best move...</span>
            </div>
          )}
        </div>
      </div>

      {/* 7. Action Commands Layout */}
      <div className="sidebar-section commands-grid">
        <button className="command-btn primary-action" onClick={onNewGame} disabled={isThinking}>
          New Game
        </button>
        <button className="command-btn" onClick={onUndo} disabled={isThinking || movesHistory.length === 0 || gameMode === 'clone'}>
          Undo Move
        </button>
        <button className="command-btn" onClick={onFlipBoard}>
          Flip Board
        </button>
        <button className="command-btn danger-action" onClick={onResign} disabled={isThinking || movesHistory.length === 0}>
          Resign
        </button>
      </div>
    </aside>
  );
}
