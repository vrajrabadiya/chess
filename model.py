import os
import io
import chess
import chess.pgn
import torch
import torch.nn as nn
import torch.optim as optim
from torch.utils.data import Dataset, DataLoader
import numpy as np
from fetcher import fetch_player_games

# -------------------------------------------------------------
# 1. Matching SE-ResNet Architecture (18 Input Channels)
# -------------------------------------------------------------
class SqueezeExcitation(nn.Module):
    def __init__(self, channels: int, reduction: int = 16):
        super().__init__()
        self.fc1 = nn.Linear(channels, channels // reduction, bias=False)
        self.relu = nn.ReLU(inplace=True)
        self.fc2 = nn.Linear(channels // reduction, channels, bias=False)
        self.sigmoid = nn.Sigmoid()

    def forward(self, x):
        b, c, _, _ = x.size()
        y = x.mean(dim=[2, 3])
        y = self.fc1(y)
        y = self.relu(y)
        y = self.fc2(y)
        y = self.sigmoid(y).view(b, c, 1, 1)
        return x * y

class ResidualBlock(nn.Module):
    def __init__(self, channels: int):
        super().__init__()
        self.conv1 = nn.Conv2d(channels, channels, kernel_size=3, padding=1, bias=False)
        self.bn1 = nn.BatchNorm2d(channels)
        self.relu = nn.ReLU(inplace=True)
        self.conv2 = nn.Conv2d(channels, channels, kernel_size=3, padding=1, bias=False)
        self.bn2 = nn.BatchNorm2d(channels)
        self.se = SqueezeExcitation(channels)

    def forward(self, x):
        residual = x
        out = self.relu(self.bn1(self.conv1(x)))
        out = self.bn2(self.conv2(out))
        out = self.se(out)
        out += residual
        return self.relu(out)

class ChessPolicySE_ResNet(nn.Module):
    def __init__(self, in_channels: int = 18, num_blocks: int = 6, channels: int = 128, num_moves: int = 4096):
        super().__init__()
        self.stem = nn.Sequential(
            nn.Conv2d(in_channels, channels, kernel_size=3, padding=1, bias=False),
            nn.BatchNorm2d(channels),
            nn.ReLU(inplace=True)
        )
        self.res_blocks = nn.ModuleList([ResidualBlock(channels) for _ in range(num_blocks)])
        self.policy_head = nn.Sequential(
            nn.Conv2d(channels, 32, kernel_size=1),
            nn.BatchNorm2d(32),
            nn.ReLU(inplace=True),
            nn.Flatten(),
            nn.Linear(32 * 8 * 8, 512),
            nn.ReLU(inplace=True),
            nn.Linear(512, num_moves)
        )

    def forward(self, x):
        x = self.stem(x)
        for block in self.res_blocks:
            x = block(x)
        return self.policy_head(x)

# Compatibility alias for engine.py imports
ChessPolicyNetwork = ChessPolicySE_ResNet

# -------------------------------------------------------------
# 2. 18-Plane Bitboard Encoder
# -------------------------------------------------------------
def encode_board_fast(board: chess.Board) -> np.ndarray:
    """Encodes a board state into an 18x8x8 representation."""
    planes = np.zeros((18, 8, 8), dtype=np.float32)
    piece_map = board.piece_map()
    
    # Planes 0-11: Pieces
    for square, piece in piece_map.items():
        row = 7 - (square // 8)
        col = square % 8
        plane_idx = (piece.piece_type - 1) if piece.color == chess.WHITE else (piece.piece_type - 1 + 6)
        planes[plane_idx, row, col] = 1.0

    # Planes 12-15: Castling Rights
    if board.has_kingside_castling_rights(chess.WHITE):
        planes[12, :, :] = 1.0
    if board.has_queenside_castling_rights(chess.WHITE):
        planes[13, :, :] = 1.0
    if board.has_kingside_castling_rights(chess.BLACK):
        planes[14, :, :] = 1.0
    if board.has_queenside_castling_rights(chess.BLACK):
        planes[15, :, :] = 1.0

    # Plane 16: Active Turn (1 for White, 0 for Black)
    if board.turn == chess.WHITE:
        planes[16, :, :] = 1.0

    # Plane 17: En Passant Square
    if board.ep_square is not None:
        ep_row = 7 - (board.ep_square // 8)
        ep_col = board.ep_square % 8
        planes[17, ep_row, ep_col] = 1.0

    return planes

board_to_tensor = encode_board_fast
encode_board = encode_board_fast

def move_to_index(move: chess.Move) -> int:
    return move.from_square * 64 + move.to_square

def index_to_move(idx: int) -> chess.Move:
    return chess.Move(idx // 64, idx % 64)

# -------------------------------------------------------------
# 3. Fast In-Memory Dataset
# -------------------------------------------------------------
class FastChessDataset(Dataset):
    def __init__(self, pgn_path: str, target_user: str):
        self.planes_list = []
        self.targets_list = []
        target_user = target_user.strip().lower()

        with open(pgn_path, "r", encoding="utf-8", errors="ignore") as f:
            while True:
                game = chess.pgn.read_game(f)
                if game is None:
                    break

                white = game.headers.get("White", "").strip().lower()
                black = game.headers.get("Black", "").strip().lower()

                if white == target_user:
                    target_color = chess.WHITE
                elif black == target_user:
                    target_color = chess.BLACK
                else:
                    continue

                board = game.board()
                for move in game.mainline_moves():
                    if board.turn == target_color:
                        self.planes_list.append(encode_board_fast(board))
                        self.targets_list.append(move_to_index(move))
                    board.push(move)

        if len(self.planes_list) == 0:
            raise ValueError(f"No matching games found for user '{target_user}' in {pgn_path}")

        self.x = torch.from_numpy(np.array(self.planes_list, dtype=np.float32))
        self.y = torch.tensor(self.targets_list, dtype=torch.long)

    def __len__(self):
        return len(self.targets_list)

    def __getitem__(self, idx):
        return self.x[idx], self.y[idx]

# -------------------------------------------------------------
# 4. Accelerated Training Loop with Early Stopping
# -------------------------------------------------------------
def train_user_model_to_target(
    username: str, 
    platform: str = "chesscom", 
    epochs: int = 8, 
    batch_size: int = 256, 
    device: str = None,
    target_top5_acc: float = 0.85,
    max_games: int = 500,
    progress_callback=None,
    **kwargs
) -> str:
    if device is None:
        device = "cuda" if torch.cuda.is_available() else "cpu"

    os.makedirs("models", exist_ok=True)
    model_save_path = os.path.join("models", f"{username.lower()}.pt")

    if progress_callback:
        progress_callback("Downloading games...", 5)

    pgn_path = fetch_player_games(username=username, platform=platform, max_games=max_games)

    if progress_callback:
        progress_callback("Clone is 15% ready", 15)

    dataset = FastChessDataset(pgn_path=pgn_path, target_user=username)
    
    loader = DataLoader(
        dataset, 
        batch_size=batch_size, 
        shuffle=True, 
        pin_memory=(device == "cuda"),
        num_workers=0
    )

    model = ChessPolicySE_ResNet().to(device)
    criterion = nn.CrossEntropyLoss()
    optimizer = optim.AdamW(model.parameters(), lr=3e-3, weight_decay=1e-4)
    scheduler = optim.lr_scheduler.OneCycleLR(
        optimizer, 
        max_lr=3e-3, 
        steps_per_epoch=len(loader), 
        epochs=epochs
    )
    
    scaler = torch.amp.GradScaler('cuda', enabled=(device == "cuda"))

    model.train()
    for epoch in range(1, epochs + 1):
        total_loss = 0.0
        correct_top5 = 0
        total_samples = 0

        for bx, by in loader:
            bx = bx.to(device, non_blocking=True)
            by = by.to(device, non_blocking=True)

            optimizer.zero_grad(set_to_none=True)

            with torch.amp.autocast('cuda', enabled=(device == "cuda")):
                preds = model(bx)
                loss = criterion(preds, by)

            scaler.scale(loss).backward()
            scaler.step(optimizer)
            scaler.update()
            scheduler.step()

            _, top5_indices = preds.topk(5, dim=1)
            correct_top5 += (top5_indices == by.unsqueeze(1)).any(dim=1).sum().item()
            total_samples += bx.size(0)

        # Map progress smoothly from 20% to 100%
        current_pct = int(20 + (epoch / epochs) * 80)
        if progress_callback:
            progress_callback(f"Clone is {current_pct}% ready", current_pct)

        epoch_top5 = (correct_top5 / total_samples) * 100
        if (epoch_top5 / 100.0) >= target_top5_acc:
            if progress_callback:
                progress_callback("Clone is 100% ready", 100)
            break

    torch.save(model.state_dict(), model_save_path)
    return model_save_path