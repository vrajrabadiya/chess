import React, { useState } from 'react';
import { ChessPiece } from './ChessPieces';
import { Chess } from 'chess.js';

/**
 * Chessboard Component
 * Renders an 8x8 interactive board, supporting drag-and-drop, clicks, and coordinate telemetry.
 */
export default function Chessboard({
  board,
  turn,
  isFlipped,
  selectedSquare,
  setSelectedSquare,
  legalMoves,
  lastMove,
  inCheck,
  onMove,
  opponentType,
  playerColor = 'w',
  isThinking = false,
  game
}) {
  const [promotionPending, setPromotionPending] = useState(null);

  // Ranks and Files definitions based on orientation
  const ranks = isFlipped ? [1, 2, 3, 4, 5, 6, 7, 8] : [8, 7, 6, 5, 4, 3, 2, 1];
  const files = isFlipped ? ['h', 'g', 'f', 'e', 'd', 'c', 'b', 'a'] : ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];

  const isPlayerTurn = !game.isGameOver() && !isThinking && game.turn() === playerColor;

  // Find the checked king's square coordinates to apply pulsing overlay
  let checkedKingSquare = null;
  if (inCheck) {
    for (let r = 0; r < 8; r++) {
      for (let c = 0; c < 8; c++) {
        const piece = board[r][c];
        if (piece && piece.type === 'k' && piece.color === turn) {
          checkedKingSquare = piece.square;
          break;
        }
      }
      if (checkedKingSquare) break;
    }
  }

  // Check if a move requires promotion
  const checkPromotionRequirement = (from, to) => {
    const fromPiece = getPieceAt(from);
    if (!fromPiece || fromPiece.type !== 'p') return false;

    // Pawn moves to last rank (8 for white, 1 for black)
    const targetRank = to.charAt(1);
    return (fromPiece.color === 'w' && targetRank === '8') || (fromPiece.color === 'b' && targetRank === '1');
  };

  const getPieceAt = (square) => {
    const fileIdx = square.charCodeAt(0) - 97;
    const rankIdx = 8 - parseInt(square.charAt(1));
    return board[rankIdx] && board[rankIdx][fileIdx];
  };

  // Drag and Drop handlers
  const handleDragStart = (e, square) => {
    if (game.isGameOver() || isThinking) {
      e.preventDefault();
      return;
    }

    const pieceObj = getPieceAt(square);
    if (!pieceObj) {
      e.preventDefault();
      return;
    }

    // Map to string style 'wP', 'bK' etc.
    const pieceStr = pieceObj.color + pieceObj.type.toUpperCase();

    // Human is White: block dragging Black pieces and require turn === 'w'
    if (playerColor === 'w') {
      if (pieceStr.search(/^b/) !== -1 || game.turn() !== 'w') {
        e.preventDefault();
        return;
      }
    }
    // Human is Black: block dragging White pieces and require turn === 'b'
    if (playerColor === 'b') {
      if (pieceStr.search(/^w/) !== -1 || game.turn() !== 'b') {
        e.preventDefault();
        return;
      }
    }

    e.dataTransfer.setData('text/plain', square);
    setSelectedSquare(square);
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleDrop = (e, targetSquare) => {
    e.preventDefault();
    if (game.isGameOver() || isThinking) return;

    const sourceSquare = e.dataTransfer.getData('text/plain');
    if (!sourceSquare) return;

    // Verify move locally: const move = game.move({ from: source, to: target, promotion: 'q' });
    try {
      const testGame = new Chess(game.fen());
      const move = testGame.move({ from: sourceSquare, to: targetSquare, promotion: 'q' });
      if (move) {
        onMove({ from: sourceSquare, to: targetSquare, promotion: 'q' });
      }
    } catch (err) {
      console.warn("Invalid move dropped, snapback triggered:", err);
    }
    
    setSelectedSquare(null);
  };

  const handleDragOver = (e) => {
    e.preventDefault();
  };

  // Click handler (support for click-to-move + mobile)
  const handleSquareClick = (square) => {
    if (game.isGameOver() || isThinking) return;
    if (promotionPending) return;

    const pieceObj = getPieceAt(square);
    const pieceStr = pieceObj ? pieceObj.color + pieceObj.type.toUpperCase() : null;

    let clickAllowed = false;
    if (playerColor === 'w' && game.turn() === 'w' && pieceStr && pieceStr.search(/^w/) !== -1) {
      clickAllowed = true;
    }
    if (playerColor === 'b' && game.turn() === 'b' && pieceStr && pieceStr.search(/^b/) !== -1) {
      clickAllowed = true;
    }

    if (clickAllowed) {
      if (selectedSquare === square) {
        setSelectedSquare(null);
      } else {
        setSelectedSquare(square);
      }
    } 
    else if (selectedSquare) {
      const isLegal = legalMoves.some(move => move.to === square);
      if (isLegal) {
        if (checkPromotionRequirement(selectedSquare, square)) {
          setPromotionPending({ from: selectedSquare, to: square });
        } else {
          onMove({ from: selectedSquare, to: square, promotion: 'q' });
          setSelectedSquare(null);
        }
      } else {
        setSelectedSquare(null);
      }
    }
  };

  // Promotion execution handler
  const handlePromotionSelect = (pieceType) => {
    if (promotionPending) {
      onMove({
        from: promotionPending.from,
        to: promotionPending.to,
        promotion: pieceType
      });
      setPromotionPending(null);
      setSelectedSquare(null);
    }
  };

  // Render promotion overlay
  const renderPromotionOverlay = (square) => {
    const pieceColors = playerColor === 'w' ? 'w' : 'b';
    
    return (
      <div className="promotion-overlay">
        <div className="promotion-choices">
          {['q', 'r', 'n', 'b'].map((type) => (
            <button
              key={type}
              className="promotion-choice-btn"
              onClick={() => handlePromotionSelect(type)}
              title={`Promote to ${type.toUpperCase()}`}
            >
              <ChessPiece type={type} color={pieceColors} />
            </button>
          ))}
        </div>
      </div>
    );
  };

  return (
    <div className="board-container">
      <div className="board-bezel">
        {/* The Grid */}
        <div className="board-grid">
          {ranks.map((rank, rIdx) => {
            return (
              <div key={rank} className="board-row">
                {files.map((file, fIdx) => {
                  const square = `${file}${rank}`;
                  const piece = getPieceAt(square);
                  
                  const isDark = (rIdx + fIdx) % 2 === (isFlipped ? 0 : 1);
                  const isSelected = selectedSquare === square;
                  const isLastMoveSrc = lastMove && lastMove.from === square;
                  const isLastMoveDst = lastMove && lastMove.to === square;
                  const isCheckedKing = checkedKingSquare === square;

                  // Find if this square is a legal destination
                  const legalMove = legalMoves.find(move => move.to === square);
                  const isLegalDest = !!legalMove;
                  const isCapture = isLegalDest && piece;

                  let squareClass = `board-square ${isDark ? 'dark-sq' : 'light-sq'}`;
                  if (isSelected) squareClass += ' selected';
                  if (isLastMoveSrc || isLastMoveDst) squareClass += ' last-move';
                  if (isCheckedKing) squareClass += ' check-pulse';
                  if (isThinking) squareClass += ' thinking-board';

                  return (
                    <div
                      key={square}
                      className={squareClass}
                      onClick={() => handleSquareClick(square)}
                      onDragOver={handleDragOver}
                      onDrop={(e) => handleDrop(e, square)}
                      data-square={square}
                    >
                      {/* Chess Piece */}
                      {piece && (
                        <div
                          className={`chess-piece ${piece.color === playerColor ? 'draggable' : ''}`}
                          draggable={isPlayerTurn && piece.color === playerColor}
                          onDragStart={(e) => handleDragStart(e, square)}
                          onDragEnd={() => setSelectedSquare(null)}
                        >
                          <ChessPiece type={piece.type} color={piece.color} />
                        </div>
                      )}

                      {/* Coordinates Inside Squares (Chess.com style) */}
                      {file === files[0] && (
                        <span className={`square-coordinate rank-coord ${isDark ? 'light-text' : 'dark-text'}`}>
                          {rank}
                        </span>
                      )}
                      {rank === ranks[7] && (
                        <span className={`square-coordinate file-coord ${isDark ? 'light-text' : 'dark-text'}`}>
                          {file.toUpperCase()}
                        </span>
                      )}

                      {/* Legal Move Indicators */}
                      {isLegalDest && !isCapture && (
                        <div className="legal-dot-indicator">
                          <span className="dot-glowing-core"></span>
                        </div>
                      )}
                      {isLegalDest && isCapture && (
                        <div className="legal-capture-indicator">
                          <span className="ring-glowing-core"></span>
                        </div>
                      )}

                      {/* Promotion Overlay Render */}
                      {promotionPending && promotionPending.to === square && renderPromotionOverlay(square)}
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
