// One place that decides how a class is STORED, so the app never shows "Class Class 10 A".
// The screens add the word "Class" themselves, so the stored name is just "10" (or "Nursery", "LKG").
//   "Class 10" / "class-10" / "Std. 10" / "Grade 10" / "10th" / "010"  ->  name "10"
//   section "b" / "Section B" / " b "                                    ->  "B"
export function cleanClassName(raw) {
  let s = String(raw ?? '').trim().replace(/\s+/g, ' ');
  s = s.replace(/^(?:class|std|standard|grade|cls)\b\.?\s*[-:]?\s*/i, '').trim();
  const m = s.match(/^0*(\d+)(?:st|nd|rd|th)?$/i);
  return m ? String(Number(m[1])) : s;
}

export function cleanSection(raw) {
  const s = String(raw ?? '').trim().replace(/^(?:section|sec|division|div)\b\.?\s*[-:]?\s*/i, '').trim();
  return s.length === 1 ? s.toUpperCase() : s;
}
