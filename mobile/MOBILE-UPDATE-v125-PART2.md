# Mobile update v125 - Part 2: Transport

New **Transport** module (orange, bus icon), same endpoints and permissions as the web. No server or database change.

- **Parent / student:** "My transport" - each child's route, boarding stop, morning pick-up and afternoon drop, bus, driver and attendant (tap to call).
- **Staff with a transport permission** (`view_transport`, `manage_transport`, `assign_transport`; admins get all):
  - **Overview:** buses / routes / students / free seats tiles, seats ring, "Needs attention" list (full bus, expired documents, route without bus), bus fill bars. First-time setup guide when empty.
  - **Buses:** seats ring, routes, driver and attendant with call buttons, document chips (insurance, fitness, permit, PUC). Add / edit / delete (manage).
  - **Routes & stops:** route cards, then stops in order with up / down / edit / delete and a quick "add stop" form (manage). "Students" jumps to the Students tab filtered to that route.
  - **Students:** class by class, search, filters (everyone / on a bus / not on a bus, class, route). Tap a student to assign, change stop / route, or remove (assign).
- Rules enforced by the server as before (full bus refused, stop or route in use cannot be deleted, seats cannot drop below students).
- Added `OptDate`, `OptTime`, `TimeField` to `src/kit.js` (optional date / time pickers with a clear button) for the next parts.

Files: added `src/screens/Transport.js`; changed `src/kit.js`, `src/modules.js`, `src/search.js`, `MOBILE-PARTS-PLAN.md`, `README.md`.
Run: replace files, `npx expo start -c`, sign out and in once. No APK rebuild needed.
