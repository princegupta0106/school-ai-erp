# Update v28

1. Run `db/user-id-prefix.sql` once in the Supabase SQL editor (adds `schools.id_prefix`).
2. Restart the server, then rebuild the web app (`cd client && npm run build`). Mobile: restart / rebuild the app.

## What changed
- School list (web + mobile): shows only the school name.
- School logo: upload a picture (new `POST/DELETE /schools/:id/logo`); no more URL box.
- User IDs are automatic: 2-letter school prefix + lowest free 3-digit number (AF001, AF002 ...). Never reuses an ID that exists. School admin created with a school gets the first ID.
- Roll no. is automatic (next free number in the class, also when a student changes class). Field removed.
- Red * on every mandatory field (web + mobile). Added rules: full name always required; class required for students; admin name required for a new school.
