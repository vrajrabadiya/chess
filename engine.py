import os
import glob
import chess
import chess.engine
import torch
from encoder import encode_board, move_to_index
from model import ChessPolicyNetwork

DEVICE = "cuda" if torch.cuda.is_available() else "cpu"

def find_stockfish() -> str:
    """Recursively locates stockfish.exe in the project tree."""
    base_dir = os.path.dirname(os.path.abspath(__file__))
    for root, _, files in os.walk(base_dir):
        for f in files:
            if f.endswith(".exe") and "stockfish" in f.lower():
                return os.path.join(root, f)
    return None

STOCKFISH_PATH = find_stockfish()


class MirrorEngine:
    def __init__(self, model_path: str, device: str = DEVICE):
        self.device = device
        self.model = ChessPolicyNetwork().to(self.device)
        if os.path.exists(model_path):
            self.model.load_state_dict(torch.load(model_path, map_location=self.device))
        self.model.eval()

        self.sf = None
        if STOCKFISH_PATH and os.path.exists(STOCKFISH_PATH):
            try:
                self.sf = chess.engine.SimpleEngine.popen_uci(STOCKFISH_PATH)
                print(f"[Engine] Pure NN + Stockfish Guard ACTIVE: {STOCKFISH_PATH}")
            except Exception as e:
                print(f"[Engine Error] Stockfish launch failed: {e}")
        else:
            print("[Engine Warning] stockfish.exe not found! Running in standalone NN mode.")

    def pick_move(self, board: chess.Board) -> chess.Move:
        legal_moves = list(board.legal_moves)
        if not legal_moves:
            return None

        # 1. Neural Network assigns style weights to every legal move
        tensor = torch.tensor(encode_board(board), dtype=torch.float32).unsqueeze(0).to(self.device)
        with torch.no_grad():
            logits = self.model(tensor)[0]

        safe_candidates = []
        if self.sf:
            try:
                # Fast multi-PV search (~50ms) to evaluate top lines
                info_list = self.sf.analyse(
                    board,
                    chess.engine.Limit(depth=10, time=0.08),
                    multipv=min(5, len(legal_moves))
                )

                if info_list:
                    best_score = info_list[0]["score"].pov(board.turn).score(mate_score=10000)

                    for info in info_list:
                        pv = info.get("pv")
                        if not pv:
                            continue
                        move = pv[0]
                        current_score = info["score"].pov(board.turn).score(mate_score=10000)

                        # Filter out moves that blunder material or walk into mate
                        if best_score is not None and current_score is not None:
                            if (best_score - current_score) <= 150 and current_score > -5000:
                                safe_candidates.append(move)

                    if not safe_candidates and info_list[0].get("pv"):
                        safe_candidates = [info_list[0]["pv"][0]]

            except Exception:
                safe_candidates = legal_moves
        else:
            safe_candidates = legal_moves

        if not safe_candidates:
            safe_candidates = legal_moves

        # 2. Extract logits for safe candidate moves and convert to percentages via Softmax
        candidate_indices = [move_to_index(m) for m in safe_candidates]
        candidate_logits = torch.tensor([logits[idx].item() for idx in candidate_indices], dtype=torch.float32)
        probabilities = torch.softmax(candidate_logits, dim=0).tolist()

        scored_candidates = []
        for m, prob in zip(safe_candidates, probabilities):
            scored_candidates.append((m, prob))

        # Sort by highest stylistic match percentage
        scored_candidates.sort(key=lambda x: x[1], reverse=True)

        chosen_move, confidence = scored_candidates[0]
        print(f"[Your Clone]: Played {chosen_move.uci()} (Style Match: {confidence * 100:.1f}%)")
        return chosen_move

    def __del__(self):
        if hasattr(self, "sf") and self.sf:
            try:
                self.sf.quit()
            except Exception:
                pass