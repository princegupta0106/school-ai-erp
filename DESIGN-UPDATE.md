# Design update (v121)

New look for web and mobile, based on the FleetDesk reference.

- Page background: warm paper `#F4F1EA`; surfaces are white with a hairline `#E4DFD3` border and a soft shadow.
- Text: near-black `#141B22`. Action colour: deep green `#0E5A52`. Highlights: light green `#DFEEE3`.
- Sidebar: navy `#14202A` with a lighter active row. Avatar: soft blue.
- Web has Light (default) and Dark (navy `#11181E`). The old "Forest" theme was removed; anyone who had it saved opens in Light.
- Web: change colours in the first lines of `client/src/styles.css`. Mobile: `src/theme.js` (`C` and `SH`; `mobile/src` is an identical copy).
- Rebuild the web client with `npm run build` in `client/` (run.bat does this). `client/dist` was removed from this zip because it was a stale build.
