#!/usr/bin/env bash
# LabelLens - Python FastAPI Compute Server Launcher for Git Bash / MinGW
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

echo "========================================================="
echo "Starting Python FastAPI Engine on http://127.0.0.1:8000"
echo "========================================================="

# Windows AppLocker policy blocks executables in Desktop/.venv/Scripts
# We use the system-approved uv-managed Python 3.11 with the project's site-packages
WIN_SITE_PACKAGES="$(cygpath -w "$SCRIPT_DIR/.venv/Lib/site-packages" 2>/dev/null || echo "$SCRIPT_DIR\\.venv\\Lib\\site-packages")"
export PYTHONPATH="$WIN_SITE_PACKAGES"

UV_PYTHON="$APPDATA/uv/python/cpython-3.11-windows-x86_64-none/python.exe"

if [ -f "$UV_PYTHON" ]; then
    "$UV_PYTHON" -m uvicorn main:app --host 127.0.0.1 --port 8000 --reload
elif [ -f ".venv/Scripts/python.exe" ]; then
    ./.venv/Scripts/python.exe -m uvicorn main:app --host 127.0.0.1 --port 8000 --reload
else
    python -m uvicorn main:app --host 127.0.0.1 --port 8000 --reload
fi
