@echo off
setlocal
cd /d "%~dp0"
title Push SQL to Supabase
where node >nul 2>nul || (echo Node.js is not installed. & pause & exit /b 1)
pushd server
call npm install --no-audit --no-fund >nul
call node scripts\db-push.mjs %*
popd
pause
