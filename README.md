> **Design:** `DESIGN-STANDARD.md` is the single source of truth for UI. QA: `QA-CHECKLIST.md`. Old notes: `docs/history/`.

# School Portal – mobile (Expo)
Done so far: Home dashboard, Users (list, add, classes), Payroll & Leave, Communication, Attendance, Academics, Fees, Homework, Visitors, Audit logs, School. Run `run-mobile.bat` (or `./run-mobile.sh`), scan the QR with Expo Go.
The app calls the hosted API at https://school-ai-erp.onrender.com (change it in `mobile/.env` -> EXPO_PUBLIC_API_URL, then restart Expo).
