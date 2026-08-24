import React, { useState, useEffect } from 'react';
import { Chess } from 'chess.js';
import Chessboard from './components/Chessboard';
import Sidebar from './components/Sidebar';
import EvaluationBar from './components/EvaluationBar';
import GameStatusModal from './components/GameStatusModal';
import { ChessGradients } from './components/ChessPieces';
import PlayYouModal from './components/PlayYouModal';
import { calculateBestMove, getBotQuote } from './engine/chessEngine';
import './App.css';

// Sound effect synthesis using browser Web Audio API to avoid external assets
const playSound = (type) => {
  try {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) return;
    const ctx = new AudioContext();
    
    if (type === 'check') {
      // Pulsing alert tone
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(440, ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(880, ctx.currentTime + 0.15);
      
      gain.gain.setValueAtTime(0.08, ctx.currentTime);
      gain.gain.linearRampToValueAtTime(0.01, ctx.currentTime + 0.25);
      
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.25);
    } 
    else if (type === 'move') {
      // Sleek tech click beep
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(350, ctx.currentTime);
      osc.frequency.setValueAtTime(440, ctx.currentTime + 0.04);
      
      gain.gain.setValueAtTime(0.04, ctx.currentTime);
      gain.gain.linearRampToValueAtTime(0.01, ctx.currentTime + 0.12);
      
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.12);
    }
    else if (type === 'capture') {
      // Metallic friction clink
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(600, ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(150, ctx.currentTime + 0.18);
      
      gain.gain.setValueAtTime(0.06, ctx.currentTime);
      gain.gain.linearRampToValueAtTime(0.01, ctx.currentTime + 0.18);
      
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.18);
    }
  } catch (e) {
    console.warn("Audio Context init blocked or failed: ", e);
  }
};

