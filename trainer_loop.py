import os
import threading
import torch
from model import train_user_model_to_target

DEVICE = "cuda" if torch.cuda.is_available() else "cpu"
TARGET_ACC = 85.0

def run_targeted_trainer(username: str = "tomas_1207", platform: str = "chesscom"):
    print(f"[Target Trainer] Starting full GPU acceleration on {DEVICE.upper()} for '{username}'...")
    try:
        train_user_model_to_target(
            username=username,
            platform=platform,
            target_top5_acc=TARGET_ACC,
            max_epochs=100,
            batch_size=128
        )
        print(f"[Target Trainer] '{username}' has achieved {TARGET_ACC}% accuracy and is now locked and ready to play!")
    except Exception as e:
        print(f"[Target Trainer Error] {e}")

def start_parallel_worker(username: str = "tomas_1207"):
    thread = threading.Thread(target=run_targeted_trainer, args=(username,), daemon=True)
    thread.start()
    return thread

if __name__ == "__main__":
    run_targeted_trainer()