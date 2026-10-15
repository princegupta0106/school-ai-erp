@echo off
setlocal
cd /d "%~dp0"
title School Portal

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is not installed. Get it from https://nodejs.org ^(v18 or newer^) and run this again.
  pause & exit /b 1
)
if not exist ".env" (
  echo .env is missing. Copy .env.example to .env and fill it in.
  pause & exit /b 1
)

echo.
echo [1/3] Installing server packages...
pushd server
call npm install --no-audit --no-fund || (popd & pause & exit /b 1)
popd

echo.
echo [2/3] Building the web app...
pushd client
call npm install --no-audit --no-fund || (popd & pause & exit /b 1)
call npm run build || (popd & pause & exit /b 1)
popd

echo.
echo [3/3] Starting...

rem ---- AI assistant: a small Python service (ai-server/) that the portal talks to. Needs Python 3.8+, no pip packages.
set "PY="
where python >nul 2>nul && set "PY=python"
if not defined PY ( where py >nul 2>nul && set "PY=py -3" )
if defined PY (
  echo Starting the AI service in its own window ^(http://127.0.0.1:8001^)...
  start "School AI service" cmd /k "%PY% ai-server\server.py"
) else (
  echo Python is not installed, so the AI assistant is switched off. Get Python 3.8+ from https://www.python.org/downloads/ ^(tick "Add python.exe to PATH"^) and run this again.
)

echo Portal on http://localhost:3000  (Ctrl+C to stop)
start "" http://localhost:3000
pushd server
call npm start
popd
pause
