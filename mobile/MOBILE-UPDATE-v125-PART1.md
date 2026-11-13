# Mobile update v125 - Part 1: Student profile + design standard

## New
- **Student profile** module (pink, "Student profile" on Home / More).
  - Student / parent: own profile; several children get a switcher.
  - Staff / admin: search by name, roll no. or ID, grouped by class, tap to open. Super admin picks a school first.
  - Profile: header with automatic chips (Regular, Top performer, Fee due...), 4 tap-able headline tiles, then sections: Attendance (ring + monthly bars + recent absences), Marks (per subject + exams, session switcher), Fees (only if allowed), Homework, Family (call buttons), Documents, Transport.
  - Same endpoints and permissions as the web (`/student-profile/my`, `/search`, `/:id`). No server or database change.
- **`src/kit.js`**: the one shared design kit for all remaining modules. Rules in `DESIGN-SYSTEM-MOBILE.md`.
- Icons `profile` and `bus` added.
- Search bar (`src/search.js`) knows the new module.

## Files
- added `mobile/src/kit.js`, `mobile/src/screens/StudentProfile.js`, `mobile/DESIGN-SYSTEM-MOBILE.md`, `mobile/MOBILE-PARTS-PLAN.md`
- changed `mobile/src/modules.js`, `mobile/src/icons.js`, `mobile/src/search.js`

## Run
Replace the files, then `npx expo start -c`. Sign out and in once if the module does not appear (permissions refresh at login). No APK rebuild is needed for this part.
Note: the stale copy of the app at the zip root (`App.js`, `src/`) is untouched; `mobile/` is the real app.
