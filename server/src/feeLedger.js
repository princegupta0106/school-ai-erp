// Fee maths with no database in it (so it can be tested alone).  All money is handled in PAISE (whole numbers)
// inside this file, so 20000 / 3 never produces 6666.666...; the API turns it back into rupees.
//
// How a student's fees are worked out
//   1. Every fee item of the class (amount = total for the session) is split into instalments by its payment term:
//        one_time 1 | half_yearly 2 | quarterly 4 | monthly 12   (first one due on the session start date, then evenly spaced)
//   2. Admin adjustments: on a fee item -> that item's total changes (its instalments are re-split);
//      general extra charge -> a new line due on the day it was applied; general discount -> taken off the oldest lines first.
//   3. Payments are lump sums. They are used up against the lines oldest-due first.
//   4. "Due till date" = what is still unpaid on lines whose due date is today or earlier. "Pending" = everything still unpaid.

export const FREQUENCIES = {
  one_time: { label: 'One time', count: 1, every: 12 },
  half_yearly: { label: 'Half yearly', count: 2, every: 6 },
  quarterly: { label: 'Quarterly', count: 4, every: 3 },
  monthly: { label: 'Monthly', count: 12, every: 1 },
};
export const FREQUENCY_KEYS = Object.keys(FREQUENCIES);

export const toPaise = (rupees) => Math.round(Number(rupees) * 100);
export const toRupees = (paise) => paise / 100;

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// 2026-01-31 + 1 month = 2026-02-28 (never spills into March)
export function addMonths(dateStr, n) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const total = (y * 12 + (m - 1)) + n;
  const ny = Math.floor(total / 12), nm = total % 12;
  const last = new Date(Date.UTC(ny, nm + 1, 0)).getUTCDate();
  return `${String(ny).padStart(4, '0')}-${String(nm + 1).padStart(2, '0')}-${String(Math.min(d, last)).padStart(2, '0')}`;
}

// split a total into n parts that add up exactly (the extra paise go to the first parts)
export function splitPaise(total, n) {
  const base = Math.floor(total / n), extra = total - base * n;
  return Array.from({ length: n }, (_, i) => base + (i < extra ? 1 : 0));
}

function instalmentLabel(item, i, due) {
  const f = item.frequency;
  if (f === 'monthly') { const [y, m] = due.split('-').map(Number); return `${item.name} - ${MONTHS[m - 1]} ${y}`; }
  if (f === 'quarterly') return `${item.name} - Quarter ${i + 1}`;
  if (f === 'half_yearly') return `${item.name} - Half ${i + 1}`;
  return item.name;
}

// The instalments of ONE fee item for a total (in paise)
export function itemInstalments(item, totalPaise, sessionStart) {
  const fr = FREQUENCIES[item.frequency];
  if (!fr) throw new Error(`Unknown payment term: ${item.frequency}`);
  return splitPaise(totalPaise, fr.count).map((gross, i) => {
    const due_date = addMonths(sessionStart, i * fr.every);
    return { item_id: item.id, item_name: item.name, label: instalmentLabel(item, i, due_date), due_date, gross, order: item.sort_order ?? 0, index: i };
  });
}

// What one item costs per instalment, for the structure screen
export function describeItem(item) {
  const fr = FREQUENCIES[item.frequency];
  const parts = splitPaise(toPaise(item.amount), fr.count);
  return { count: fr.count, first: toRupees(parts[0]), last: toRupees(parts[parts.length - 1]), even: parts[0] === parts[parts.length - 1] };
}

/**
 * items:        [{id, name, amount, frequency, sort_order}]   the class's fee structure for the session
 * adjustments:  [{id, item_id, amount, reason, applied_on, voided_at}]   signed (negative = discount)
 * payments:     [{amount, status}]  only status 'received' counts
 * session:      {start_date}
 * today:        'YYYY-MM-DD' (school's date)
 */
