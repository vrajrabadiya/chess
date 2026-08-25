import os
import glob
import asyncio
import threading
import chess
import torch
from fastapi import FastAPI, WebSocket, WebSocketDisconnect, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import Optional
from engine import MirrorEngine
from model import train_user_model_to_target

DEVICE = "cuda" if torch.cuda.is_available() else "cpu"
print(f"[System] MirrorChess active on {DEVICE.upper()}")

app = FastAPI(title="MirrorChess Backend")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

LOADED_ENGINES = {}
TRAIN_STATUS = {}


class CloneRequest(BaseModel):
    platform: str = "chesscom"
    username: str
    target_acc: float = 85.0


def run_training_worker(username: str, platform: str, target_acc: float):
    user = username.strip().lower()
    TRAIN_STATUS[user] = {"status": "training", "message": f"Downloading games & training on {DEVICE.upper()}..."}
    try:
        model_path = train_user_model_to_target(
            username=user,
            platform=platform,
            target_top5_acc=target_acc,
            max_epochs=60,
            batch_size=128
        )
        LOADED_ENGINES[user] = MirrorEngine(model_path=model_path, device=DEVICE)
        TRAIN_STATUS[user] = {"status": "ready", "message": "Clone ready to play!"}
        print(f"\n[Training Success]: Clone for '{user}' is ready!\n")
    except Exception as e:
        print(f"\n[Training Failed for '{user}']: {e}\n")
        TRAIN_STATUS[user] = {"status": "error", "message": f"Failed: {str(e)}"}


@app.get("/")
def root():
    return {"status": "running", "device": DEVICE}


@app.post("/api/clone/train")
def train_clone_endpoint(req: CloneRequest):
    user = req.username.strip().lower()
    model_path = os.path.join("models", f"{user}.pt")

    # If already trained, mark ready immediately
    if os.path.exists(model_path):
        if user not in LOADED_ENGINES:
            LOADED_ENGINES[user] = MirrorEngine(model_path=model_path, device=DEVICE)
        TRAIN_STATUS[user] = {"status": "ready", "message": "Clone loaded from disk!"}
        return {"status": "ready", "username": user}

    # If currently training, don't restart
    if TRAIN_STATUS.get(user, {}).get("status") == "training":
        return {"status": "training", "username": user}

    # Start training in a separate thread to keep API responsive
    thread = threading.Thread(
        target=run_training_worker,
        args=(user, req.platform, req.target_acc),
        daemon=True
    )
    thread.start()

    return {"status": "started", "username": user}


@app.get("/api/clone/status/{username}")
def get_clone_status(username: str):
    user = username.strip().lower()
    model_path = os.path.join("models", f"{user}.pt")

    if os.path.exists(model_path) and TRAIN_STATUS.get(user, {}).get("status") != "training":
        if user not in LOADED_ENGINES:
            LOADED_ENGINES[user] = MirrorEngine(model_path=model_path, device=DEVICE)
        return {"status": "ready", "message": "Clone ready to play!"}

    return TRAIN_STATUS.get(user, {"status": "not_started", "message": "Not started yet."})


@app.websocket("/ws/play/{username}")
async def play_chess(websocket: WebSocket, username: str):
    await websocket.accept()
    user = username.strip().lower()
    model_path = os.path.join("models", f"{user}.pt")

    if user not in LOADED_ENGINES:
        if not os.path.exists(model_path):
            await websocket.send_json({"type": "error", "message": f"Clone '{user}' is not ready yet."})
            await websocket.close()
            return
        LOADED_ENGINES[user] = MirrorEngine(model_path=model_path, device=DEVICE)

    engine = LOADED_ENGINES[user]
    board = chess.Board()

    try:
        init_data = await websocket.receive_json()
        user_color = init_data.get("color", "white").lower()

        # If human chose Black, the bot (White) plays move 1
        if user_color == "black":
            bot_move = engine.pick_move(board)
            if bot_move:
                board.push(bot_move)
                await websocket.send_json({
                    "type": "bot_move",
                    "move": bot_move.uci(),
                    "fen": board.fen()
                })

        while not board.is_game_over():
            data = await websocket.receive_json()
            user_move_uci = data.get("move")
            if not user_move_uci:
                continue

            try:
                move_obj = chess.Move.from_uci(user_move_uci)
                if move_obj not in board.legal_moves:
                    continue
                board.push(move_obj)
            except Exception:
                continue

            if board.is_game_over():
                break

            # Clone response
            bot_move = engine.pick_move(board)
            if bot_move:
                board.push(bot_move)
                await websocket.send_json({
                    "type": "bot_move",
                    "move": bot_move.uci(),
                    "fen": board.fen()
                })

        await websocket.send_json({"type": "game_over", "fen": board.fen(), "result": board.result()})
    except WebSocketDisconnect:
        pass


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="127.0.0.1", port=8000, log_level="info")

# Near top of main.py
TRAINING_STATUS = {}

def set_training_progress(username: str, message: str, percent: int):
    TRAINING_STATUS[username.lower()] = {
        "status": "training" if percent < 100 else "ready",
        "message": message,
        "progress": percent
    }

# Inside your train endpoint/background task where train_user_model_to_target is called:
def run_training_job(username: str):
    set_training_progress(username, "Downloading games...", 5)
    model_path = train_user_model_to_target(
        username=username,
        progress_callback=lambda msg, pct: set_training_progress(username, msg, pct)
    )
    LOADED_ENGINES[username.lower()] = MirrorEngine(model_path=model_path, device=DEVICE)
    set_training_progress(username, "Clone is 100% ready", 100)

# Update the status endpoint:
@app.get("/api/clone/status/{username}")
def get_clone_status(username: str):
    user_key = username.lower()
    if user_key in LOADED_ENGINES:
        return {"status": "ready", "message": "Clone is 100% ready", "progress": 100}
    return TRAINING_STATUS.get(
        user_key, 
        {"status": "idle", "message": "Initializing...", "progress": 0}
    )

    

@app.get("/api/clones")
def list_clones():
    """Returns a list of all existing trained bot personas."""
    models = []
    if os.path.exists("models"):
        for file in glob.glob("models/*.pt"):
            username = os.path.splitext(os.path.basename(file))[0]
            models.append({
                "username": username,
                "display_name": username.capitalize(),
                "avatar_url": f"https://images.chesscomfiles.com/uploads/v1/user/{username}.png", # fallback or default avatar
                "ready": True
            })
    return {"clones": models}

@app.post("/api/clone/train")
async def train_clone_endpoint(req: TrainRequest):
    user_key = req.username.lower().strip()
    model_path = os.path.join("models", f"{user_key}.pt")

    # If already trained, return ready immediately
    if os.path.exists(model_path):
        if user_key not in LOADED_ENGINES:
            LOADED_ENGINES[user_key] = MirrorEngine(model_path=model_path, device=DEVICE)
        set_training_progress(user_key, "Clone is 100% ready", 100)
        return {"status": "ready", "cached": True}

    # Otherwise, queue background training
    background_tasks.add_task(run_training_job, user_key)
    return {"status": "training", "cached": False}

class TrainRequest(BaseModel):
    username: str
    platform: Optional[str] = "chess.com"
    max_games: Optional[int] = 500
    