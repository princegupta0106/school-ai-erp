# Payroll: salary entry and staff reports

Leave and finance stay separate modules. The leave system is unchanged.
This update only touches the Payroll & Leave > Payroll screen and its server routes.

## Where to set salary
Payroll & Leave > Payroll > **Staff salaries (monthly)**.
- Lists every active staff member with their monthly salary.
- "Set salary" / "Change" opens a small form. Empty clears the salary.
- Needs the "Run payroll" permission (`payroll_manage`), or "See & edit salary" (`manage_salary`) through the API.
- The same salary field is still editable in Users. Both write the same value.
- Salary changes are not written to the activity log (salary figures are never logged).
- Changing a salary changes draft payslips only after you press "Prepare / refresh".

## Reports (Payroll screen, pick the month first)
- **Attendance register (Excel / CSV):** one row per person, one column per day
  (P present, L paid leave, LWP unpaid leave, H half-day leave, O weekly off / holiday), then working days, present days, leave days, unpaid leave days.
- **Attendance summary (PDF):** totals per person, leave split by leave type.
- **Salary register (Excel / CSV and PDF):** salary, present days, leave days, leave cut, bonus, other deductions, net pay and status.

How present days are worked out: working days (weekly offs and school holidays excluded) minus approved leave.
A half day counts as half present. The current month counts only up to today.
Finalized and paid months show the saved payslip figures. Months not yet prepared show an estimate marked "not prepared".

Staff have no daily attendance register; any working day with no approved leave is counted as present.

## Routes added (server/src/routes/payroll.js)
- PUT  /api/payroll/employees/:uid/salary
- GET  /api/payroll/reports/attendance?period=YYYY-MM&format=csv|pdf
- GET  /api/payroll/reports/salary?period=YYYY-MM&format=csv|pdf
- GET  /api/payroll/employees now also works for `manage_salary`.

No database changes are needed.
