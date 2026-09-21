#!/usr/bin/env bash
# LabelLens Unified Launcher for Git Bash / WSL / Linux
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT_DIR"

echo "=========================================================="
echo "    🚀 Starting LabelLens Three-Tier Architecture"
echo "=========================================================="

# Cleanup child processes on exit (Ctrl+C)
cleanup() {
    echo ""
    echo "🛑 Shutting down all LabelLens services..."
    kill $(jobs -p) 2>/dev/null
    exit 0
}
trap cleanup SIGINT SIGTERM EXIT

# 1. Start Python FastAPI Compute Engine
echo "▶ [1/3] Launching Python FastAPI Compute Engine on http://127.0.0.1:8000 ..."
(
    cd "$ROOT_DIR/server"
    bash ./run_server.sh
) &
PID_FASTAPI=$!

# Wait a brief moment for FastAPI to initialize
sleep 2

# 2. Start Fastify Node.js Server
echo "▶ [2/3] Launching Node.js Fastify Orchestrator on http://localhost:3000 ..."
(
    cd "$ROOT_DIR/node-server"
    npm run dev
) &
PID_NODE=$!

# Wait for Node server
sleep 2

# 3. Start React Vite Frontend
echo "▶ [3/3] Launching React Vite Frontend on http://localhost:5173 ..."
(
    cd "$ROOT_DIR/web"
    npm run dev
) &
PID_WEB=$!

echo ""
echo "=========================================================="
echo "  ✅ All 3 services are running:"
echo "     - Frontend: http://localhost:5173/dashboard"
echo "     - Node.js API: http://localhost:3000"
echo "     - FastAPI Compute: http://127.0.0.1:8000"
echo "=========================================================="
echo "Press Ctrl+C to stop all servers."
echo ""

# Keep running until Ctrl+C
wait
