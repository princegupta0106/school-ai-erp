# Inventory module (new)

1. Run `push-sql.bat` (or `node server/scripts/db-push.mjs`) - applies `db/inventory-module.sql`.
2. Restart the server. School admins get the module automatically; for staff tick the new
   **Inventory** permissions on their profile: view_inventory, manage_inventory, manage_purchase_orders, issue_inventory.

Web screens: Overview, Items & stock (bulk add), Purchase orders (approve, GRN receive, close), Issue items
(receipt print, returns), Stores & vendors, Reports (print / Excel CSV). Fully responsive (cards on phones, tables on desktop).
Server: `server/src/routes/inventory.js` (/api/inventory). Included in audit log and backups.
Mobile (Expo) app: not included in this update.
