# Backup & restore (school admin)

**Where:** new **Backup** module (school admin only, permission `manage_backups`) on web and mobile.

**Create backup** makes two files, saved in your private R2 bucket under `backups/<school_id>/<backup_id>/`:
- `database.json.gz` - one file with every record of the school
- `files.zip` - every file of the school in R2 (`schools/<school_id>/...`: documents, homework, logos)
- `meta.json` - who/when/sizes (this is the **History** list; newest 20 are kept)

Both files can be downloaded from the history list.

**Restore (one click):** press *Restore* on a history entry - database and files are restored together.
Web also has *Restore from downloaded files* (pick the database file + optional files zip).

Safety:
- A safety copy of the current data is saved first (shown in history as "Safety copy"), and if a restore fails half-way the previous data is put back automatically.
- A backup can only be restored into the school it came from.
- Audit logs and phone push tokens are not part of a backup (the audit log is never rolled back).
- Files restore is additive: files in the zip are put back; files added after the backup are not deleted.
- Backup/restore run as background jobs with progress shown on screen; one job per school at a time.

**Deploy:** no database change needed. Run `npm install` in `/server` (new packages: archiver, unzipper, @aws-sdk/lib-storage) and rebuild the web client (`client/dist` is already rebuilt).
