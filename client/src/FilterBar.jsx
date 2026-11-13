import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Icon, SearchInput } from './ui.jsx';

/* ============================================================================================
   FilterBar - the ONE search + filter pattern used on every list screen.

   <FilterBar
     q={q} onQ={setQ} placeholder="Search..."          // omit onQ for screens with no search
     filters={[{ key:'cls', label:'Class', value:cls, onChange:setCls, options:[{value:'1',label:'Class 1'}], all:'All classes' }]}
     sort={{ value:sortBy, onChange:setSortBy, options:[{value:'name',label:'Name A-Z'}], def:'name' }}
     count={rows.length}                               // optional: shown in the panel header
     end={<button className="btn primary">Add</button>} />

   Filter spec: key, label, value, onChange, options (strings or {value,label}), all (label of the empty option),
                def (default value, '' unless given), type: 'chips' | 'select' | 'date' (auto: chips up to 8 options, else select).
   IMPORTANT: onChange may be called for several filters in a row when the panel is applied, so state setters
   for object state must use the functional form:  (v) => setF((p) => ({ ...p, module: v }))
   ============================================================================================ */
const norm = (o) => (o !== null && typeof o === 'object' ? o : { value: o, label: String(o) });
const dv = (f) => f.def ?? '';
const on = (f) => String(f.value ?? '') !== String(dv(f));
const labelOf = (f) => { const o = (f.options || []).map(norm).find((x) => String(x.value) === String(f.value)); return o ? o.label : String(f.value); };
const kindOf = (f) => f.type || ((f.options || []).length > 8 ? 'select' : 'chips');

function Panel({ filters, sort, count, onClose }) {
  const init = () => { const d = {}; filters.forEach((f) => { d[f.key] = f.value ?? ''; }); if (sort) d.__sort = sort.value; return d; };
  const [d, setD] = useState(init);
  useEffect(() => { const k = (e) => e.key === 'Escape' && onClose(); window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k); }, [onClose]);
  const apply = () => {
    filters.forEach((f) => { if (String(d[f.key]) !== String(f.value ?? '')) f.onChange(d[f.key]); });
    if (sort && d.__sort !== sort.value) sort.onChange(d.__sort);
    onClose();
  };
  const reset = () => { const x = {}; filters.forEach((f) => { x[f.key] = dv(f); }); if (sort) x.__sort = sort.def ?? sort.options.map(norm)[0].value; setD(x); };
  const Chips = ({ value, set, options, all }) => (
    <div className="ds-fb-opts">
      {all !== null && <button type="button" className={`ds-fb-o ${String(value) === '' ? 's' : ''}`} aria-pressed={String(value) === ''} onClick={() => set('')}>{all}</button>}
      {options.map(norm).map((o) => <button type="button" key={o.value} className={`ds-fb-o ${String(value) === String(o.value) ? 's' : ''}`} aria-pressed={String(value) === String(o.value)} onClick={() => set(o.value)}>{o.label}</button>)}
    </div>
  );
  return createPortal(
    <div className="ds-fb-wrap" role="presentation">
      <div className="ds-fb-scrim" onClick={onClose} />
      <div className="ds-fb-panel" role="dialog" aria-modal="true" aria-label="Filters">
        <div className="ds-fb-head"><div><b>Filters</b>{count != null && <div className="ds-sub">{count} result{count === 1 ? '' : 's'} now</div>}</div>
          <button type="button" className="icon-btn" aria-label="Close filters" onClick={onClose}><Icon name="x" /></button></div>
        <div className="ds-fb-body">
          {sort && <div className="ds-fb-g"><div className="ds-fb-gl">Sort by</div>
            <Chips value={d.__sort} set={(v) => setD({ ...d, __sort: v })} options={sort.options} all={null} /></div>}
          {filters.map((f) => (
            <div className="ds-fb-g" key={f.key}><div className="ds-fb-gl">{f.label}</div>
              {kindOf(f) === 'date'
                ? <input type="date" aria-label={f.label} value={d[f.key]} onChange={(e) => setD({ ...d, [f.key]: e.target.value })} />
                : kindOf(f) === 'select'
                  ? <select aria-label={f.label} value={d[f.key]} onChange={(e) => setD({ ...d, [f.key]: e.target.value })}>
                    {f.all !== null && <option value={dv(f)}>{f.all || 'All'}</option>}
                    {(f.options || []).map(norm).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</select>
                  : <Chips value={d[f.key]} set={(v) => setD({ ...d, [f.key]: v })} options={f.options || []} all={f.all === undefined ? 'All' : f.all} />}
            </div>
          ))}
        </div>
        <div className="ds-fb-foot"><button type="button" className="btn" onClick={reset}>Reset</button><button type="button" className="btn primary ds-fb-apply" onClick={apply}>Apply filters</button></div>
      </div>
    </div>, document.body);
}

export function FilterBar({ q, onQ, placeholder = 'Search...', filters = [], sort, count, end, className = '' }) {
  const [open, setOpen] = useState(false);
  const fs = filters.filter(Boolean);
  const act = fs.filter(on);
  const sortOn = sort && String(sort.value) !== String(sort.def ?? sort.options.map(norm)[0].value);
  const n = act.length + (sortOn ? 1 : 0);
  const has = fs.length > 0 || sort;
  const clear = () => { act.forEach((f) => f.onChange(dv(f))); if (sortOn) sort.onChange(sort.def ?? sort.options.map(norm)[0].value); };
  return (
    <div className={`ds-fb ${className}`}>
      <div className="ds-toolbar">
        {onQ && <SearchInput value={q} onChange={onQ} placeholder={placeholder} />}
        {has && <button type="button" className={`btn ds-fb-btn ${n ? 'on' : ''}`} onClick={() => setOpen(true)} aria-haspopup="dialog" aria-label={n ? `Filters, ${n} active` : 'Filters'}>
          <Icon name="filter" size={17} />Filter{n > 0 && <span className="ds-fb-n">{n}</span>}</button>}
        {end && <div className="ds-toolbar-end">{end}</div>}
      </div>
      {n > 0 && <div className="ds-fb-chips">
        {act.map((f) => <span className="ds-fb-chip" key={f.key}>{f.chip ? f.chip(f.value) : `${f.label}: ${kindOf(f) === 'date' ? f.value : labelOf(f)}`}
          <button type="button" aria-label={`Remove ${f.label} filter`} onClick={() => f.onChange(dv(f))}><Icon name="x" size={13} /></button></span>)}
        {sortOn && <span className="ds-fb-chip">Sort: {norm(sort.options.map(norm).find((o) => String(o.value) === String(sort.value)) || { label: sort.value }).label}
          <button type="button" aria-label="Reset sort" onClick={() => sort.onChange(sort.def ?? sort.options.map(norm)[0].value)}><Icon name="x" size={13} /></button></span>}
        <button type="button" className="ds-fb-clr" onClick={clear}>Clear all</button>
      </div>}
      {open && <Panel filters={fs} sort={sort} count={count} onClose={() => setOpen(false)} />}
    </div>
  );
}
export default FilterBar;
