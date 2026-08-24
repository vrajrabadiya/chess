import chess
import numpy as np

# Map pieces to channel offsets (0-5 for White, 6-11 for Black)
PIECE_TO_CHANNEL = {
    chess.PAWN: 0,
    chess.KNIGHT: 1,
    chess.BISHOP: 2,
    chess.ROOK: 3,
    chess.QUEEN: 4,
    chess.KING: 5,
}

def encode_board(board: chess.Board) -> np.ndarray:
    """
    Converts a python-chess board state into an (18, 8, 8) float32 tensor.
    """
    tensor = np.zeros((18, 8, 8), dtype=np.float32)

    # 1. Encode piece positions (Channels 0-5 White, 6-11 Black)
    for square in chess.SQUARES:
        piece = board.piece_at(square)
        if piece is not None:
            channel = PIECE_TO_CHANNEL[piece.piece_type] + (6 if piece.color == chess.BLACK else 0)
            row = 7 - (square // 8)  # Rank 8 -> Row 0, Rank 1 -> Row 7
            col = square % 8         # File A -> Col 0, File H -> Col 7
            tensor[channel, row, col] = 1.0

    # 2. Side to move (Channel 12: 1.0 if White, 0.0 if Black)
    tensor[12, :, :] = 1.0 if board.turn == chess.WHITE else 0.0

    # 3. Castling rights (Channels 13-16)
    tensor[13, :, :] = 1.0 if board.has_kingside_castling_rights(chess.WHITE) else 0.0
    tensor[14, :, :] = 1.0 if board.has_queenside_castling_rights(chess.WHITE) else 0.0
    tensor[15, :, :] = 1.0 if board.has_kingside_castling_rights(chess.BLACK) else 0.0
    tensor[16, :, :] = 1.0 if board.has_queenside_castling_rights(chess.BLACK) else 0.0

    # 4. En-passant square (Channel 17)
    if board.ep_square is not None:
        ep_row = 7 - (board.ep_square // 8)
        ep_col = board.ep_square % 8
        tensor[17, ep_row, ep_col] = 1.0

    return tensor

def move_to_index(move: chess.Move) -> int:
    """Maps a chess.Move to an integer from 0 to 4095 (from_sq * 64 + to_sq)"""
    return move.from_square * 64 + move.to_square

def index_to_move(index: int) -> chess.Move:
    """Reconstructs a chess.Move from an integer index (0 to 4095)"""
    return chess.Move(from_square=index // 64, to_square=index % 64)


if __name__ == "__main__":
    # Test board encoding
    sample_board = chess.Board()
    t = encode_board(sample_board)
    assert t.shape == (18, 8, 8), f"Expected shape (18, 8, 8), got {t.shape}"
    
    # Test move encoding/decoding round-trip
    m = chess.Move.from_uci("e2e4")
    idx = move_to_index(m)
    recovered = index_to_move(idx)
    assert m == recovered, "Move indexing mismatch!"
    
    print("encoder.py is working correctly! Shape:", t.shape)