import os
import torch
import chess.pgn
from encoder import encode_board, move_to_index
from model import ChessPolicyNetwork

DEVICE = "cuda" if torch.cuda.is_available() else "cpu"
PGN_PATH = os.path.join("data", "chesscom_tomas_1207.pgn")
MODEL_PATH = os.path.join("models", "tomas_1207.pt")


def evaluate_clone_accuracy(pgn_path: str, model_path: str, username: str = "tomas_1207"):
    if not os.path.exists(model_path):
        print(f"Model file not found: {model_path}")
        return

    model = ChessPolicyNetwork().to(DEVICE)
    model.load_state_dict(torch.load(model_path, map_location=DEVICE))
    model.eval()

    # 1. Parse all games
    all_games = []
    with open(pgn_path, encoding="utf-8", errors="ignore") as f:
        while True:
            game = chess.pgn.read_game(f)
            if game is None:
                break
            all_games.append(game)

    # 2. Hold out last 20% of games as unseen test set
    split_idx = int(len(all_games) * 0.8)
    test_games = all_games[split_idx:]
    print(f"Total Games: {len(all_games)} | Evaluating on {len(test_games)} UNSEEN Test Games...")

    total_test_positions = 0
    top1_matches = 0
    top3_matches = 0
    top5_matches = 0

    with torch.no_grad():
        for game in test_games:
            headers = game.headers
            white_player = headers.get("White", "").lower()
            black_player = headers.get("Black", "").lower()

            target_color = None
            if username in white_player:
                target_color = chess.WHITE
            elif username in black_player:
                target_color = chess.BLACK
            else:
                continue

            board = game.board()
            for move in game.mainline_moves():
                if board.turn == target_color:
                    tensor = torch.tensor(encode_board(board), dtype=torch.float32).unsqueeze(0).to(DEVICE)
                    logits = self_logits = model(tensor)[0]
                    target_idx = move_to_index(move)

                    # Calculate Top-K metrics
                    _, top_indices = torch.topk(logits, k=5)
                    top_list = top_indices.tolist()

                    if target_idx == top_list[0]:
                        top1_matches += 1
                    if target_idx in top_list[:3]:
                        top3_matches += 1
                    if target_idx in top_list[:5]:
                        top5_matches += 1

                    total_test_positions += 1
                board.push(move)

    if total_test_positions == 0:
        print("No test positions found.")
        return

    print("\n--- Real Style Accuracy on Unseen Positions ---")
    print(f"Total Positions Tested: {total_test_positions}")
    print(f"Top-1 Exact Match : {(top1_matches / total_test_positions) * 100:.2f}%")
    print(f"Top-3 Style Match : {(top3_matches / total_test_positions) * 100:.2f}%")
    print(f"Top-5 Style Match : {(top5_matches / total_test_positions) * 100:.2f}%")


if __name__ == "__main__":
    evaluate_clone_accuracy(PGN_PATH, MODEL_PATH, username="tomas_1207")