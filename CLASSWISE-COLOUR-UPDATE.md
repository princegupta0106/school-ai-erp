# Transport students, class-wise lists, colourful modules (web)

## Transport > Students (rebuilt)
- Shows EVERY active student of the school, grouped class by class (Nursery, LKG, UKG, 1, 2 ... 12, then "No class").
- Top cards: all students / on a bus / not on a bus (tap one to filter). Search, class and route filters, and an Everyone / On a bus / Not on a bus switch.
- Tap any student: a panel opens where you can **assign a bus** (route + stop), **change** the route or stop of an existing ride, **remove** a ride, or **add another route**. Same rules as before (full bus is refused, one seat per bus, etc.).
- Users with only `view_transport` see the same list read-only.
- Server: new `GET /api/transport/students` (`listStudents` in `server/src/transport.js`).

## Students are shown class-wise everywhere
Shared helper in `client/src/ui.jsx` (`groupByClass`, `ClassGroup`, `classRank`): collapsible, colour-coded class sections in school order.
Now used in: Transport > Students, Student profiles, Fees > Student fees, Users (Student filter), Documents > Issue document (student picker), and the parent "add a student" picker in Users (grouped by class).
Attendance, Marks and Homework were already class-wise.
- Student profiles and Fees lists no longer stop at 50 students (up to 3000).

## Every module has its own colour (calm version)
Each module's colour (from `registry.js`) tints the page title, active tab, primary button, icon tiles, avatars, badges, table headers and focus rings. Cards stay flat and white.
There are no coloured side lines, top bars, gradient cards or decorative circles anywhere (the old ones on class cards, notices, stats, routes, rides, student profile cards and the sidebar were removed). Class cards show their status as a soft tint instead.
To change a module's colour edit `color:` in its `registry.js` entry. The styles are at the end of `client/src/styles.css`.

## Run
No database change. Restart the server, then `client/dist` is already rebuilt (run.bat also rebuilds it). The mobile app is unchanged.
