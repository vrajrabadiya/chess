// Piece-Square Tables (PST) for positional evaluation.
// Values from White's perspective (positive values favor White, negative favor Black).
// Board coordinates: a8 is [0][0], h1 is [7][7].

const pawnPST = [
  [0,  0,  0,  0,  0,  0,  0,  0],
  [50, 50, 50, 50, 50, 50, 50, 50],
  [10, 10, 20, 30, 30, 20, 10, 10],
  [5,  5, 10, 25, 25, 10,  5,  5],
  [0,  0,  0, 20, 20,  0,  0,  0],
  [5, -5,-10,  0,  0,-10, -5,  5],
  [5, 10, 10,-20,-20, 10, 10,  5],
  [0,  0,  0,  0,  0,  0,  0,  0]
];

const knightPST = [
  [-50,-40,-30,-30,-30,-30,-40,-50],
  [-40,-20,  0,  0,  0,  0,-20,-40],
  [-30,  0, 10, 15, 15, 10,  0,-30],
  [-30,  5, 15, 20, 20, 15,  5,-30],
  [-30,  0, 15, 20, 20, 15,  0,-30],
  [-30,  5, 10, 15, 15, 10,  5,-30],
  [-40,-20,  0,  5,  5,  0,-20,-40],
  [-50,-40,-30,-30,-30,-30,-40,-50]
];

const bishopPST = [
  [-20,-10,-10,-10,-10,-10,-10,-20],
  [-10,  0,  0,  0,  0,  0,  0,-10],
  [-10,  0,  5, 10, 10,  5,  0,-10],
  [-10,  5,  5, 10, 10,  5,  5,-10],
  [-10,  0, 10, 10, 10, 10,  0,-10],
  [-10, 10, 10, 10, 10, 10, 10,-10],
  [-10,  5,  0,  0,  0,  0,  5,-10],
  [-20,-10,-10,-10,-10,-10,-10,-20]
];

const rookPST = [
  [0,  0,  0,  0,  0,  0,  0,  0],
  [5, 10, 10, 10, 10, 10, 10,  5],
  [-5,  0,  0,  0,  0,  0,  0, -5],
  [-5,  0,  0,  0,  0,  0,  0, -5],
  [-5,  0,  0,  0,  0,  0,  0, -5],
  [-5,  0,  0,  0,  0,  0,  0, -5],
  [-5,  0,  0,  0,  0,  0,  0, -5],
  [0,  0,  0,  5,  5,  0,  0,  0]
];

const queenPST = [
  [-20,-10,-10, -5, -5,-10,-10,-20],
  [-10,  0,  0,  0,  0,  0,  0,-10],
  [-10,  0,  5,  5,  5,  5,  0,-10],
  [-5,  0,  5,  5,  5,  5,  0, -5],
  [0,  0,  5,  5,  5,  5,  0, -5],
  [-10,  5,  5,  5,  5,  5,  0,-10],
  [-10,  0,  5,  0,  0,  5,  0,-10],
  [-20,-10,-10, -5, -5,-10,-10,-20]
];

const kingMiddleGamePST = [
  [-30,-40,-40,-50,-50,-40,-40,-30],
  [-30,-40,-40,-50,-50,-40,-40,-30],
  [-30,-40,-40,-50,-50,-40,-40,-30],
  [-30,-40,-40,-50,-50,-40,-40,-30],
  [-20,-30,-30,-40,-40,-30,-30,-20],
  [-10,-20,-20,-20,-20,-20,-20,-10],
  [20, 20,  0,  0,  0,  0, 20, 20],
  [20, 30, 10,  0,  0, 10, 30, 20]
];

// In the endgame, we want the king to centralize.
const kingEndGamePST = [
  [-50,-40,-30,-20,-20,-30,-40,-50],
  [-30,-20,-10,  0,  0,-10,-20,-30],
  [-30,-10, 20, 30, 30, 20,-10,-30],
  [-30,-10, 30, 40, 40, 30,-10,-30],
  [-30,-10, 30, 40, 40, 30,-10,-30],
  [-30,-10, 20, 30, 30, 20,-10,-30],
  [-30,-30,  0,  0,  0,  0,-30,-30],
  [-50,-30,-30,-30,-30,-30,-30,-50]
];

// Helper to get board index coordinate
function getBoardCoordinates(square) {
  const file = square.charCodeAt(0) - 97; // a=0, b=1, ...
  const rank = 8 - parseInt(square.charAt(1)); // 8=0, 7=1, ...
  return { r: rank, c: file };
}

// Check if it is endgame (less pieces on board)
function isEndgame(chess) {
  let majorMinorPiecesCount = 0;
  chess.board().forEach(row => {
    row.forEach(piece => {
      if (piece && piece.type !== 'p' && piece.type !== 'k') {
        majorMinorPiecesCount++;
      }
    });
  });
  return majorMinorPiecesCount <= 6;
}

