# Mobile app: Expo SDK 58 + login fix

The app that runs is the one in the `mobile/` folder (run-mobile.bat does `cd mobile`).
The files of the same name at the top level are an older copy - ignore them.

1. Upgraded from Expo SDK 57 to SDK 58 (expo 58.0.19, react-native 0.88, react 19.3, matching expo-* packages).
   Expo Go from the store (SDK 58) now opens the app.
2. Login fix (mobile/src/api.js): a late "401" from a request that was sent BEFORE you signed in
   no longer signs you out of the fresh session (it used to bounce you back to the login screen).
3. The Queries module is now in mobile/ (it was only in the stale top-level copy before).

How to run (important, once):
  - Delete the old `mobile/node_modules` folder, then run `run-mobile.bat` (it installs everything).
  - Start with a clean cache:  npx expo start -c
  - Update Expo Go on the phone to the latest version.

Queries on mobile: the module appears on the home screen for school admins / super admins right away.
For it to WORK, deploy the new server (it has the /api/queries routes) and run db/queries-module.sql in Supabase.
Staff accounts get the Queries tabs only after the new server is deployed and you tick the Queries permissions for them.

## Global search (web + mobile)
A search bar at the top finds any screen or action (fuzzy: typos, partial words, synonyms). Pick a result to jump there.
If nothing fits, "Ask AI: ..." sends the text to the AI assistant (needs the use_assistant permission).
Web: press "/" or Ctrl/Cmd+K to focus, arrows + Enter to choose.  Files: client/src/search.js, SearchBar.jsx
Mobile: tap the bar under the header.                              Files: mobile/src/search.js, SearchSheet.js
Add synonyms for a screen in the KW list at the top of search.js (keep both copies identical).
