@echo off
cd /d "%~dp0mobile"
title School Portal Mobile
where node >nul 2>nul
if errorlevel 1 ( echo Install Node.js 18+ from https://nodejs.org first. & pause & exit /b 1 )
call npm install --no-audit --no-fund || ( pause & exit /b 1 )
call npx expo install react react-native expo-status-bar expo-asset expo-constants expo-file-system expo-sharing expo-font expo-keep-awake expo-notifications expo-device react-native-svg expo-document-picker expo-print react-native-webview @react-native-async-storage/async-storage @react-native-community/datetimepicker react-native-safe-area-context || ( pause & exit /b 1 )
call npx expo install --fix
echo.
echo Scan the QR code with the Expo Go app on your phone.
call npx expo start
pause