// Evaluates the board from white's perspective
function evaluateBoard(chess, botStyle = 'standard') {
  let totalEvaluation = 0;
  const board = chess.board();
  const endgame = isEndgame(chess);

  const pieceValues = {
    p: 100,
    n: 320,
    b: 330,
    r: 500,
    q: 900,
    k: 20000
  };

  // Modify weight styles based on Opponent Profile
  // 'shadow' style is highly aggressive, rewarding king attacks, checks, and piece activity
  const materialWeight = 1.0;
  const positionWeight = botStyle === 'shadow' ? 1.3 : 1.0;
  const kingAttackBonus = botStyle === 'shadow' ? 150 : 0;

  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      const piece = board[r][c];
      if (!piece) continue;

      let value = pieceValues[piece.type];

      // Piece Square Tables evaluation
      let pstValue = 0;
      const type = piece.type;
      
      // Select correct table. If black, we flip the row index to look at the board from black's perspective
      const evalRow = piece.color === 'w' ? r : 7 - r;
      const evalCol = piece.color === 'w' ? c : 7 - c;

      if (type === 'p') pstValue = pawnPST[evalRow][evalCol];
      else if (type === 'n') pstValue = knightPST[evalRow][evalCol];
      else if (type === 'b') pstValue = bishopPST[evalRow][evalCol];
      else if (type === 'r') pstValue = rookPST[evalRow][evalCol];
      else if (type === 'q') pstValue = queenPST[evalRow][evalCol];
      else if (type === 'k') {
        pstValue = endgame ? kingEndGamePST[evalRow][evalCol] : kingMiddleGamePST[evalRow][evalCol];
      }

      const totalPieceValue = (value * materialWeight) + (pstValue * positionWeight);

      if (piece.color === 'w') {
        totalEvaluation += totalPieceValue;
      } else {
        totalEvaluation -= totalPieceValue;
      }
    }
  }

  // Shadow bot style: Add aggression factors
  if (botStyle === 'shadow') {
    // If black (Shadow Clone is usually playing black), we want to reward checks or attacks on white's king
    if (chess.inCheck()) {
      // If it's white's turn, then black just put white in check!
      if (chess.turn() === 'w') {
        totalEvaluation -= kingAttackBonus; // negative favors black
      } else {
        totalEvaluation += kingAttackBonus; // positive favors white
      }
    }
  }

  return totalEvaluation;
}

// Alpha-Beta Minimax search
let nodeCount = 0;

function minimax(chess, depth, alpha, beta, isMaximizing, botStyle) {
  nodeCount++;

  // Base Cases
  if (depth === 0) {
    return evaluateBoard(chess, botStyle);
  }

  if (chess.isGameOver()) {
    if (chess.isCheckmate()) {
      // If we are checkmated, we return extreme scores
      // Note: chess.turn() is the player who is currently in turn (about to make a move)
      // If it's white's turn and they are checkmated, black won! return -100000 + depth (to prefer shorter mate paths)
      if (chess.turn() === 'w') {
        return -99999 + (4 - depth);
      } else {
        return 99999 - (4 - depth);
      }
    }
    return 0; // Draw, stalemate, threefold, 50-move
  }

  const moves = orderMoves(chess, chess.moves({ verbose: true }));

  if (isMaximizing) {
    let maxEval = -Infinity;
    for (const move of moves) {
      chess.move(move.san);
      const evaluation = minimax(chess, depth - 1, alpha, beta, false, botStyle);
      chess.undo();
      maxEval = Math.max(maxEval, evaluation);
      alpha = Math.max(alpha, evaluation);
      if (beta <= alpha) {
        break; // Beta cutoff
      }
    }
    return maxEval;
  } else {
    let minEval = Infinity;
    for (const move of moves) {
      chess.move(move.san);
      const evaluation = minimax(chess, depth - 1, alpha, beta, true, botStyle);
      chess.undo();
      minEval = Math.min(minEval, evaluation);
      beta = Math.min(beta, evaluation);
      if (beta <= alpha) {
        break; // Alpha cutoff
      }
    }
    return minEval;
  }
}

// Simple move ordering: rate captures and promotions higher to improve alpha-beta pruning efficiency
function orderMoves(chess, moves) {
  return moves.map(move => {
    let score = 0;
    
    // Captures: Most Valuable Victim - Least Valuable Attacker heuristic
    if (move.captured) {
      const victimValue = getPieceValue(move.captured);
      const attackerValue = getPieceValue(move.piece);
      score = 10 * victimValue - attackerValue + 100;
    }
    
    // Promotions: value them highly
    if (move.promotion) {
      score += 80;
    }
    
    // Giving check: favor check moves
    chess.move(move.san);
    if (chess.inCheck()) {
      score += 50;
    }
    chess.undo();

    return { ...move, searchScore: score };
  }).sort((a, b) => b.searchScore - a.searchScore);
}

function getPieceValue(type) {
  switch (type) {
    case 'p': return 1;
    case 'n': return 3;
    case 'b': return 3;
    case 'r': return 5;
    case 'q': return 9;
    default: return 0;
  }
}

