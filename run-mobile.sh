#!/usr/bin/env bash
cd "$(dirname "$0")/mobile"
command -v node >/dev/null || { echo "Install Node.js 18+ first"; exit 1; }
npm install --no-audit --no-fund && npx expo install react react-native expo-status-bar expo-asset expo-constants expo-file-system expo-sharing expo-font expo-keep-awake expo-notifications expo-device react-native-svg expo-document-picker expo-print react-native-webview @react-native-async-storage/async-storage @react-native-community/datetimepicker react-native-safe-area-context && npx expo install --fix && npx expo start
