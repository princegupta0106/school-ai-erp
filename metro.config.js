// Use Expo's default Metro config (keeps Metro versions aligned with the installed Expo SDK).
const { getDefaultConfig } = require('expo/metro-config');
module.exports = getDefaultConfig(__dirname);
