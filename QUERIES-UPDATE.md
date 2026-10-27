# Queries module (new)

1. Run `db/queries-module.sql` once in the Supabase SQL editor (also appended to db/schema.sql).
2. Restart the server, rebuild the client.
3. Tick the new "Queries" permissions on staff profiles (school admins get all automatically):
   add_query, view_queries, update_query, delete_query, manage_query_settings.

Forms (Admission enquiry, General query, Complaint / feedback, Internal query) and statuses
(Pending, In progress, Done, Rejected) are created automatically the first time the module opens.
Admins can add/edit forms (with their own extra questions) and custom statuses under "Forms & statuses".
Every status change/note is kept in the entry's history. Included in backups and audit logs.
Available in both the web app and the mobile app (src/screens/Queries.js).
