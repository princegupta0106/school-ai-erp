# Mobile: remaining modules, built one part at a time

The web app has 5 modules the phone app does not have yet. Each part is one module, so nothing is cut short.

| Part | Module | Web source | Status |
|---|---|---|---|
| 1 | Student profile (my + staff search) | StudentProfileModule.jsx | DONE (v503) |
| 2 | Transport (my ride, overview, buses, routes & stops, student assignments) | TransportModule.jsx | DONE (v503.1) |
| 3 | Inventory (overview, items & stock, purchase orders, issue items, stores & vendors, reports) | InventoryModule.jsx | DONE (v505) |
| 4 | Timetable (my, overview, class subjects, class / teacher / school views, auto generate, substitutions, structure) | TimetableModule.jsx | DONE (v506) |
| 5 | Examinations (report cards, exam structure, enter marks, results, analysis, subjects) | ExamModule.jsx | next |
| 6 (small) | Admissions pipeline view | AdmissionsModule.jsx | |

Part 2 reuses `Rides` exported from `src/screens/StudentProfile.js`.
Part 3 added `sharePdfHtml` and `shareTextFile` to `src/download.js` (PDF / CSV through the share sheet) for later parts (report cards, timetables).
