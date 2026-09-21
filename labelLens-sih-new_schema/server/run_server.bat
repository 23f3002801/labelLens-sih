@echo off
title LabelLens - Python FastAPI Compute Server (Port 8000)
cd /d "%~dp0"
echo =========================================================
echo Starting Python FastAPI Engine on http://127.0.0.1:8000
echo =========================================================

if exist "%APPDATA%\uv\python\cpython-3.11-windows-x86_64-none\python.exe" (
    set "PYTHONPATH=%~dp0.venv\Lib\site-packages;%PYTHONPATH%"
    "%APPDATA%\uv\python\cpython-3.11-windows-x86_64-none\python.exe" -m uvicorn main:app --host 127.0.0.1 --port 8000 --reload
) else if exist ".venv\Scripts\python.exe" (
    ".venv\Scripts\python.exe" -m uvicorn main:app --host 127.0.0.1 --port 8000 --reload
) else (
    python -m uvicorn main:app --host 127.0.0.1 --port 8000 --reload
)
pause
