// Reads app.json and switches Firebase on automatically as soon as google-services.json is in this folder.
// (Without that file the app still builds - it just uses the notification-bar fallback instead of real push.)
const fs = require('fs');
const path = require('path');

module.exports = ({ config }) => {
  const hasFirebase = fs.existsSync(path.join(__dirname, 'google-services.json'));
  return {
    ...config,
    android: { ...config.android, ...(hasFirebase ? { googleServicesFile: './google-services.json' } : {}) },
  };
};
