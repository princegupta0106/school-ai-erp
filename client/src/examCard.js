// Builds the printable, colourful report card (one or many) as a standalone HTML page.
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const tone = (p) => (p === null || p === undefined ? '#94a3b8' : p >= 75 ? '#059669' : p >= 60 ? '#2563eb' : p >= 40 ? '#d97706' : '#dc2626');
const fmtN = (n) => (n === null || n === undefined ? '-' : Number.isInteger(Number(n)) ? String(Number(n)) : String(Math.round(Number(n) * 100) / 100));
const fmtD = (d) => (d ? new Date(d).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : '');

function oneCard(c) {
  const exams = c.exams || [];
  const sub = c.subjects.map((s, i) => `<tr><td>${i + 1}</td><td><b>${esc(s.name)}</b></td>
    ${exams.map((e, k) => { const p = s.cells?.[k]; return `<td class="c">${p ? (p.absent ? 'AB' : `${fmtN(p.marks)}`) : '-'}</td>`; }).join('')}
    <td class="c"><b>${s.max ? `${fmtN(s.total)} / ${fmtN(s.max)}` : '-'}</b></td>
    <td class="c">${s.pct === null ? '-' : `${s.pct}%`}</td>
    <td class="c">${s.grade ? `<span class="g" style="background:${tone(s.pct)}">${esc(s.grade)}</span>` : '-'}</td></tr>`).join('');
  const resCol = c.result === 'Pass' ? '#059669' : c.result === 'Fail' ? '#dc2626' : '#d97706';
  const resTxt = c.result === 'Pending' ? 'In progress' : c.result;
  return `<section class="page">
  <header><div class="logo">${c.school.logo_url ? `<img src="${esc(c.school.logo_url)}" alt="">` : esc((c.school.name || 'S')[0])}</div>
    <div class="sn"><h1>${esc(c.school.name)}</h1><p>${esc([c.school.address, c.school.phone, c.school.email].filter(Boolean).join(' · '))}</p></div>
    <div class="tt"><span>REPORT CARD</span><b>${esc(c.session?.name || c.class.label)}</b></div></header>
  <div class="stud">
    <div><small>Student</small><b>${esc(c.student.name)}</b></div><div><small>Class</small><b>${esc(c.class.label)}</b></div>
    <div><small>Roll no.</small><b>${esc(c.student.roll_no ?? '-')}</b></div><div><small>Admission no.</small><b>${esc(c.student.admission_no || '-')}</b></div>
    <div><small>Father</small><b>${esc(c.student.father_name || '-')}</b></div><div><small>Mother</small><b>${esc(c.student.mother_name || '-')}</b></div>
    <div><small>Date of birth</small><b>${esc(fmtD(c.student.dob) || '-')}</b></div><div><small>Attendance</small><b>${c.attendance?.pct != null ? `${c.attendance.pct}% (${c.attendance.present}/${c.attendance.total})` : '-'}</b></div></div>
  <table class="sub"><thead><tr><th>#</th><th>Subject</th>${exams.map((e) => `<th class="c">${esc(e.name)}<span class="mx">/${fmtN(e.max_marks)}</span></th>`).join('')}<th class="c">Total</th><th class="c">%</th><th class="c">Grade</th></tr></thead><tbody>${sub}</tbody></table>
  <div class="sum">
    <div class="box" style="--c:#4f46e5"><small>Total marks</small><b>${fmtN(c.total)} / ${fmtN(c.max)}</b></div>
    <div class="box" style="--c:#0891b2"><small>Percentage</small><b>${c.pct ?? '-'}%</b></div>
    <div class="box" style="--c:#7c3aed"><small>Overall grade</small><b>${esc(c.grade || '-')}</b></div>
    <div class="box" style="--c:#db2777"><small>Class rank</small><b>${c.rank ? `${c.rank} / ${c.class_size}` : '-'}</b></div>
    <div class="box" style="--c:${resCol}"><small>Result</small><b>${esc(resTxt)}</b></div></div>
  ${c.grade_remark || c.remarks?.length ? `<div class="rem"><b>Remarks</b> ${c.grade_remark ? `<span class="rc">${esc(c.grade_remark)}</span>` : ''} ${(c.remarks || []).map((r) => `<div>• <i>${esc(r.subject)}:</i> ${esc(r.text)}</div>`).join('')}</div>` : ''}
  <div class="key"><b>Grading key</b> ${c.grading.map((g) => `<span>${esc(g.grade)} ${g.min_pct}-${Math.floor(g.max_pct)}%</span>`).join('')}</div>
  <footer><div>Class teacher</div><div>Parent / guardian</div><div>Principal</div></footer>
</section>`;
}

