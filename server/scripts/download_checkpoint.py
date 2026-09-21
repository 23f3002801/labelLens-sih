"""Download the SAM 2.1 Hiera Large checkpoint required by the label-mask
unwrap pipeline (services/video_processing.py).

Stdlib only — safe to run before/independent of the torch/sam2 install:

    cd server
    python scripts/download_checkpoint.py            # skip if already present
    python scripts/download_checkpoint.py --force    # re-download
"""

import sys
import urllib.request
from pathlib import Path

CHECKPOINT_URL = "https://dl.fbaipublicfiles.com/segment_anything_2/092824/sam2.1_hiera_large.pt"
SERVER_DIR = Path(__file__).resolve().parents[1]
CHECKPOINT_PATH = SERVER_DIR / "checkpoints" / "sam2.1_hiera_large.pt"


def report_progress(blocks_done: int, block_size: int, total_size: int) -> None:
    done_mb = blocks_done * block_size / (1024 * 1024)
    total_mb = total_size / (1024 * 1024)
    percent = min(100.0, done_mb * 100 / total_mb) if total_mb else 0.0
    sys.stdout.write(f"\r  {done_mb:8.1f} / {total_mb:.1f} MB ({percent:5.1f}%)")
    sys.stdout.flush()


def main() -> int:
    if "--force" not in sys.argv and CHECKPOINT_PATH.exists():
        size_mb = CHECKPOINT_PATH.stat().st_size / (1024 * 1024)
        print(f"Checkpoint already present: {CHECKPOINT_PATH} ({size_mb:.1f} MB). Use --force to re-download.")
        return 0

    CHECKPOINT_PATH.parent.mkdir(parents=True, exist_ok=True)
    partial_path = CHECKPOINT_PATH.with_suffix(CHECKPOINT_PATH.suffix + ".part")
    print(f"Downloading {CHECKPOINT_URL}")
    print(f"        to {CHECKPOINT_PATH}")
    try:
        urllib.request.urlretrieve(CHECKPOINT_URL, partial_path, report_progress)
    except (urllib.error.URLError, OSError) as error:
        print(f"\nDownload failed: {error}")
        partial_path.unlink(missing_ok=True)
        return 1

    partial_path.replace(CHECKPOINT_PATH)
    size_mb = CHECKPOINT_PATH.stat().st_size / (1024 * 1024)
    print(f"\nDone: {CHECKPOINT_PATH} ({size_mb:.1f} MB)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
