# Admissions module (SchoolPad-style) - update

Nothing old was removed. The existing **Queries** and **Visitors** modules still work as before.

## What's new
- **Overview**: enquiries, follow-ups due today / overdue, applications in progress, admissions, conversion funnel, source performance.
- **Enquiries**: search, filters (due today, overdue, stage, class, source), CSV export, one tap to open the full record.
- **Pipeline** (web): board with New, Contacted, Pending documents, Shortlisted, Admitted.
- **Enquiry record**: call / WhatsApp, log a call, visit or note, set the next follow-up, move stage, edit, reject with a reason, full history.
- **Admit student**: creates the student profile (class, roll no., admission no. ADM/2026/0001) and an optional linked parent login from the enquiry. Sign-in details are shown once.
- **Reports**: funnel, drop-off reasons, source performance, locality analysis.

## Install (3 steps)
1. Supabase -> SQL editor -> run `db/admissions-module.sql` (safe to re-run).
2. Deploy the `server` folder (new `server/src/routes/admissions.js`; small edits in `features.js`, `audit.js`, `index.js`).
3. Rebuild the web client (`cd client && npm run build`) and rebuild the mobile app (`mobile/`).

## Permissions
New "Admissions" group in each user's access list: `add_enquiry`, `view_enquiries`, `update_enquiry`, `admit_student`, `delete_enquiry`, `view_admission_reports`. School admins get all of them automatically; tick them for staff such as the office clerk.

## Not done yet (next steps)
Public online enquiry form + QR code, automatic WhatsApp / SMS reminders, AI-assistant commands for admissions, and the root-level `src/` + `App.js` copy of the mobile app (the update is in `mobile/`).
