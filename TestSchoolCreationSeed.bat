@echo off
setlocal
cd /d "%~dp0"
title Test school seed
where node >nul 2>nul
if errorlevel 1 ( echo Node.js is not installed. Get it from https://nodejs.org & pause & exit /b 1 )
if not exist ".env" ( echo .env is missing in this folder. & pause & exit /b 1 )
pushd server
if not exist node_modules ( echo Installing server packages... & call npm install --no-audit --no-fund )
echo Applying database SQL files...
call node scripts\db-push.mjs
echo.
echo Creating the test school...
call node scripts\seed-test-school.mjs
popd
echo.
pause
