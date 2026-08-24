import os
import requests
import io
import chess.pgn

def fetch_player_games(
    username: str, 
    platform: str = "chesscom", 
    max_games: int = 500, 
    output_dir: str = "data"
) -> str:
    """
    Fetches up to `max_games` (default 500) historical games for a player
    from Chess.com or Lichess and saves them as a single clean .pgn file.
    """
    username = username.strip().lower()
    os.makedirs(output_dir, exist_ok=True)
    pgn_path = os.path.join(output_dir, f"{username}.pgn")

    headers = {
        "User-Agent": "MirrorChess-Pipeline/2.0 (contact: support@mirrorchess.internal)"
    }

    collected_pgns = []
    total_games = 0

    if platform.lower() == "chesscom":
        print(f"[Fetcher] Querying Chess.com archives for '{username}'...")
        archives_url = f"https://api.chess.com/pub/player/{username}/games/archives"
        res = requests.get(archives_url, headers=headers)

        if res.status_code != 200:
            raise ValueError(f"User '{username}' not found on Chess.com (HTTP {res.status_code}).")

        archives = res.json().get("archives", [])
        if not archives:
            raise ValueError(f"No game archives found for '{username}'.")

        # Iterate backwards from the most recent month
        for archive_url in reversed(archives):
            if total_games >= max_games:
                break

            pgn_url = f"{archive_url}/pgn"
            month_res = requests.get(pgn_url, headers=headers)

            if month_res.status_code == 200 and month_res.text.strip():
                # Parse games properly to extract clean individual games
                pgn_io = io.StringIO(month_res.text)
                while total_games < max_games:
                    game = chess.pgn.read_game(pgn_io)
                    if game is None:
                        break
                    
                    collected_pgns.append(str(game))
                    total_games += 1

                print(f"[Fetcher] Collected {total_games}/{max_games} games...")

    elif platform.lower() == "lichess":
        print(f"[Fetcher] Streaming up to {max_games} games from Lichess for '{username}'...")
        lichess_url = f"https://lichess.org/api/games/user/{username}?max={max_games}&clocks=false&evals=false&opening=false"
        res = requests.get(lichess_url, headers=headers, stream=True)

        if res.status_code != 200:
            raise ValueError(f"User '{username}' not found on Lichess (HTTP {res.status_code}).")

        collected_pgns.append(res.text.strip())
        total_games = max_games

    else:
        raise ValueError("Platform must be 'chesscom' or 'lichess'.")

    # Write all games to destination PGN file
    with open(pgn_path, "w", encoding="utf-8") as f:
        f.write("\n\n\n".join(collected_pgns) + "\n")

    print(f"[Fetcher] Saved {total_games} games to {pgn_path}")
    return pgn_path


if __name__ == "__main__":
    import sys
    user = sys.argv[1] if len(sys.argv) > 1 else "tomas_1207"
    fetch_player_games(user, max_games=500)