# Transport module (web)

Buses, routes, stops and which student rides where. Colourful, and always the same simple rules.

## Set up in 3 steps (tabs go left to right)
1. **Buses** - name, number plate, seats, driver / attendant, and expiry dates for insurance, fitness, permit and PUC.
2. **Routes & stops** - a route has a zone, one-way / two-way travel, ONE bus, and ordered stops with pick-up / drop times. Use the arrows to reorder stops.
3. **Students** - "Add student": search, pick the route, pick the stop. After saving, route and stop stay selected so a whole stop can be added quickly.

**Overview** shows buses, routes, students and free seats, a seats ring, each bus's fill bar, and a "Needs attention" list (bus full / almost full, document expired or expiring in 30 days, route without a bus or stops, bus without a route).

## Rules (so nothing surprises you)
- A bus can never carry more students than its seats. Adding a student to a full bus is refused with a clear message.
- A student on two routes of the same bus uses ONE seat. A student can ride several routes, each only once.
- A bus can't be given fewer seats than the students it carries.
- A stop that students use, or a route that has students, can't be deleted until they are moved or removed.
- Deleting a bus keeps its routes (they just show "No bus yet").

## Who sees what
- `view_transport` - see everything (read only).
- `manage_transport` - add / edit / delete buses, routes and stops.
- `assign_transport` - put students on routes and stops.
- `view_my_transport` - parents and students (automatic): "My transport" shows the child's route, stop, morning pick-up and afternoon drop times, bus number plate and the driver / attendant (tap to call).
- School admins and the super admin get everything. Give staff access under Users > feature access, then ask them to sign out and in once.
- The student 360 profile gets a **Transport** card (family always; staff with a transport permission).

## What was added
- `db/transport-module.sql` (4 tables, safe to re-run; `run.bat` pushes it by itself).
- `server/src/transport.js`, `transportLogic.js`, `routes/transport.js`; registered in `index.js`, `features.js`, `audit.js` (readable audit lines) and `backup.js` (included in backup / restore).
- `client/src/modules/TransportModule.jsx`, `.tr-*` styles at the end of `styles.css`, entries in `registry.js`, `search.js`, a bus icon in `ui.jsx`, and the profile card in `StudentProfileModule.jsx` / `studentProfile.js`.
- Test: `server/test/transport-logic.test.js` (runs with `npm test` in /server).

## Not in this first version
GPS / live location, parent alerts, fuel and maintenance logs, transport fees, and the mobile app.

## Run
Run `run.bat` (it pushes the SQL, rebuilds the web app and starts the server), then sign out and in once.