/**
 * Calculates the best move for the active side.
 * @param {Chess} chess - Current chess.js instance
 * @param {string} opponentType - 'random' | 'core' | 'shadow'
 * @returns {object} - { bestMoveString, nodes, timeMs, score }
 */
export function calculateBestMove(chess, opponentType) {
  const startTime = performance.now();
  nodeCount = 0;
  
  const moves = chess.moves({ verbose: true });
  if (moves.length === 0) {
    return { bestMove: null, nodes: 0, timeMs: 0, score: 0 };
  }

  // 1. RANDOM BOT
  if (opponentType === 'random') {
    const randomIdx = Math.floor(Math.random() * moves.length);
    const move = moves[randomIdx];
    const timeMs = performance.now() - startTime;
    // Calculate simple eval
    chess.move(move.san);
    const score = evaluateBoard(chess, 'standard');
    chess.undo();
    
    return {
      bestMove: move,
      nodes: 1,
      timeMs: Math.max(timeMs, 1),
      score: score / 100
    };
  }

  // 2. CORE ENGINE or SHADOW CLONE
  const isWhite = chess.turn() === 'w';
  const botStyle = opponentType === 'shadow' ? 'shadow' : 'standard';
  
  // Set search depth: 3 is extremely responsive and robust for standard web AI.
  // Shadow Clone can search at depth 3 for ultra-fast aggressive plays, or 4 if it finds complex forks.
  const depth = opponentType === 'shadow' ? 3 : 3;

  let bestMove = null;
  let bestEval = isWhite ? -Infinity : Infinity;
  let alpha = -Infinity;
  let beta = Infinity;

  // Order initial moves
  const orderedMoves = orderMoves(chess, moves);

  for (const move of orderedMoves) {
    chess.move(move.san);
    // Determine the minimax evaluation for this move branch
    const evaluation = minimax(chess, depth - 1, alpha, beta, !isWhite, botStyle);
    chess.undo();

    if (isWhite) {
      if (evaluation > bestEval) {
        bestEval = evaluation;
        bestMove = move;
      }
      alpha = Math.max(alpha, evaluation);
    } else {
      if (evaluation < bestEval) {
        bestEval = evaluation;
        bestMove = move;
      }
      beta = Math.min(beta, evaluation);
    }
  }

  // Fallback if no best move was set
  if (!bestMove) {
    bestMove = orderedMoves[0];
  }

  const endTime = performance.now();
  const timeMs = endTime - startTime;

  return {
    bestMove: bestMove,
    nodes: nodeCount,
    timeMs: Math.max(timeMs, 1),
    score: bestEval / 100 // convert back to centipawns unit
  };
}

/**
 * Returns a thematic quote or message from the bot type to simulate intelligence.
 * @param {string} opponentType - 'random' | 'core' | 'shadow'
 * @param {string} lastMoveSan - Optional last move string
 * @param {boolean} inCheck - Whether player is in check
 * @returns {string} - Chat/Log statement
 */
export function getBotQuote(opponentType, lastMoveSan = '', inCheck = false) {
  if (opponentType === 'random') {
    const quotes = [
      "BEEP BOOP! Entropy is the only true guide.",
      "SYSTEM RUNNING: Executing chaotic trajectories...",
      "Quantum coin flipped. Initiating movement protocol.",
      "Calculated? No, purely stochastic behavior.",
      "Let's see what happens if I do... this!"
    ];
    return quotes[Math.floor(Math.random() * quotes.length)];
  }

  if (opponentType === 'core') {
    if (inCheck) {
      return `[ALERT] Check condition identified. Restructuring coordinates. Core move: ${lastMoveSan}`;
    }
    const quotes = [
      `Positional integrity optimal. Branching paths evaluated. Executed: ${lastMoveSan}`,
      `Selecting minimax vector. Depth limits reached. Move registered: ${lastMoveSan}`,
      `Evaluating board matrix. Material balance stable. Executed: ${lastMoveSan}`,
      `Core Engine operating at nominal capacity. Deploying move: ${lastMoveSan}`,
      `PST coefficient calculated. Executing optimized line: ${lastMoveSan}`
    ];
    return quotes[Math.floor(Math.random() * quotes.length)];
  }

  if (opponentType === 'shadow') {
    if (inCheck) {
      return `[SHADOW CLONE] "Your King is cornered. Embrace the inevitable. Move: ${lastMoveSan}"`;
    }
    const quotes = [
      `[SHADOW CLONE] "I see your strategy. Mimicking structure... Countering with ${lastMoveSan}."`,
      `[SHADOW CLONE] "Your defenses are thinning. Striking coordinates: ${lastMoveSan}."`,
      `[SHADOW CLONE] "Do you feel the pressure? The shadows lengthen... Executed ${lastMoveSan}."`,
      `[SHADOW CLONE] "Your moves are mathematically vulnerable. Initiating override: ${lastMoveSan}."`,
      `[SHADOW CLONE] "A perfect replica of aggressive mechanics. Watch this: ${lastMoveSan}."`
    ];
    return quotes[Math.floor(Math.random() * quotes.length)];
  }

  return "";
}
