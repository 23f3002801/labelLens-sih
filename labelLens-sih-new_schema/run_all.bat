@echo off
title LabelLens Unified Launcher
echo ==========================================================
echo     Starting LabelLens Three-Tier Architecture
echo ==========================================================

cd /d "%~dp0"

echo [1/3] Starting Python FastAPI Compute Engine on port 8000...
start "FastAPI Server" cmd /k "cd server && run_server.bat"

timeout /t 3 /nobreak >nul

echo [2/3] Starting Node.js Fastify Orchestrator on port 3000...
start "Fastify Server" cmd /k "cd node-server && npm run dev"

timeout /t 3 /nobreak >nul

echo [3/3] Starting React Vite Frontend on port 5173...
start "Vite Web Client" cmd /k "cd web && npm run dev"

timeout /t 2 /nobreak >nul

start http://localhost:5173/dashboard

echo ==========================================================
echo  All 3 services have launched in separate windows!
echo  - Frontend: http://localhost:5173/dashboard
echo  - Fastify Node API: http://localhost:3000
echo  - FastAPI AI Engine: http://127.0.0.1:8000
echo ==========================================================
