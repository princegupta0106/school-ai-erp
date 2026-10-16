# Mobile update (v124)

Both options now live in **More** (bottom tab > More) in the real app folder `mobile/`.

- **Theme**: More > APPEARANCE > System / Light / Dark. Saved on the phone and applied instantly everywhere. "System" follows the phone's own light/dark setting.
- **App permissions**: More > App permissions. Shows every permission the app has:
  - *Needs your approval* (live status + Allow / Open settings buttons): notifications, instant push alerts, background refresh, battery setting. "Allow all missing permissions" grants everything that can be asked in-app.
  - *Allowed automatically when installed* (information only): internet, files and documents (system picker only), vibration, keep-awake, start after restart.
  - A note that the app never uses camera, microphone, location, contacts or SMS.
- Fix: the theme and permissions screens existed only in a stray copy at the zip root (`App.js`, `src/`); the `mobile/` folder that run-mobile and EAS build from did not have them. `mobile/` now has them, the root copy is kept identical.
- Also fixed: "Cancelled" pill in Documents is now theme-aware; the More sheet scales to small screens so the extra rows never push content off-screen.
- `mobile/app.json`: `userInterfaceStyle` is `automatic` (was `light`) so system dialogs follow the theme. **Rebuild the APK once** for this to take effect (see BUILD-APK.md). Expo Go picks up everything else on reload.

## v124.1 fix
Expo Go showed "property is not configurable" and the app hung on the splash screen. `live()` in `src/theme.js` now returns a frozen object so React Native's dev-mode style freezing skips it. Theme switching still updates live. Restart Expo with `npx expo start -c` after replacing the files.
