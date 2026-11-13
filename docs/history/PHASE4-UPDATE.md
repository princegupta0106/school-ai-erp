# Phase 4
1. Fees > Student fees: "Send reminder" button (needs collect_fees + send_notification). Pick a class or "All with dues", see how many students owe, edit the prefilled message, confirm, send via POST /notifications/send (same API as Send notification).
2. Home "Today" card (c-today, removable/orderable via Customize home). Tiles are hidden without permission or if their endpoint fails:
   - Attendance not marked: GET /attendance/classes (state = not_marked)
   - Collected today: GET /fees/payments?period=today (summary.total)
   - Total dues: GET /fees/pending (summary.total_pending)
   - Pending leave: GET /payroll/leave?status=pending
   - New enquiries: GET /admissions/summary (by_stage.new)
   - Open queries: GET /queries?open=1 (total)
3. Pull-to-refresh on Home (re-fetches everything on screen + notifications); skeleton placeholders for Today card, summary strip and dashboard cards.
