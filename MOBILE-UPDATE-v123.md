# Mobile update (v123)

- **AI assistant keyboard**: the chat box and latest messages now stay above the keyboard (also fixed the same way in Messages, marks entry, forms/sheets and Login). See `KeyboardSafe` / `KbView` in `src/ui.js`.
- **Theme switch**: More > Appearance > System / Light / Dark. Saved on the phone. Palettes are in `src/theme.js` (`LIGHT`, `DARK`).
- **Scroll shadows**: the module list in More and the tab strip inside modules fade at the edge where more content is hidden (`ScrollFade` in `src/ui.js`).
- **App permissions**: More > App permissions (`src/screens/Permissions.js`). Shows notifications, push registration, background refresh and battery setting, with Allow / Open settings buttons and "Allow all missing".
- `app.json`: `userInterfaceStyle` is now `automatic` so system dialogs follow the theme. Rebuild the APK once for this to take effect.
