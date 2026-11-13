# Mobile update v125 - Part 3: Inventory

New **Inventory** module (green, box icon), same endpoints and permissions as the web (`/api/inventory`). No server or database change.

Views (shown by permission: `view_inventory`, `manage_inventory`, `manage_purchase_orders`, `issue_inventory`):
- **Overview:** items / categories / vendors / low-stock tiles (tap to jump), quick actions, stock summary with value, stock by category bars, "Needs attention" low / out items, purchase order counts and recent orders, recent issues.
- **Items & stock:** search, in / low / out filter tiles, store and category filters, item list with stock and status. Add item, **Add many** (paste "name, stock, unit, reorder, rate" lines), tap an item to edit or delete (manage). Stock only changes by a typed correction, like the web.
- **Purchase orders:** search and status filter, order list. New order (vendor, date, items with quantity and rate, "Fill with low-stock items"). Order screen: approve, **receive items (GRN)** with per-line quantities that add to stock, close, cancel, goods-received history, call vendor.
- **Issue items:** New issue to a student / staff member (search) or a typed name / department, items checked against stock, receipt list with search. Receipt screen: **Share receipt (PDF)** and **Take items back** (returns go back into stock).
- **Stores & vendors:** add / edit / delete stores, categories (with store) and vendors (category, phone, email, address, tap to call).
- **Reports:** Stock (store / category / type / low-only filters, count and value) and Issued & returned (from / to dates). Share as **PDF** or export **CSV** through the phone share sheet.

Phone-friendly: no wide tables. Everything is a list or card; long lists show 60 rows then "Show more"; the item chooser opens a small search list inside the form.

Rules are enforced by the server as before (no stock below zero, approve before receive, cannot receive more than ordered, cannot return more than issued, items with orders cannot be deleted).

Files: added `src/screens/Inventory.js`; changed `src/modules.js`, `src/search.js`, `src/icons.js` (new `box` icon), `src/download.js` (new `sharePdfHtml`, `shareTextFile`), `MOBILE-PARTS-PLAN.md`, `README.md`.
Run: replace files, `npx expo start -c`, sign out and in once. No APK rebuild needed (expo-print, expo-sharing and expo-file-system are already installed).
