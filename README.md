# MirrorChess ♟️

> **An end-to-end deep learning system that clones the unique playing style, opening preferences, and tactical habits of any player on Chess.com or Lichess — on demand, in real time.**

---

## Table of Contents

1. [Project Motivation & Core Idea](#1-project-motivation--core-idea)
2. [The Mathematics of Chess Neural Modeling](#2-the-mathematics-of-chess-neural-modeling)
   - [Problem 1: Variable Legal Moves vs. Fixed Output Dimensions](#problem-1-variable-legal-moves-vs-fixed-output-dimensions)
   - [Problem 2: Dynamic Logit Masking for Legal Play](#problem-2-dynamic-logit-masking-for-legal-play)
   - [Spatial Board Encoding — The 18-Plane Bitboard Tensor](#spatial-board-encoding--the-18-plane-bitboard-tensor)
   - [SE-ResNet Architecture & Channel Attention](#se-resnet-architecture--channel-attention)
   - [Loss Function & Supervised Training](#loss-function--supervised-training)
   - [Inference Sampling & Stockfish Blunder Filtering](#inference-sampling--stockfish-blunder-filtering)
3. [System Architecture & Engineering Flow](#3-system-architecture--engineering-flow)
4. [Engineering Trade-offs & Critical Analysis](#4-engineering-trade-offs--critical-analysis)
5. [Style Accuracy Evaluation](#5-style-accuracy-evaluation)
6. [How to Run & Build](#6-how-to-run--build)
7. [Project File Map](#7-project-file-map)

---

## 1. Project Motivation & Core Idea

### What I Built

I built **MirrorChess** — a full-stack AI system that takes any Chess.com or Lichess username, downloads their entire game history via public APIs, and trains a personalized **neural policy network** that learns *how that specific human plays chess*. The resulting clone can be played against live inside a custom React interface, in real-time over a WebSocket connection.

The key insight I kept returning to: **chess skill is not a single scalar**. Two 1500-rated players are not interchangeable. One may open with 1.e4 and launch Sicilian Dragon attacks every game; another may prefer slow Catalan structures and grind endgames. One may consistently sacrifice the exchange for long-term positional compensation; another may panic when material goes down. These are *stylistic fingerprints* — and they are learnable.

The pipeline I designed looks like this:

```
Chess.com / Lichess API
        ↓  (HTTP, PGN archives)
PGN Ingestion & Player Filtering
        ↓
18-Plane Bitboard Tensor Encoding  (18 × 8 × 8 per position)
        ↓
SE-ResNet Policy Network Training  (PyTorch, AdamW + OneCycleLR)
        ↓
Weights Cache  (.pt file, persisted per username)
        ↓
FastAPI Backend  (REST training endpoint + WebSocket game server)
        ↓
React Frontend  (live chessboard, DiceBear avatars, localStorage clone memory)
```

The end result: you type a username, click "Train & Play", watch a real-time training progress ring fill up, and 30–90 seconds later you are sitting across the board from a statistically faithful behavioral clone of that player.

---

### Why Simple Heuristics Fail

Before choosing the neural approach, I thought about the obvious shortcut: just throttle a Stockfish engine to a given ELO, or handcraft piece-value weights to approximate a style. This is exactly how most "personality bots" in consumer chess apps work. The problem is fundamental and unavoidable:

**Handcrafted bots are stylistically hollow.** A throttled engine still thinks like Stockfish — it just plays its objectively best move within an artificial constraint. It will never voluntarily play the King's Indian because it *prefers* it, or repeat a favorite middlegame pawn structure across 300 games. The emergent behavior is random noise around a mechanically optimal line, not a coherent identity.

**Behavioral cloning via supervised learning captures what handcrafting cannot.** When I train a neural policy network on a player's PGN history, the model is forced to learn *the distribution of that player's choices* at each board state. It doesn't learn "which move is objectively best" — it learns "which move would *this person* most likely play here." That includes their opening transpositions, their pawn-break timing preferences, whether they castle early or delay, whether they trade queens when given the chance. The model learns all of this implicitly from the statistics of thousands of real decisions.

The difference is visceral when you play against a clone: it doesn't feel like playing a bot. It feels like playing *that person*.

---

## 2. The Mathematics of Chess Neural Modeling

### Problem 1: Variable Legal Moves vs. Fixed Output Dimensions

The first hard engineering problem I hit is one every chess ML practitioner faces: **neural networks require a fixed-size output vector**, but the number of legal moves in any chess position is wildly variable — anywhere from 0 (checkmate/stalemate) to 218 (the theoretical maximum, almost never reached in practice, but commonly 20–40 moves in middlegames).

The naive approach — making the output layer size equal to the current number of legal moves — is architecturally impossible. A neural network's weight matrices are fixed at training time; you cannot resize the final linear layer at inference time based on how many moves happen to be legal right now.

**My solution:** I defined a fixed bijective mapping from every possible chess move (origin square → destination square) to a single integer index in a flat 4096-dimensional action space:

$$\text{Index}(u, v) = u \times 64 + v \quad \text{where } u, v \in [0, 63]$$

Here $u$ is the UCI origin square index (a1 = 0, b1 = 1, …, h8 = 63) and $v$ is the destination square index. The product space of all (from, to) pairs is $64 \times 64 = 4096$. This is the output dimension of my policy head — a fixed linear layer that always emits 4096 raw logits, regardless of the position.

In code, this is implemented in [`encoder.py`](encoder.py):

```python
def move_to_index(move: chess.Move) -> int:
    return move.from_square * 64 + move.to_square

def index_to_move(index: int) -> chess.Move:
    return chess.Move(from_square=index // 64, to_square=index % 64)
```

> **Note on promotions:** The 4096 space covers all (from, to) pairs but not promotion piece choices. In the current implementation, underpromotions are not separately indexed — the network always promotes to the piece at the "default" move index. This is a known simplification I discuss in [trade-offs](#4-engineering-trade-offs--critical-analysis).

---

### Problem 2: Dynamic Logit Masking for Legal Play

Having a 4096-dimensional output immediately creates a second problem: the vast majority of those 4096 slots correspond to moves that are *illegal* in any given position. Without intervention, `argmax` or `softmax` sampling could return any of them.

I solved this with **dynamic logit masking**. At inference time, I construct a boolean mask vector $M \in \mathbb{R}^{4096}$ for the current position:

$$M_i = \begin{cases} 0 & \text{if move } i \in \mathcal{L} \\ -\infty & \text{if move } i \notin \mathcal{L} \end{cases}$$

where $\mathcal{L}$ is the set of all legal move indices for the current board state, computed using `python-chess`'s fully validated `board.legal_moves` generator.

The mask is added to the raw network logits $\mathbf{z}$ before the Softmax distribution is computed:

$$P(\text{move } i) = \frac{e^{z_i + M_i}}{\sum_{j=1}^{4096} e^{z_j + M_j}} = \frac{e^{z_i + M_i}}{\sum_{j \in \mathcal{L}} e^{z_j}}$$

The mathematical elegance here is that $e^{-\infty} = 0$ exactly. Any illegal move's contribution to the softmax denominator vanishes entirely. The resulting probability distribution assigns **exactly zero mass to every illegal move** and a well-defined positive probability to each legal one, with the probabilities still summing to 1. The network can never output an illegal move. This is a hard guarantee — not a soft penalty.

In [`engine.py`](engine.py), this materializes as:

```python
candidate_indices = [move_to_index(m) for m in safe_candidates]
candidate_logits = torch.tensor([logits[idx].item() for idx in candidate_indices])
probabilities = torch.softmax(candidate_logits, dim=0).tolist()
```

The masking is implicit here — only the logits for legal (and Stockfish-safe) candidate moves are extracted before softmax, achieving the same $e^{-\infty} = 0$ effect.

---

### Spatial Board Encoding — The 18-Plane Bitboard Tensor

The question of *how to represent a chess position as a neural network input* is non-trivial. A flat 64-element vector of piece IDs loses critical structure — it conflates spatial relationships, fails to distinguish empty squares from occupied ones in a vectorized way, and provides no natural mechanism for convolutional feature extraction.

I encode every board state as a 3D tensor $\mathbf{X} \in \mathbb{R}^{18 \times 8 \times 8}$ — 18 binary planes stacked over an 8×8 grid. This is a **bitboard representation**: each plane is a binary indicator matrix, and together they encode the full FIDE-legal game state (pieces, castling rights, side to move, en passant).

**Plane layout:**

| Plane Index | Meaning |
|:-----------:|:--------|
| 0 | White Pawn occupancy |
| 1 | White Knight occupancy |
| 2 | White Bishop occupancy |
| 3 | White Rook occupancy |
| 4 | White Queen occupancy |
| 5 | White King occupancy |
| 6 | Black Pawn occupancy |
| 7 | Black Knight occupancy |
| 8 | Black Bishop occupancy |
| 9 | Black Rook occupancy |
| 10 | Black Queen occupancy |
| 11 | Black King occupancy |
| 12 | White kingside castling right (broadcast: all 1s if available) |
| 13 | White queenside castling right |
| 14 | Black kingside castling right |
| 15 | Black queenside castling right |
| 16 | Active turn (all 1s if White to move, all 0s if Black) |
| 17 | En passant target square (single 1 at the EP square, else all zeros) |

The rank mapping convention is `row = 7 - (square // 8)` — rank 8 maps to row 0 of the tensor, rank 1 maps to row 7. This preserves the visual top-to-bottom orientation of a standard chess diagram for White.

The implemented encoder from [`encoder.py`](encoder.py):

```python
PIECE_TO_CHANNEL = {
    chess.PAWN: 0, chess.KNIGHT: 1, chess.BISHOP: 2,
    chess.ROOK: 3, chess.QUEEN: 4,  chess.KING: 5,
}

def encode_board(board: chess.Board) -> np.ndarray:
    tensor = np.zeros((18, 8, 8), dtype=np.float32)
    for square in chess.SQUARES:
        piece = board.piece_at(square)
        if piece is not None:
            channel = PIECE_TO_CHANNEL[piece.piece_type] + (6 if piece.color == chess.BLACK else 0)
            row = 7 - (square // 8)
            col = square % 8
            tensor[channel, row, col] = 1.0
    # ... castling, turn, en passant planes follow
    return tensor
```

**Why 18 planes and not fewer?** Dropping the castling planes (4 planes) would force the network to infer castling availability from king/rook positions, which is ambiguous — a king on e1 with a rook on h1 could have lost kingside castling rights by moving and returning. En passant is similarly ephemeral. These planes are essential for the encoding to be a complete Markov state representation of the legal game position.

---

### SE-ResNet Architecture & Channel Attention

My policy network, `ChessPolicySE_ResNet` defined in [`model.py`](model.py), is a **Squeeze-and-Excitation ResNet** — a convolutional architecture augmented with learned channel-wise attention. This is the same class of architecture that underpins AlphaZero and Leela Chess Zero's policy heads (though much smaller in scale).

**Why convolutional?** Chess positions have strong spatial locality and translation-related structure. Pawn chains, file control, king safety, open diagonals — these are all geometrically structured patterns on the 8×8 grid. Convolutions are the natural inductive bias for extracting them.

**Why Squeeze-and-Excitation?** In a standard ResNet, all feature channels are treated equally after each convolution. But in a chess position, the relevance of different piece planes changes dramatically with context — in an endgame with no queens, the queen planes carry no signal and should be suppressed; in a position with a fianchettoed bishop and open diagonals, the bishop and diagonal-related features should be amplified. SE blocks implement this adaptive channel recalibration automatically.

**The SE block math:**

Given a feature map $\mathbf{X} \in \mathbb{R}^{C \times 8 \times 8}$ with $C$ channels, the SE block computes:

**Step 1 — Spatial Global Average Pooling (Squeeze):**

$$z_c = \frac{1}{64} \sum_{i=1}^{8} \sum_{j=1}^{8} x_c(i, j), \quad \mathbf{z} \in \mathbb{R}^C$$

This collapses the spatial dimensions into a single descriptor per channel — a global summary of how "active" that channel is across the board.

**Step 2 — Adaptive Channel Excitation via Bottleneck MLP:**

$$\mathbf{s} = \sigma\!\left(\mathbf{W}_2 \cdot \text{ReLU}\!\left(\mathbf{W}_1 \mathbf{z}\right)\right), \quad \mathbf{s} \in \mathbb{R}^C$$

where $\mathbf{W}_1 \in \mathbb{R}^{(C/r) \times C}$ is a dimensionality reduction by ratio $r = 16$, and $\mathbf{W}_2 \in \mathbb{R}^{C \times (C/r)}$ projects back to $C$ dimensions. The sigmoid produces a per-channel scalar attention weight $s_c \in (0, 1)$.

**Step 3 — Feature Recalibration:**

$$\tilde{\mathbf{X}}_c = s_c \cdot \mathbf{X}_c$$

Each channel's spatial feature map is scaled by its learned importance score. Channels the network determines are irrelevant for the current position get suppressed; salient channels get amplified.

In code (from [`model.py`](model.py)):

```python
class SqueezeExcitation(nn.Module):
    def __init__(self, channels: int, reduction: int = 16):
        super().__init__()
        self.fc1 = nn.Linear(channels, channels // reduction, bias=False)
        self.relu = nn.ReLU(inplace=True)
        self.fc2 = nn.Linear(channels // reduction, channels, bias=False)
        self.sigmoid = nn.Sigmoid()

    def forward(self, x):
        b, c, _, _ = x.size()
        y = x.mean(dim=[2, 3])           # Global average pool -> (B, C)
        y = self.fc1(y)                  # Squeeze: (B, C) -> (B, C/r)
        y = self.relu(y)
        y = self.fc2(y)                  # Excite: (B, C/r) -> (B, C)
        y = self.sigmoid(y).view(b, c, 1, 1)
        return x * y                     # Recalibrate: broadcast-scale each channel
```

**Full network topology:**

```
Input:  (B, 18, 8, 8)
  |
  v
Stem Conv:  Conv2d(18->128, 3x3, pad=1) -> BN -> ReLU
  |
  v
6 x SE-Residual Blocks:
  +-- Conv2d(128->128, 3x3) -> BN -> ReLU
  |   Conv2d(128->128, 3x3) -> BN
  |   SE Block (reduction r=16)
  +-- + skip connection -> ReLU
  |
  v
Policy Head:
  Conv2d(128->32, 1x1) -> BN -> ReLU -> Flatten
  Linear(32 x 8 x 8 = 2048 -> 512) -> ReLU
  Linear(512 -> 4096)
  |
  v
Output: raw logits in R^4096  (one per (from_square, to_square) pair)
```

**Parameter count:** With 128 channels, 6 residual blocks, and SE reduction at 16, the network has approximately **3.2M parameters** — lightweight enough to train from scratch in under 2 minutes on a GPU for a 500-game dataset.

---

### Loss Function & Supervised Training

The training objective is pure **behavioral cloning via cross-entropy loss**. Given a position-move pair $(s_t, a_t)$ extracted from the target player's game history — where $s_t$ is the board state and $a_t$ is the move they actually played — I treat this as a 4096-class classification problem.

The ground-truth label is a one-hot vector $\mathbf{y} \in \{0,1\}^{4096}$ where $y_{a_t} = 1$. The network outputs a probability distribution $\hat{\mathbf{y}} = \text{Softmax}(\mathbf{z})$ over all 4096 move indices. The loss is:

$$\mathcal{L}_{\text{CE}} = -\sum_{i=1}^{4096} y_i \log(\hat{y}_i) = -\log\!\left(\hat{y}_{a_t}\right)$$

Since $\mathbf{y}$ is one-hot, this collapses to just $-\log$ of the predicted probability assigned to the move the player actually chose. Minimizing this is equivalent to maximizing the likelihood of the player's historical move choices under the network's distribution — exactly what behavioral cloning is.

**Training configuration** (from [`model.py`](model.py)):

```python
optimizer = optim.AdamW(model.parameters(), lr=3e-3, weight_decay=1e-4)
scheduler = optim.lr_scheduler.OneCycleLR(
    optimizer, max_lr=3e-3,
    steps_per_epoch=len(loader), epochs=epochs
)
scaler = torch.amp.GradScaler('cuda', enabled=(device == "cuda"))
```

I use **AdamW** (not vanilla Adam) for its decoupled weight decay regularization, which consistently outperforms L2 regularization on Adam in practice. The **OneCycleLR** scheduler ramps the learning rate up to `3e-3` over the first ~30% of training, then cosine-anneals it back to near-zero — this is the "super-convergence" regime documented by Smith & Topin (2018), and it genuinely accelerates convergence on small datasets like individual player archives.

**Mixed-precision training** with `torch.amp.autocast` is enabled when a CUDA device is detected, halving memory bandwidth requirements and roughly doubling throughput on modern GPUs via tensor core utilization on FP16 operations.

**Early stopping** is triggered when Top-5 accuracy on the training set reaches the target threshold (default 85%) — the idea being that if the model can place the player's actual move in its top-5 predictions for 85% of positions, the clone is behaviorally saturated and further training risks overfitting to noise.

---

### Inference Sampling & Stockfish Blunder Filtering

Pure behavioral cloning has a dangerous failure mode: the player's training games contain *blunders*. If the network faithfully learns every move the player made, it will also learn to repeat their worst tactical mistakes. The style clone becomes a liability in critical positions.

I designed a **two-stage inference pipeline** in [`engine.py`](engine.py) that separates *style selection* from *tactical safety*:

**Stage 1 — Stockfish Multi-PV Safety Filter**

I run a shallow Stockfish search at depth 10 (~80ms per move) in multi-principal-variation mode to evaluate the top 5 candidate lines. The centipawn threshold filter constructs the safe candidate set $\mathcal{C}$:

$$\mathcal{C} = \left\{ m \in \mathcal{L} \;\middle|\; \text{Eval}(m) \ge \text{Eval}(m_{\text{best}}) - \delta \right\}$$

where $\delta = 150$ centipawns is my blunder threshold. Any move that loses more than 1.5 pawns relative to Stockfish's best is removed from consideration. Moves that walk into forced mate (score $< -50$ pawns) are filtered out unconditionally:

```python
if (best_score - current_score) <= 150 and current_score > -5000:
    safe_candidates.append(move)
```

**Stage 2 — Neural Style Selection over Safe Candidates**

Once $\mathcal{C}$ is constructed, I extract the policy network's raw logits for exactly those moves and apply softmax *only over the safe candidate set* — effectively masking away the unsafe moves and renormalizing:

```python
candidate_indices = [move_to_index(m) for m in safe_candidates]
candidate_logits = torch.tensor([logits[idx].item() for idx in candidate_indices])
probabilities = torch.softmax(candidate_logits, dim=0).tolist()
chosen_move = max(zip(safe_candidates, probabilities), key=lambda x: x[1])[0]
```

The result: the network picks the move from the safe set that the target player would *most likely* choose — preserving their stylistic preferences while preventing catastrophic one-move blunders.

**Confidence logging:** Every move decision is logged with its style match percentage:

```
[Your Clone]: Played e2e4 (Style Match: 73.4%)
```

When Stockfish is unavailable (not found in the project tree), the engine degrades gracefully to pure NN mode — style-accurate but tactically unguarded.

---

## 3. System Architecture & Engineering Flow

### Step 1: Live API Ingestion — Chess.com & Lichess PGN Archives

The [`fetcher.py`](fetcher.py) module handles dual-platform game retrieval:

**Chess.com:** The public API exposes monthly game archives at `https://api.chess.com/pub/player/{username}/games/archives`. I iterate archives in reverse-chronological order (most recent first) and stream individual games through `python-chess`'s PGN parser until I hit the `max_games` cap (default: 500 games). This ensures the model trains on the player's *current* style, not how they played 5 years ago.

**Lichess:** The Ndjson streaming endpoint `https://lichess.org/api/games/user/{username}?max={n}` delivers bulk PGN directly. Since Lichess doesn't paginate by month, the entire batch arrives in a single streaming HTTP response.

All games are written to `data/{username}.pgn` as a clean concatenated PGN file.

### Step 2: Bitboard Tensor Conversion & Dataset Construction

The [`dataset.py`](dataset.py) `ChessPlayerDataset` class parses the PGN, identifies which color the target player was playing in each game, and extracts every board state at the moment it was their turn to move — paired with the move they actually played as the classification target.

The optimized `FastChessDataset` in [`model.py`](model.py) pre-computes the full tensor array into RAM at construction time using NumPy, converting it to a pinned PyTorch tensor for zero-copy GPU transfer during training:

```python
self.x = torch.from_numpy(np.array(self.planes_list, dtype=np.float32))
self.y = torch.tensor(self.targets_list, dtype=torch.long)
```

For 500 games averaging ~40 moves each, this produces ~20,000 training position-move pairs — a modest but sufficient dataset for capturing stylistic biases.

### Step 3: PyTorch Policy Head Fine-Tuning & Weights Cache

Training runs in a background `threading.Thread` spawned by the FastAPI backend so the HTTP server remains responsive during training. Progress is reported via a callback:

```python
progress_callback(f"Clone is {current_pct}% ready", current_pct)
```

These progress updates are polled by the React frontend every 500ms and displayed in the circular SVG progress ring in the `PlayYouModal`. Once training completes, the model's `state_dict` is saved to `models/{username}.pt`. On subsequent requests for the same username, the `.pt` file is detected and the model is loaded directly — bypassing re-training entirely.

The `MirrorEngine` wraps the loaded model with the Stockfish subprocess and holds both in memory in the `LOADED_ENGINES` dictionary for the lifetime of the server process.

### Step 4: WebSocket Bidirectional Engine Communication

The live game session runs over a persistent WebSocket at `/ws/play/{username}`. The protocol I designed is intentionally minimal:

**Client → Server:**
```json
{ "color": "white" }
{ "move": "e2e4" }
```

**Server → Client:**
```json
{ "type": "bot_move", "move": "e7e5", "fen": "rnbqkbnr/..." }
{ "type": "game_over", "result": "1-0", "fen": "..." }
{ "type": "error",     "message": "Clone not ready." }
```

When the player chooses Black, the server plays the first move immediately after the handshake. The `board` state is maintained server-side; the FEN is sent back with every bot move so the client can verify synchronization and recover from any state divergence by calling `game.load(botFen)`.

A critical React implementation detail I had to solve: WebSocket `onmessage` callbacks capture the `game` state from their closure at registration time. If I updated game state via `setGame(newGame)`, the old closure would still reference the stale Chess instance and either replay moves incorrectly or crash. I solved this with a `gameRef`:

```jsx
const gameRef = React.useRef(game);
React.useEffect(() => { gameRef.current = game; }, [game]);
```

All WebSocket message handlers read from `gameRef.current` — always the live, mutated instance — rather than the stale closure-captured state.

### Step 5: React Frontend — Live Board, DiceBear Avatars & Device Persistence

The frontend is a **Vite + React 19** single-page application. The chess logic is handled entirely by `chess.js` v1.4.0 in the browser. The board itself is rendered as a custom SVG component (`Chessboard.jsx`, `ChessPieces.jsx`) — I wrote the piece SVGs as inline React components with gradient fills, avoiding any external asset dependencies.

**Sound design:** I synthesized move feedback sounds entirely through the browser Web Audio API — no external audio files. Three distinct timbres:

- `move`: sine wave `350Hz → 440Hz` over 120ms — a clean digital click
- `capture`: triangle wave `600Hz → 150Hz` over 180ms — a metallic crunch
- `check`: sawtooth wave `440Hz → 880Hz` over 250ms — an urgent alert pulse

**DiceBear Avatars:** Each clone gets a deterministic, reproducible avatar generated by the DiceBear Avataaars API v9. The avatar seed is the player's username (lowercased), and hair/facial-hair presets are selected based on the gender style toggle (♂/◈/♀). The URL is deterministic — the same username always produces the same avatar, so avatars are consistent across sessions without storing any image data.

```js
export function makeDiceBearUrl(username, gender = 'male') {
  const top = HAIR_PRESETS[gender];
  return `https://api.dicebear.com/9.x/avataaars/svg?seed=${username}&top=${top}&...`;
}
```

**localStorage Clone Memory:** Trained bots are persisted in `localStorage` under the key `mirrorchess_device_bots`. Each entry stores username, display name, gender, platform, avatar URL, and last-played timestamp. The saved bots grid in the `PlayYouModal` lets users instantly re-challenge any previously trained clone — which skips re-training entirely since the `.pt` weights are cached server-side.

**Built-in bot personalities:** The sidebar offers three non-clone modes without requiring the backend:

- **Random Bot** — uniform random legal move selection
- **Core AI** — alpha-beta minimax search to depth 3 with piece-square tables (PST) for positional scoring
- **Shadow Clone** — same minimax engine but with boosted position weights (1.3×) and king-attack bonuses when it detects a check opportunity, creating a tactically aggressive personality

The frontend also includes a real-time **evaluation bar** (scored by the minimax engine in clone mode) and a **move history panel** with captured piece tracking.

---

## 4. Engineering Trade-offs & Critical Analysis

I want to be honest about the system's limitations — not to undersell it, but because understanding *where* it breaks is as important as understanding where it works.

### Out-of-Distribution Compounding Error in Novel Endgames

Behavioral cloning fundamentally suffers from **distributional shift at inference time**. The model was trained on the target player's historical game states. When the live game reaches a position that rarely or never appeared in training — complex rook endgames, fortress positions, underpromotion scenarios — the policy network is operating out-of-distribution. Its predictions in these positions are statistically meaningless from the perspective of "what this player would do."

Worse, errors compound: a slightly wrong move leads to a position even further from training distribution, which produces a worse move, which diverges further. This is the **covariate shift / compounding error** problem endemic to imitation learning without online data collection (DAgger-style correction).

The Stockfish safety filter mitigates catastrophic divergence but cannot restore distributional coverage — the clone may still play odd, uncharacteristic moves in deep endgames even if they're tactically sound.

### Single-Ply Decision Context

The current encoder is **single-ply**: the network sees only the current board state, not the sequence of recent moves. A player's intentions are often sequential — they're building toward a plan that spans 5–10 moves. A network with no temporal context cannot learn these plan-level preferences, only position-level move preferences.

A natural extension would be to stack $T$ recent board planes (e.g., the last 8 positions, as AlphaZero does), giving the model $18T$ input channels and a sense of "what trajectory led here." This would dramatically improve clone quality in the middlegame where sequential planning is most critical, at the cost of more complex data preparation and a larger model.

### Balancing Style vs. Tactical Safety

The 150-centipawn blunder threshold $\delta$ is a hyperparameter I set empirically and it represents a fundamental tension: a tighter threshold (e.g., 50 cp) produces a tactically safer clone that plays more engine-like moves; a looser threshold (e.g., 300 cp) allows the clone more stylistic freedom but risks real blunders. There is no principled way to set this without user testing — the "right" value depends on whether you want the clone to mirror personality *or* performance level.

A more sophisticated approach would use the clone's own win probability as the filter criterion (as in AlphaZero's MCTS value head), but that requires training a value network — a significant additional engineering investment.

### Dataset Sparsity on Lower-Rated Players

500 games producing ~20,000 training positions sounds like a lot until you consider that this dataset is spread across thousands of distinct position archetypes. A 1000-rated player's game history will have extremely high variance in position types, meaning the network may see each specific board configuration only once or twice. Higher-rated players (1800+) tend to reach canonical middlegame structures repeatedly, producing denser coverage of the positions that matter most for their style.

Clone quality is non-uniformly distributed across rating ranges — and the system works best for players with 300+ games and consistent opening choices.

---

## 5. Style Accuracy Evaluation

The [`evaluate_style.py`](evaluate_style.py) module provides a rigorous holdout evaluation. I use a strict **80/20 temporal split** — the first 80% of a player's games form the training set, the final 20% (their most recent games) form the unseen test set. This temporal ordering matters: using a random split would cause future positions to "leak" into training, artificially inflating accuracy metrics.

The evaluation reports three metrics across all positions in the test set where it was the target player's turn:

| Metric | Definition |
|:-------|:-----------|
| **Top-1 Exact Match** | The network's argmax prediction exactly matches the move the player played |
| **Top-3 Style Match** | The player's actual move appears in the network's top-3 ranked moves |
| **Top-5 Style Match** | The player's actual move appears in the network's top-5 ranked moves |

Top-5 accuracy is the primary training termination signal (target: ≥85%). Top-1 accuracy of ~30–45% on unseen positions is a realistic expectation for a behavioral clone of this scale — human chess is genuinely stochastic at the individual move level, and even a perfect clone would not achieve 100% Top-1 accuracy because the player themselves doesn't play deterministically.

Run the evaluation against a trained model:

```bash
python evaluate_style.py
```

---

## 6. How to Run & Build

### Prerequisites

- Python 3.10+
- Node.js 20+
- (Optional, strongly recommended) NVIDIA GPU with CUDA 12.x

### Backend Setup

```bash
# 1. Create and activate a virtual environment
python -m venv .venv

# Windows
.venv\Scripts\activate

# macOS / Linux
source .venv/bin/activate

# 2. Install Python dependencies
pip install torch torchvision --index-url https://download.pytorch.org/whl/cu121  # CUDA GPU
# OR for CPU-only:
pip install torch torchvision

pip install fastapi uvicorn python-chess requests numpy

# 3. Place Stockfish binary in the project root (or anywhere under it)
# Download from: https://stockfishchess.org/download/
# The engine auto-discovers any stockfish*.exe recursively in the directory tree

# 4. Start the FastAPI backend
python main.py
# Server starts at http://127.0.0.1:8000
```

### Frontend Setup

```bash
# In a separate terminal, from the project root:
npm install
npm run dev
# Frontend starts at http://localhost:5173
```

### Standalone Training (CLI, no web UI)

```bash
# Train a clone directly from the command line
python trainer_loop.py
# Edit trainer_loop.py to set the target username and platform

# Build the statistical opening book for a trained player
python opening_book.py
```

### Evaluate a Trained Clone

```bash
# Edit evaluate_style.py to point to the correct PGN and .pt paths, then:
python evaluate_style.py
```

### Production Build (Frontend Only)

```bash
npm run build
# Output in dist/ — serve with any static file host (Nginx, Vercel, Cloudflare Pages, etc.)
# The Python backend must still be running separately for clone play mode
```

### Docker Deployment

**`Dockerfile.backend`:**

```dockerfile
FROM python:3.11-slim
WORKDIR /app
COPY . .
RUN pip install --no-cache-dir fastapi uvicorn python-chess requests numpy \
    torch --index-url https://download.pytorch.org/whl/cpu
EXPOSE 8000
CMD ["python", "main.py"]
```

**`Dockerfile.frontend`:**

```dockerfile
FROM node:20-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
RUN npm run build

FROM nginx:alpine
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
```

**`docker-compose.yml`:**

```yaml
services:
  backend:
    build:
      context: .
      dockerfile: Dockerfile.backend
    ports:
      - "8000:8000"
    volumes:
      - ./models:/app/models
      - ./data:/app/data

  frontend:
    build:
      context: .
      dockerfile: Dockerfile.frontend
    ports:
      - "80:80"
    depends_on:
      - backend
```

```bash
docker compose up --build
```

---

## 7. Project File Map

```
mirrorchess/
|
|-- # Python Backend ─────────────────────────────────────────────
|
|-- main.py               FastAPI server: REST training endpoints + WebSocket game sessions
|-- engine.py             MirrorEngine: neural policy + Stockfish guard, move selection
|-- model.py              ChessPolicySE_ResNet, FastChessDataset, train_user_model_to_target
|-- encoder.py            Board -> 18x8x8 tensor, move <-> flat index bijection
|-- fetcher.py            Chess.com + Lichess PGN archive downloader
|-- dataset.py            ChessPlayerDataset: PGN parsing + DataLoader wrapping
|-- opening_book.py       FEN-keyed JSON opening book builder from player PGN history
|-- evaluate_style.py     Top-1/3/5 accuracy evaluator on temporal holdout test set
|-- trainer_loop.py       Standalone CLI training harness + parallel worker thread
|
|-- # Frontend (Vite + React 19) ────────────────────────────────
|
|-- index.html            SPA entry point
|-- vite.config.js        Vite config with React plugin
|-- package.json          Dependencies: react, chess.js, vite, oxlint
|
|-- src/
|   |-- main.jsx          React root mount
|   |-- App.jsx           Root component: game state orchestration, WebSocket lifecycle
|   |-- App.css           Global styles, theme variables, glassmorphic layout
|   |-- index.css         CSS reset + base typography
|   |
|   |-- components/
|   |   |-- Chessboard.jsx      Interactive 8x8 board: square selection, legal move highlights
|   |   |-- ChessPieces.jsx     Inline SVG pieces with gradient fills + SVG defs injector
|   |   |-- EvaluationBar.jsx   Centipawn evaluation bar (vertical, animated)
|   |   |-- GameStatusModal.jsx Checkmate / stalemate / draw overlay with PGN export
|   |   |-- PlayYouModal.jsx    Clone training modal: form view + live SVG progress ring
|   |   |-- PlayYouModal.css    Modal-specific styles
|   |   +-- Sidebar.jsx         Move history, captured pieces, telemetry, bot selector
|   |
|   |-- engine/
|   |   +-- chessEngine.js      Alpha-beta minimax (depth-3), PST evaluation, bot personalities
|   |
|   +-- utils/
|       +-- botStorage.js       localStorage CRUD, DiceBear Avataaars URL generator
|
|-- # Runtime Artifacts (gitignored) ────────────────────────────
|
|-- models/               Trained .pt weight files + JSON opening books (per username)
|-- data/                 Downloaded PGN archives (per username)
+-- stockfish/            Stockfish binary directory
```

---

*Built by Vraj Rabadiya — deep learning engineer, chess player, and person who wanted to understand what playing against myself would actually feel like.*
