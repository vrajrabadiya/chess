import os
import io
import chess
import chess.pgn
import torch
from torch.utils.data import Dataset, DataLoader
import numpy as np

# Import our custom encoder tools from encoder.py
from encoder import encode_board, move_to_index


class ChessPlayerDataset(Dataset):
    def __init__(self, pgn_path: str, target_username: str):
        self.samples = []  # Stores (state_tensor_18x8x8, move_index)
        self.target_username = target_username.strip().lower()
        self._parse_pgn(pgn_path)

    def _parse_pgn(self, pgn_path: str):
        if not os.path.exists(pgn_path):
            raise FileNotFoundError(f"PGN file not found: {pgn_path}")

        print(f"[Dataset] Parsing positions for '{self.target_username}' from {pgn_path}...")

        with open(pgn_path, "r", encoding="utf-8", errors="ignore") as f:
            game_count = 0
            while True:
                game = chess.pgn.read_game(f)
                if game is None:
                    break  # End of file

                game_count += 1
                white_player = game.headers.get("White", "").lower()
                black_player = game.headers.get("Black", "").lower()

                # Check which color the target player was playing
                if self.target_username in white_player:
                    target_color = chess.WHITE
                elif self.target_username in black_player:
                    target_color = chess.BLACK
                else:
                    continue  # Skip games where the target player did not participate

                board = game.board()
                for move in game.mainline_moves():
                    # Record the state only when it was our player's turn to move
                    if board.turn == target_color:
                        # 1. State tensor (18, 8, 8)
                        state_tensor = encode_board(board)
                        # 2. Action index (0 to 4095)
                        action_idx = move_to_index(move)

                        self.samples.append((state_tensor, action_idx))

                    board.push(move)

        print(f"[Dataset] Processed {game_count} games -> Extracted {len(self.samples)} training positions.")

    def __len__(self):
        return len(self.samples)

    def __getitem__(self, idx):
        state_np, action_idx = self.samples[idx]
        return (
            torch.tensor(state_np, dtype=torch.float32),
            torch.tensor(action_idx, dtype=torch.long),
        )


if __name__ == "__main__":
    # Prompt for dynamic user and platform in terminal
    user_input = input("Enter username to process dataset: ").strip()
    platform_input = input("Enter platform (chesscom / lichess): ").strip().lower()

    pgn_file = os.path.join("data", f"{platform_input}_{user_input.lower()}.pgn")

    # If the file does not exist locally, download it via fetcher
    if not os.path.exists(pgn_file):
        print(f"PGN file '{pgn_file}' not found locally. Fetching now...")
        from fetcher import download_and_save
        download_and_save(platform=platform_input, username=user_input)

    if os.path.exists(pgn_file):
        dataset = ChessPlayerDataset(pgn_path=pgn_file, target_username=user_input)

        if len(dataset) > 0:
            # Wrap with PyTorch DataLoader
            loader = DataLoader(dataset, batch_size=32, shuffle=True)

            for batch_states, batch_actions in loader:
                print(f"\n--- Verification for '{user_input}' ---")
                print("Batch States Shape (Batch, Channels, H, W):", batch_states.shape)
                print("Batch Actions Shape (Batch,):", batch_actions.shape)
                assert batch_states.shape == (32, 18, 8, 8), "Shape mismatch on state tensor!"
                assert batch_actions.shape == (32,), "Shape mismatch on actions!"
                print("\nStep 2 Complete! Dataset & DataLoader ready.")
                break
        else:
            print("No moves found for this user in the downloaded PGN file.")