export function cardsHtml(cards) {
  return `<!doctype html><html><head><meta charset="utf-8"><title>Report cards</title><style>
  *{box-sizing:border-box}body{margin:0;background:#eef0f7;font-family:Inter,Segoe UI,Arial,sans-serif;color:#1e1b3a;font-size:13px}
  .page{width:210mm;min-height:297mm;margin:12px auto;background:#fff;padding:12mm;border-radius:10px;box-shadow:0 4px 20px rgba(30,27,58,.12);page-break-after:always;position:relative;overflow:hidden}
  .page:before{content:"";position:absolute;inset:0 0 auto 0;height:8px;background:linear-gradient(90deg,#4f46e5,#06b6d4,#10b981,#f59e0b,#ec4899)}
  header{display:flex;align-items:center;gap:14px;padding:10px 0 12px;border-bottom:2px solid #e7e8fc}
  .logo{width:54px;height:54px;border-radius:14px;background:linear-gradient(135deg,#4f46e5,#06b6d4);color:#fff;display:grid;place-items:center;font-size:26px;font-weight:700;overflow:hidden}.logo img{width:100%;height:100%;object-fit:contain;background:#fff}
  .sn{flex:1}.sn h1{margin:0;font-size:20px;color:#312e81}.sn p{margin:2px 0 0;color:#64748b;font-size:11.5px}
  .tt{text-align:right}.tt span{display:block;font-size:10.5px;letter-spacing:.18em;color:#64748b}.tt b{display:inline-block;margin-top:3px;background:linear-gradient(135deg,#4f46e5,#7c3aed);color:#fff;padding:5px 14px;border-radius:99px;font-size:14px}
  .stud{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin:14px 0;padding:12px;border-radius:12px;background:linear-gradient(135deg,#eef2ff,#ecfeff)}
  .stud small{display:block;color:#64748b;font-size:10.5px;text-transform:uppercase;letter-spacing:.06em}.stud b{font-size:13px}
  table.sub{width:100%;border-collapse:collapse;margin-bottom:14px}.sub th{background:#312e81;color:#fff;padding:8px;text-align:left;font-size:11.5px}.sub th:first-child{border-radius:8px 0 0 0}.sub th:last-child{border-radius:0 8px 0 0}
  .sub td{padding:8px;border-bottom:1px solid #e7e8fc}.sub tr:nth-child(even) td{background:#fafaff}.c{text-align:center}
  .parts{color:#64748b;font-size:10.5px;margin-top:2px}.opt{font-size:10px;color:#7c3aed;background:#f3e8ff;padding:1px 7px;border-radius:99px;font-style:normal}
  .bar{display:inline-block;width:70px;height:7px;background:#e7e8fc;border-radius:9px;vertical-align:middle;overflow:hidden}.bar i{display:block;height:100%;border-radius:9px}
  .g{display:inline-block;min-width:34px;padding:3px 8px;border-radius:8px;color:#fff;font-weight:700}
  .mx{display:block;font-weight:400;font-size:9.5px;opacity:.8}
  .sum{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin-bottom:12px}
  .box{border-radius:12px;padding:10px 12px;background:color-mix(in srgb,var(--c) 10%,#fff);border:1px solid color-mix(in srgb,var(--c) 30%,#fff);border-left:5px solid var(--c)}
  .box small{display:block;color:#64748b;font-size:10.5px;text-transform:uppercase}.box b{font-size:18px;color:var(--c)}
  .rem{background:#fffbeb;border:1px solid #fde68a;border-radius:12px;padding:10px 12px;margin-bottom:12px}.rc{background:#fde68a;border-radius:99px;padding:2px 10px;margin-left:6px;font-weight:600}
  .key{font-size:10.5px;color:#475569;display:flex;flex-wrap:wrap;gap:6px;align-items:center}.key span{background:#f1f5f9;border-radius:99px;padding:2px 9px}
  footer{position:absolute;left:12mm;right:12mm;bottom:12mm;display:flex;justify-content:space-between;gap:20px}footer div{flex:1;border-top:1px solid #94a3b8;padding-top:5px;text-align:center;color:#64748b;font-size:11px}
  @media print{body{background:#fff}.page{margin:0;border-radius:0;box-shadow:none}@page{size:A4;margin:0}*{-webkit-print-color-adjust:exact;print-color-adjust:exact}}
  </style></head><body>${cards.map(oneCard).join('')}</body></html>`;
}

// opens the browser print dialog (choose "Save as PDF" to download)
export function printCards(cards) {
  const w = window.open('', '_blank');
  if (!w) { alert('Allow pop-ups to print report cards.'); return; }
  w.document.open(); w.document.write(cardsHtml(cards)); w.document.close();
  setTimeout(() => { w.focus(); w.print(); }, 400);
}