export default function App() {
  // Initialize game engine
  const [game, setGame] = useState(() => new Chess());
  

  // Game states syncing chess.js
  const [board, setBoard] = useState(() => game.board());
  const [turn, setTurn] = useState(() => game.turn());
  const [movesHistory, setMovesHistory] = useState([]);
  const [lastMove, setLastMove] = useState(null);
  const [inCheck, setInCheck] = useState(false);
  const [gameStatus, setGameStatus] = useState(null); // 'checkmate', 'stalemate', 'draw', 'resign'
  const [winner, setWinner] = useState(null); // 'w', 'b'

  // Board presentation controls
  const [isFlipped, setIsFlipped] = useState(false);
  const [selectedSquare, setSelectedSquare] = useState(null);
  
  // Game mode screen state
  const [gameMode, setGameMode] = useState(null); // 'bots' or null

  // Telemetry AI states
  const [opponentType, setOpponentType] = useState('core'); // 'random', 'core', 'shadow'
  const [isThinking, setIsThinking] = useState(false);
  const [evaluation, setEvaluation] = useState(0); // in pawn units
  const [telemetry, setTelemetry] = useState({ depth: 0, nodes: 0, timeMs: 0 });
  const [botLogs, setBotLogs] = useState([
    "[SYSTEM] Core Matrix initialized. Awaiting player sequence..."
  ]);

  const [isPlayYouOpen, setIsPlayYouOpen] = useState(false);
  const [cloneUsername, setCloneUsername] = useState('');
  const [cloneBot, setCloneBot] = useState(null); // { displayName, avatarUrl, platform }
  const [playerColor, setPlayerColor] = useState('w');
  const wsRef = React.useRef(null);
  // gameRef always mirrors the live game instance so WS callbacks never capture a stale closure
  const gameRef = React.useRef(game);
  // Keep gameRef in sync with game state so WS message handlers never use a stale Chess instance
  React.useEffect(() => { gameRef.current = game; }, [game]);

  // Compute legal moves for selected square to display highlights
  const getLegalMoves = () => {
    const isBotOrClone = gameMode === 'bots' || gameMode === 'clone';
    const isPlayer = turn === playerColor;
    if (!isBotOrClone || !selectedSquare || !isPlayer || isThinking) return [];
    return game.moves({ square: selectedSquare, verbose: true });
  };

  const legalMoves = getLegalMoves();

  // Calculate captured assets
  const getCapturedPieces = () => {
    const total = {
      w: { p: 8, n: 2, b: 2, r: 2, q: 1 },
      b: { p: 8, n: 2, b: 2, r: 2, q: 1 }
    };
    const current = {
      w: { p: 0, n: 0, b: 0, r: 0, q: 0 },
      b: { p: 0, n: 0, b: 0, r: 0, q: 0 }
    };
    
    board.forEach(row => {
      row.forEach(piece => {
        if (piece && piece.type !== 'k') {
          current[piece.color][piece.type]++;
        }
      });
    });

    const captured = {
      w: {}, // White has captured these Black pieces
      b: {}  // Black has captured these White pieces
    };

    ['p', 'n', 'b', 'r', 'q'].forEach(type => {
      captured.w[type] = Math.max(0, total.b[type] - current.b[type]);
      captured.b[type] = Math.max(0, total.w[type] - current.w[type]);
    });

    return captured;
  };

  const capturedPieces = getCapturedPieces();

  // Check Game State status
  const checkGameStatus = (currentGame) => {
    if (currentGame.isGameOver()) {
      if (currentGame.isCheckmate()) {
        setGameStatus('checkmate');
        setWinner(currentGame.turn() === 'w' ? 'b' : 'w');
        setBotLogs(prev => [...prev, `[SYSTEM] Game concluded. CHECKMATE. winner: ${currentGame.turn() === 'w' ? 'BLACK' : 'WHITE'}`]);
      } else if (currentGame.isStalemate()) {
        setGameStatus('stalemate');
        setBotLogs(prev => [...prev, `[SYSTEM] Game concluded. STALEMATE.`]);
      } else if (currentGame.isThreefoldRepetition()) {
        setGameStatus('threefold');
        setBotLogs(prev => [...prev, `[SYSTEM] Game concluded. DRAW BY REPETITION.`]);
      } else if (currentGame.isInsufficientMaterial()) {
        setGameStatus('insufficient');
        setBotLogs(prev => [...prev, `[SYSTEM] Game concluded. DRAW BY INSUFFICIENT MATERIAL.`]);
      } else {
        setGameStatus('draw');
        setBotLogs(prev => [...prev, `[SYSTEM] Game concluded. DRAW.`]);
      }
    }
  };

  // Perform player's chess move
  const handlePlayerMove = (moveObj) => {
    if ((gameMode !== 'bots' && gameMode !== 'clone') || turn !== playerColor || isThinking || gameStatus) return;

    try {
      // Execute move
      const move = game.move(moveObj);
      if (move) {
        // Sync states
        setBoard(game.board());
        setTurn(game.turn());
        setMovesHistory([...game.history({ verbose: true })]);
        setLastMove({ from: move.from, to: move.to });
        setInCheck(game.inCheck());
        
        // Play click / friction sound
        if (move.captured) {
          playSound('capture');
        } else if (game.inCheck()) {
          playSound('check');
        } else {
          playSound('move');
        }

        // Run board evaluate score immediately
        const score = calculateBestMove(game, 'core').score;
        setEvaluation(score);

        if (gameMode === 'clone') {
          // Send move to FastAPI WebSocket backend
          const uci = move.from + move.to + (move.promotion || '');
          if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
            wsRef.current.send(JSON.stringify({ move: uci }));
            setIsThinking(true); // Disable board interaction until bot replies
          }
        } else {
          // Check if game ended
          checkGameStatus(game);
        }
      }
    } catch (e) {
      console.warn("Invalid command coordinate move attempt", e);
    }
  };

  // Orchestrate AI Opponent Move Thread
  useEffect(() => {
    // AI plays Black color ('b')
    if (gameMode === 'bots' && turn === 'b' && !game.isGameOver() && !gameStatus) {
      setIsThinking(true);

      const thinker = setTimeout(() => {
        const { bestMove, nodes, timeMs, score } = calculateBestMove(game, opponentType);
        
        if (bestMove) {
          const move = game.move(bestMove.san);
          if (move) {
            // Update states
            setBoard(game.board());
            setTurn(game.turn());
            setMovesHistory([...game.history({ verbose: true })]);
            setLastMove({ from: move.from, to: move.to });
            setInCheck(game.inCheck());
            setEvaluation(score);
            
            // Set telemetry
            setTelemetry({
              depth: opponentType === 'random' ? 1 : 3,
              nodes,
              timeMs
            });

            // Write logs
            const quote = getBotQuote(opponentType, move.san, game.inCheck());
            setBotLogs(prev => [...prev, quote]);

            if (move.captured) {
              playSound('capture');
            } else if (game.inCheck()) {
              playSound('check');
            } else {
              playSound('move');
            }
          }
        }
        
        setIsThinking(false);
        checkGameStatus(game);
      }, 0);

      return () => clearTimeout(thinker);
    }
  }, [turn, opponentType, gameStatus, game, gameMode]);

  // Helper for executing bot WebSocket moves — always uses gameRef so the closure is never stale
  const handleBotWebSocketMove = (moveUci, botFen) => {
    const liveGame = gameRef.current;
    const from = moveUci.slice(0, 2);
    const to = moveUci.slice(2, 4);
    const promotion = moveUci[4] || undefined;

    let move = null;
    try {
      move = liveGame.move({ from, to, promotion });
    } catch (err) {
      console.warn("game.move failed, falling back to game.load(botFen):", err);
      if (botFen) {
        liveGame.load(botFen);
      }
    }

    setBoard(liveGame.board());
    setTurn(liveGame.turn());
    setMovesHistory([...liveGame.history({ verbose: true })]);
    setLastMove({ from, to });
    setInCheck(liveGame.inCheck());

    // Play appropriate sound
    if (move && move.captured) {
      playSound('capture');
    } else if (liveGame.inCheck()) {
      playSound('check');
    } else {
      playSound('move');
    }

    // Add to bot logs
    setBotLogs(prev => [...prev, `[CLONE] Move: ${move ? move.san : moveUci}`]);

    // Always re-enable player interaction after bot replies
    setIsThinking(false);
  };

  // Helper for WebSocket game conclusion
  const handleWebSocketGameOver = (result) => {
    let statusVal = 'draw';
    let winnerVal = null;

    if (result === '1-0') {
      statusVal = 'checkmate';
      winnerVal = 'w';
    } else if (result === '0-1') {
      statusVal = 'checkmate';
      winnerVal = 'b';
    } else {
      statusVal = 'draw';
      winnerVal = null;
    }

    setGameStatus(statusVal);
    setWinner(winnerVal);
    setBotLogs(prev => [...prev, `[SYSTEM] Game concluded. Result: ${result}`]);

    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
  };

  // Start clone live match
  const startCloneMatch = ({ username, side, displayName, avatarUrl, platform }) => {
    let chosenColor = side;
    if (chosenColor === 'random') {
      chosenColor = Math.random() < 0.5 ? 'w' : 'b';
    }

    // Reset game — update both state AND the ref immediately so WS callbacks see the fresh board
    const freshGame = new Chess();
    gameRef.current = freshGame;

    setPlayerColor(chosenColor);
    setIsFlipped(chosenColor === 'b');
    setGame(freshGame);
    setBoard(freshGame.board());
    setTurn(freshGame.turn());
    setMovesHistory([]);
    setLastMove(null);
    setInCheck(false);
    setGameStatus(null);
    setWinner(null);
    setEvaluation(0);
    setTelemetry({ depth: 0, nodes: 0, timeMs: 0 });
    setSelectedSquare(null);
    setBotLogs([
      `[SYSTEM] Live match vs clone of ${username} initialized.`
    ]);

    if (wsRef.current) {
      wsRef.current.close();
    }

    const wsUrl = `ws://127.0.0.1:8000/ws/play/${username}`;
    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    // Bot goes first when player is Black
    setIsThinking(chosenColor === 'b');

    ws.onopen = () => {
      const colorVal = chosenColor === 'w' ? 'white' : 'black';
      ws.send(JSON.stringify({ color: colorVal }));
    };

    ws.onmessage = (event) => {
      const data = JSON.parse(event.data);
      if (data.type === 'bot_move') {
        // handleBotWebSocketMove reads gameRef.current — always the live game object
        handleBotWebSocketMove(data.move, data.fen);
      } else if (data.type === 'game_over') {
        handleWebSocketGameOver(data.result);
      } else if (data.type === 'error') {
        console.error('WebSocket error:', data.message);
        setBotLogs(prev => [...prev, `[CLONE ERROR] ${data.message}`]);
        setIsThinking(false);
      }
    };

    ws.onclose = () => {
      console.log('WebSocket closed.');
    };

    ws.onerror = (err) => {
      console.error('WebSocket error event:', err);
    };

    setGameMode('clone');
    setOpponentType('clone');
    setCloneUsername(username);
    setCloneBot({ displayName: displayName || username, avatarUrl: avatarUrl || '', platform: platform || 'chesscom' });
  };

  // Restart / Reset game board
  const handleRestart = () => {
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
    if (gameMode === 'clone') {
      setGameMode(null);
      setOpponentType('core');
    }
    const freshGame = new Chess();
    setGame(freshGame);
    setBoard(freshGame.board());
    setTurn(freshGame.turn());
    setMovesHistory([]);
    setLastMove(null);
    setInCheck(false);
    setGameStatus(null);
    setWinner(null);
    setEvaluation(0);
    setTelemetry({ depth: 0, nodes: 0, timeMs: 0 });
    setSelectedSquare(null);
    setBotLogs([
      `[SYSTEM] New game matrix established. Target opponent: ${opponentType.toUpperCase()}`
    ]);
    playSound('move');
  };

  // Flip board side view
  const handleFlipBoard = () => {
    setIsFlipped(prev => !prev);
    playSound('move');
  };

  // Resign / Abort
  const handleResign = () => {
    if (movesHistory.length === 0 || gameStatus) return;
    setGameStatus('resign');
    setWinner(playerColor === 'w' ? 'b' : 'w'); // Player resigns, opponent wins
    setBotLogs(prev => [...prev, "[SYSTEM] Connection terminated. User resigned. Session ended."]);
    playSound('check');
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
  };

  // Undo / Rollback
  const handleUndo = () => {
    if (isThinking || movesHistory.length === 0) return;
    
    // Rollback BOTH opponent and player move if turn is white
    // If turn is black, AI is thinking so we block undo, which makes sense
    if (game.history().length >= 2) {
      game.undo();
      game.undo();
    } else {
      game.undo();
    }

    setBoard(game.board());
    setTurn(game.turn());
    setMovesHistory([...game.history({ verbose: true })]);
    
    // Find last move from history
    const history = game.history({ verbose: true });
    if (history.length > 0) {
      const last = history[history.length - 1];
      setLastMove({ from: last.from, to: last.to });
    } else {
      setLastMove(null);
    }

    setInCheck(game.inCheck());
    setGameStatus(null);
    setWinner(null);
    setEvaluation(0);
    setBotLogs(prev => [...prev, "[SYSTEM] Sequence rolled back. Chrono matrix restored."]);
    playSound('move');
  };

  // Update theme when opponentType changes
  useEffect(() => {
    setBotLogs(prev => [
      ...prev,
      `[SYSTEM] Target profile swapped. Deploying ${opponentType.toUpperCase()} architecture.`
    ]);
  }, [opponentType]);

  // Clean up WebSocket on leave
  useEffect(() => {
    return () => {
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (gameMode !== 'clone' && wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
  }, [gameMode]);

  return (
    <div className={`app-wrapper theme-${opponentType}`}>
      {/* SVG Gradient Injection */}
      <ChessGradients />

      {/* Industrial Grid Background */}
      <div className="industrial-grid-bg"></div>

      {/* Left Navigation Bar (Chess.com Style) */}
      <aside className="left-nav-bar">
        <div className="nav-logo">
          <span className="logo-icon">♟️</span>
          <span className="logo-text">Mirror<span className="logo-accent">Chess</span></span>
        </div>
        <nav className="nav-menu">
          <button className="nav-item active">
            <span className="nav-icon">🎮</span> Play
          </button>
          <button className="nav-item">
            <span className="nav-icon">🧩</span> Puzzles
          </button>
          <button className="nav-item">
            <span className="nav-icon">📚</span> Learn
          </button>
          <button className="nav-item">
            <span className="nav-icon">🏋️</span> Train
          </button>
          <button className="nav-item">
            <span className="nav-icon">👀</span> Watch
          </button>
          <button className="nav-item">
            <span className="nav-icon">👥</span> Community
          </button>
        </nav>
        <div className="nav-footer">
          <button className="nav-btn-green">Sign Up</button>
          <button className="nav-btn-dark">Log In</button>
        </div>
      </aside>

      {/* Main Glass HUD Container */}
      <main className="app-container">
        {/* Tactical Interaction Grid (Evaluation Bar + Board Column + Sidebar) */}
        <div className="tactical-layout">
          
          {/* Left Column: Board + Player Profiles */}
          <div className="board-column">
            
            {/* Opponent Profile at Top of Board */}
            <div className="player-profile opponent-profile">
              <div className="profile-avatar">
                {opponentType === 'clone' && cloneBot?.avatarUrl ? (
                  <img
                    src={cloneBot.avatarUrl}
                    alt={cloneBot.displayName}
                    className="profile-avatar-img"
                    onError={(e) => { e.target.replaceWith(document.createTextNode('👥')); }}
                  />
                ) : (
                  opponentType === 'shadow' ? '👤' : '🤖'
                )}
              </div>
              <div className="profile-info">
                <span className="profile-name">
                  {opponentType === 'random' ? 'Random Bot (Stochastic)' :
                   opponentType === 'core' ? 'Core AI (Minimax Search)' :
                   opponentType === 'shadow' ? 'Shadow Clone (Neural Mimic)' :
                   opponentType === 'clone'
                     ? (cloneBot?.displayName || `Clone of ${cloneUsername}`)
                     : 'Opponent'}
                </span>
                <span className="profile-rating">1800</span>
              </div>
            </div>

            {/* Board and Evaluation Bar Wrapper */}
            <div className="board-and-eval">
              <EvaluationBar score={evaluation} turn={turn} isFlipped={isFlipped} />
              
              <div className="board-frame-container">
                <Chessboard
                  board={board}
                  turn={turn}
                  isFlipped={isFlipped}
                  selectedSquare={selectedSquare}
                  setSelectedSquare={setSelectedSquare}
                  legalMoves={legalMoves}
                  lastMove={lastMove}
                  inCheck={inCheck}
                  onMove={handlePlayerMove}
                  opponentType={opponentType}
                  isThinking={isThinking}
                  playerColor={playerColor}
                  game={game}
                />
              </div>
            </div>

            <div className="player-profile player-user-profile">
              <div className="profile-avatar">👤</div>
              <div className="profile-info">
                <span className="profile-name">Player ({playerColor === 'w' ? 'White' : 'Black'})</span>
                <span className="profile-rating">1500</span>
              </div>
            </div>
            
          </div>

          {/* Right Column: Sidebar Panel (Glassmorphic) */}
          <Sidebar
            opponentType={opponentType}
            setOpponentType={setOpponentType}
            movesHistory={movesHistory}
            capturedPieces={capturedPieces}
            telemetry={telemetry}
            botLogs={botLogs}
            isThinking={isThinking}
            onNewGame={handleRestart}
            onUndo={handleUndo}
            onFlipBoard={handleFlipBoard}
            onResign={handleResign}
            turn={turn}
            gameMode={gameMode}
            setGameMode={setGameMode}
            onPlayYouClick={() => setIsPlayYouOpen(true)}
          />
        </div>
      </main>

      {/* Game Conclusion Alert Modal Overlay */}
      <GameStatusModal
        status={gameStatus}
        winner={winner}
        opponentType={opponentType}
        onRestart={handleRestart}
        pgn={game.pgn()}
        playerColor={playerColor}
      />

      {/* Play You Training & Startup Modal */}
      <PlayYouModal
        isOpen={isPlayYouOpen}
        onClose={() => setIsPlayYouOpen(false)}
        onStartGame={startCloneMatch}
      />
    </div>
  );
}
