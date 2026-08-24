import os
import json
import chess
import chess.pgn

DATA_DIR = "data"


def build_player_opening_book(username: str = "tomas_1207", max_depth_plies: int = 24) -> str:
    user = username.strip().lower()
    book_file = os.path.join("models", f"{user}_book.json")
    os.makedirs("models", exist_ok=True)

    # Locate PGN
    pgn_path = None
    for f in os.listdir(DATA_DIR):
        if user in f.lower() and f.endswith(".pgn"):
            pgn_path = os.path.join(DATA_DIR, f)
            break

    if not pgn_path:
        print(f"[Opening Book] No PGN found for '{user}'.")
        return None

    book = {}
    total_games = 0

    with open(pgn_path, encoding="utf-8", errors="ignore") as f:
        while True:
            game = chess.pgn.read_game(f)
            if game is None:
                break
            total_games += 1

            headers = game.headers
            white_player = headers.get("White", "").lower()
            black_player = headers.get("Black", "").lower()

            target_color = None
            if user in white_player:
                target_color = chess.WHITE
            elif user in black_player:
                target_color = chess.BLACK
            else:
                continue

            board = game.board()
            ply = 0
            for move in game.mainline_moves():
                if ply >= max_depth_plies:
                    break

                if board.turn == target_color:
                    # Key position by simplified FEN (pieces + turn + castling)
                    fen_key = " ".join(board.fen().split(" ")[:4])
                    move_uci = move.uci()

                    if fen_key not in book:
                        book[fen_key] = {}
                    book[fen_key][move_uci] = book[fen_key].get(move_uci, 0) + 1

                board.push(move)
                ply += 1

    with open(book_file, "w", encoding="utf-8") as out:
        json.dump(book, out, indent=2)

    print(f"[Opening Book] Built opening book for '{user}' across {total_games} games ({len(book)} exact positions stored).")
    return book_file


if __name__ == "__main__":
    build_player_opening_book("tomas_1207")