export function buildLedger({ items, adjustments = [], payments = [], session, today }) {
  const live = adjustments.filter((a) => !a.voided_at);
  const itemAdj = new Map();
  const general = [];
  for (const a of live) {
    if (a.item_id && items.some((i) => i.id === a.item_id)) itemAdj.set(a.item_id, (itemAdj.get(a.item_id) || 0) + toPaise(a.amount));
    else general.push(a); // general, or the item no longer exists
  }

  let structurePaise = 0, itemAdjPaise = 0;
  let lines = [];
  for (const it of items) {
    const base = toPaise(it.amount);
    const adj = itemAdj.get(it.id) || 0;
    const eff = Math.max(0, base + adj);
    structurePaise += base;
    itemAdjPaise += eff - base;
    if (eff > 0) lines.push(...itemInstalments(it, eff, session.start_date));
  }

  // general extra charges become their own lines; general discounts are a credit pool
  let credit = 0, generalChargePaise = 0, generalDiscountPaise = 0;
  for (const a of general) {
    const p = toPaise(a.amount);
    if (p > 0) {
      generalChargePaise += p;
      lines.push({ item_id: null, item_name: null, label: `Extra charge - ${a.reason}`, due_date: a.applied_on, gross: p, order: 1e6, index: 0 });
    } else { credit += -p; }
  }

  lines.sort((a, b) => (a.due_date < b.due_date ? -1 : a.due_date > b.due_date ? 1 : a.order - b.order || String(a.item_name).localeCompare(String(b.item_name)) || a.index - b.index));

  // general discount: used up against the oldest lines first
  const creditAvailable = credit;
  for (const l of lines) {
    const take = Math.min(l.gross, credit);
    l.discount = take; l.net = l.gross - take; credit -= take;
  }
  generalDiscountPaise = creditAvailable - credit; // the part that really reduced something
  // (a discount bigger than everything payable is simply capped)

  const paidPaise = payments.filter((p) => (p.status || 'received') === 'received').reduce((s, p) => s + toPaise(p.amount), 0);
  let left = paidPaise;
  for (const l of lines) {
    l.paid = Math.min(l.net, left); left -= l.paid;
    l.pending = l.net - l.paid;
    l.status = l.pending === 0 ? 'paid' : l.paid > 0 ? 'partial' : l.due_date <= today ? 'due' : 'upcoming';
    l.overdue = l.pending > 0 && l.due_date < today;
  }
  const excess = left; // paid more than payable (only after the structure / adjustments were lowered)

  const totalPayable = lines.reduce((s, l) => s + l.net, 0);
  const pending = lines.reduce((s, l) => s + l.pending, 0);
  const dueNow = lines.filter((l) => l.due_date <= today).reduce((s, l) => s + l.pending, 0);
  const next = lines.find((l) => l.pending > 0 && l.due_date > today);
  const nextDate = next?.due_date || null;
  const nextAmount = nextDate ? lines.filter((l) => l.due_date === nextDate).reduce((s, l) => s + l.pending, 0) : 0;

  const R = toRupees;
  return {
    lines: lines.map((l) => ({
      item_id: l.item_id, label: l.label, due_date: l.due_date, status: l.status, overdue: l.overdue,
      gross: R(l.gross), discount: R(l.discount), amount: R(l.net), paid: R(l.paid), pending: R(l.pending),
    })),
    totals: {
      structure: R(structurePaise), adjustments: R(itemAdjPaise + generalChargePaise - generalDiscountPaise),
      total: R(totalPayable), paid: R(paidPaise), pending: R(pending), due_till_date: R(dueNow),
      excess: R(excess), next_due_date: nextDate, next_due_amount: R(nextAmount),
    },
    paise: { total: totalPayable, paid: paidPaise, pending, dueNow },
  };
}

// which lines a new payment of `amountPaise` would go towards (used for the receipt)
export function allocate(ledger, amountPaise) {
  const out = [];
  let left = amountPaise;
  for (const l of ledger.lines) {
    if (left <= 0) break;
    const pend = toPaise(l.pending);
    if (pend <= 0) continue;
    const take = Math.min(pend, left);
    out.push({ label: l.label, amount: toRupees(take) });
    left -= take;
  }
  return out;
}

// ---- amount in words for the receipt (Indian system)
const ONES = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];
const below100 = (n) => (n < 20 ? ONES[n] : `${TENS[Math.floor(n / 10)]}${n % 10 ? ` ${ONES[n % 10]}` : ''}`);
const below1000 = (n) => `${n >= 100 ? `${ONES[Math.floor(n / 100)]} Hundred${n % 100 ? ' ' : ''}` : ''}${below100(n % 100)}`;
function wholeWords(n) {
  if (n === 0) return 'Zero';
  const parts = [];
  const crore = Math.floor(n / 1e7); n %= 1e7;
  const lakh = Math.floor(n / 1e5); n %= 1e5;
  const thousand = Math.floor(n / 1e3); n %= 1e3;
  if (crore) parts.push(`${wholeWords(crore)} Crore`);
  if (lakh) parts.push(`${below100(lakh)} Lakh`);
  if (thousand) parts.push(`${below100(thousand)} Thousand`);
  if (n) parts.push(below1000(n));
  return parts.join(' ');
}
export function rupeesInWords(rupees) {
  const paise = toPaise(rupees);
  const r = Math.floor(paise / 100), p = paise % 100;
  return `Rupees ${wholeWords(r)}${p ? ` and ${below100(p)} Paise` : ''} Only`;
}
