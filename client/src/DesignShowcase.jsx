// Living style guide. Open the web app and add  #design-system  to the address (e.g. http://localhost:5173/#design-system).
// Every block below is the REFERENCE for how a screen should look. If a module looks different from this page, the module is wrong.
import React, { useState } from 'react';
import { Page, PageBar, Tabs, Toolbar, ToolbarEnd, SearchInput, KpiGrid, Kpi, Section, DataTable, List, ListRow, StatusBadge, Button, EmptyState, FormDialog, FormGrid, Notice, Choice, MultiChoice, Field, Icon, ask } from './ui.jsx';
import FilterBar from './FilterBar.jsx';

const ROWS = [
  { id: 1, name: 'Aarav Sharma', cls: '8 A', due: 4200, status: 'Overdue' },
  { id: 2, name: 'Diya Patel', cls: '8 B', due: 0, status: 'Paid' },
  { id: 3, name: 'Kabir Singh', cls: '9 A', due: 1800, status: 'Partial' },
  { id: 4, name: 'Meera Nair', cls: '10 C', due: 0, status: 'Paid' },
];

export default function DesignShowcase() {
  const [tab, setTab] = useState('list');
  const [q, setQ] = useState('');
  const [days, setDays] = useState(['Mon', 'Tue']);
  const [cls, setCls] = useState('');
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState('discount');
  const [dark, setDark] = useState(document.documentElement.dataset.theme === 'dark');
  const toggle = () => { const d = !dark; setDark(d); document.documentElement.dataset.theme = d ? 'dark' : 'light'; };
  const rows = ROWS.filter((r) => (!cls || r.cls.startsWith(cls)) && r.name.toLowerCase().includes(q.toLowerCase()));

  return (
    <div style={{ padding: 'var(--sp-5)', background: 'var(--bg)', minHeight: '100%', overflowY: 'auto', height: '100vh' }}>
      <Page>
        <PageBar title="Design system" sub="The reference every module follows. Toggle the theme to check dark mode.">
          <Button icon={dark ? 'sun' : 'moon'} onClick={toggle}>{dark ? 'Light' : 'Dark'}</Button>
        </PageBar>

        <Section title="1. Page anatomy" sub="Page > PageBar > Tabs > FilterBar > KpiGrid > Section / DataTable">
          <p style={{ margin: 0, color: 'var(--mute)', fontSize: 'var(--fs-sm)' }}>Everything below is one screen built in the standard order. Title and actions on top, tabs only if the module has sub-views, then search and filters, then headline numbers, then the content.</p>
        </Section>

        <PageBar title="Student fees" sub="Session 2026-27">
          <Button icon="download">Export</Button>
          <Button kind="primary" icon="plus" onClick={() => setOpen(true)}>Collect fee</Button>
        </PageBar>
        <Tabs value={tab} onChange={setTab} items={[{ key: 'list', label: 'Students', count: ROWS.length }, { key: 'structure', label: 'Fee structure' }, { key: 'reports', label: 'Reports' }]} />
        <FilterBar q={q} onQ={setQ} placeholder="Search students..." count={rows.length}
          filters={[{ key: 'cls', label: 'Class', value: cls, onChange: setCls, all: 'All classes', options: ['8', '9', '10'] }]} />
        <KpiGrid>
          <Kpi icon="rupee" label="Collected" value="₹4.2L" sub="This month" tone="ok" />
          <Kpi icon="wallet" label="Pending" value="₹1.8L" sub="38 students" tone="warn" />
          <Kpi icon="bolt" label="Overdue" value="12" sub="Needs follow-up" tone="bad" />
          <Kpi icon="users" label="Students" value="412" />
        </KpiGrid>
        <Section title="Students" sub="Table on desktop, cards on phones" flush actions={<Button size="sm" icon="filter">Columns</Button>}>
          <DataTable rows={rows} onRowClick={() => setOpen(true)}
            empty={<EmptyState icon="search" title="No students match" action={<Button size="sm" onClick={() => { setQ(''); setCls(''); }}>Clear filters</Button>}>Try a different name or class.</EmptyState>}
            columns={[
              { key: 'name', label: 'Student', primary: true },
              { key: 'cls', label: 'Class' },
              { key: 'due', label: 'Due', align: 'right', render: (r) => `₹${r.due.toLocaleString('en-IN')}` },
              { key: 'status', label: 'Status', render: (r) => <StatusBadge>{r.status}</StatusBadge> },
            ]} />
        </Section>

        <Section title="2. Lists" sub="For people and things on narrow layouts" flush>
          <List>
            <ListRow lead={<Icon name="users" />} title="Class 8 A" sub="32 students · Mrs. Rao" meta={<StatusBadge tone="ok">Marked</StatusBadge>} onClick={() => {}} />
            <ListRow lead={<Icon name="users" />} title="Class 8 B" sub="30 students · Mr. Khan" meta={<StatusBadge tone="warn">Pending</StatusBadge>} onClick={() => {}} />
          </List>
        </Section>

        <Section title="3. Status tones" sub="One colour per meaning, everywhere">
          <div style={{ display: 'flex', gap: 'var(--sp-2)', flexWrap: 'wrap' }}>
            {['ok', 'warn', 'bad', 'info', 'mute'].map((t) => <StatusBadge key={t} tone={t}>{t}</StatusBadge>)}
            <StatusBadge>Paid</StatusBadge><StatusBadge>Due</StatusBadge><StatusBadge>Rejected</StatusBadge><StatusBadge>Draft</StatusBadge><StatusBadge>Inactive</StatusBadge>
          </div>
        </Section>

        <Section title="4. Buttons">
          <div style={{ display: 'flex', gap: 'var(--sp-2)', flexWrap: 'wrap', alignItems: 'center' }}>
            <Button kind="primary" icon="plus">Primary</Button><Button>Secondary</Button><Button kind="ghost">Ghost</Button>
            <Button kind="danger" icon="trash" onClick={async () => { await ask('Delete this record?'); }}>Danger</Button>
            <Button kind="primary" loading>Saving</Button><Button size="sm">Small</Button><Button disabled>Disabled</Button>
          </div>
        </Section>

        <Section title="5. Empty state"><EmptyState icon="box" title="No items yet" action={<Button kind="primary" size="sm" icon="plus">Add item</Button>}>Create the first one to see it here.</EmptyState></Section>

        <Section title="6. Notices, choices and totals" sub="Added by the Visitors + Fees pilot">
          <div className="ds-page">
            <Notice tone="ok">ok: Payment of <b>₹4,200</b> recorded.</Notice>
            <Notice tone="warn">warn: Unpaid fees from the previous session.</Notice>
            <Notice tone="bad" action={<Button size="sm">Retry</Button>}>bad: Could not load. Check your connection.</Notice>
            <Notice tone="info">info: Paid in 4 instalments of about ₹5,000.</Notice>
            <Notice tone="mute">mute: Changes apply to every student of this class.</Notice>
            <Choice label="Adjustment type" value={kind} onChange={setKind} options={[{ value: 'discount', label: 'Discount / concession' }, { value: 'charge', label: 'Extra charge' }]} />
            <MultiChoice label="Days" values={days} onToggle={(d) => setDays(days.includes(d) ? days.filter((x) => x !== d) : [...days, d])} options={['Mon', 'Tue', 'Wed', 'Thu', 'Fri'].map((d) => ({ value: d, label: d }))} />
            <div className="ds-choice" aria-label="Category palette">{[1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => <span key={n} className="ds-swatch" style={{ '--c': `var(--cat-${n})` }}>cat-{n}</span>)}</div>
          </div>
        </Section>

        <Section title="7. Table with a totals row" flush>
          <DataTable rows={ROWS} columns={[{ key: 'name', label: 'Student', primary: true }, { key: 'due', label: 'Due', align: 'right', render: (r) => `₹${r.due}` }]}
            foot={(c) => (c.key === 'name' ? 'Total' : c.key === 'due' ? `₹${ROWS.reduce((a, r) => a + r.due, 0)}` : null)} />
        </Section>

        <Toolbar><SearchInput value={q} onChange={setQ} placeholder="Toolbar search (for headers without filters)" /><ToolbarEnd><Button size="sm">Action</Button></ToolbarEnd></Toolbar>
      </Page>

      {open && (
        <FormDialog title="Collect fee" sub="Aarav Sharma · Class 8 A" onClose={() => setOpen(false)} onSubmit={() => setOpen(false)} submitLabel="Save payment">
          <Field label="Amount" req><input type="number" placeholder="0" /></Field>
          <Field label="Mode"><select><option>Cash</option><option>UPI</option><option>Cheque</option></select></Field>
          <Field label="Note" hint="Optional"><textarea /></Field>
        </FormDialog>
      )}
    </div>
  );
}
