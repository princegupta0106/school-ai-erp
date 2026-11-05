-- ================= INVENTORY MODULE =================
-- Safe to re-run. Pushed automatically like every file in db/.
--   inv_stores / inv_categories / inv_vendors : set-up data
--   inv_items            : things that can be ordered, received and issued (qty = stock left)
--   inv_orders + lines   : purchase orders       inv_grns + lines : goods received against a PO
--   inv_issues + lines   : items given to a student / staff member (with receipt no.)
create table if not exists inv_stores (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references schools(id) on delete cascade,
  name text not null,
  created_at timestamptz not null default now()
);
create unique index if not exists inv_store_name_uq on inv_stores(school_id, lower(name));

create table if not exists inv_categories (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references schools(id) on delete cascade,
  store_id uuid references inv_stores(id) on delete cascade,
  name text not null,
  created_at timestamptz not null default now()
);
create index if not exists inv_cat_school_idx on inv_categories(school_id, store_id);
create unique index if not exists inv_cat_name_uq on inv_categories(school_id, coalesce(store_id, '00000000-0000-0000-0000-000000000000'::uuid), lower(name));

create table if not exists inv_vendors (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references schools(id) on delete cascade,
  name text not null,
  category text, phone text, email text, address text, notes text,
  created_at timestamptz not null default now()
);
create unique index if not exists inv_vendor_name_uq on inv_vendors(school_id, lower(name));

create table if not exists inv_items (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references schools(id) on delete cascade,
  store_id uuid references inv_stores(id) on delete set null,
  category_id uuid references inv_categories(id) on delete set null,
  name text not null,
  item_type text not null default 'consumable' check (item_type in ('consumable','asset')),
  unit text not null default 'Nos',
  qty numeric(12,2) not null default 0 check (qty >= 0),
  reorder_level numeric(12,2) not null default 0 check (reorder_level >= 0),
  rate numeric(12,2) not null default 0 check (rate >= 0),
  created_at timestamptz not null default now()
);
create index if not exists inv_item_school_idx on inv_items(school_id, store_id, category_id);
create unique index if not exists inv_item_name_uq on inv_items(school_id, coalesce(store_id, '00000000-0000-0000-0000-000000000000'::uuid), lower(name));

create table if not exists inv_orders (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references schools(id) on delete cascade,
  po_no text not null,
  vendor_id uuid references inv_vendors(id) on delete set null,
  order_date date not null default current_date,
  status text not null default 'pending' check (status in ('pending','approved','received','closed','cancelled')),
  notes text,
  created_by uuid,
  created_at timestamptz not null default now()
);
create unique index if not exists inv_order_no_uq on inv_orders(school_id, po_no);
create index if not exists inv_order_school_idx on inv_orders(school_id, order_date desc);

create table if not exists inv_order_lines (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references inv_orders(id) on delete cascade,
  item_id uuid not null references inv_items(id) on delete restrict,
  qty numeric(12,2) not null check (qty > 0),
  rate numeric(12,2) not null default 0 check (rate >= 0),
  received_qty numeric(12,2) not null default 0 check (received_qty >= 0)
);
create index if not exists inv_ol_order_idx on inv_order_lines(order_id);

create table if not exists inv_grns (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references schools(id) on delete cascade,
  grn_no text not null,
  order_id uuid references inv_orders(id) on delete set null,
  vendor_id uuid references inv_vendors(id) on delete set null,
  grn_date date not null default current_date,
  notes text,
  created_by uuid,
  created_at timestamptz not null default now()
);
create unique index if not exists inv_grn_no_uq on inv_grns(school_id, grn_no);

create table if not exists inv_grn_lines (
  id uuid primary key default gen_random_uuid(),
  grn_id uuid not null references inv_grns(id) on delete cascade,
  item_id uuid not null references inv_items(id) on delete restrict,
  qty numeric(12,2) not null check (qty > 0)
);
create index if not exists inv_gl_grn_idx on inv_grn_lines(grn_id);

create table if not exists inv_issues (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references schools(id) on delete cascade,
  receipt_no text not null,
  issued_to uuid references users(user_id) on delete set null,
  issued_to_name text not null,
  issued_to_code text,
  issue_date date not null default current_date,
  notes text,
  created_by uuid,
  created_at timestamptz not null default now()
);
create unique index if not exists inv_issue_no_uq on inv_issues(school_id, receipt_no);
create index if not exists inv_issue_school_idx on inv_issues(school_id, issue_date desc);

create table if not exists inv_issue_lines (
  id uuid primary key default gen_random_uuid(),
  issue_id uuid not null references inv_issues(id) on delete cascade,
  item_id uuid not null references inv_items(id) on delete restrict,
  qty numeric(12,2) not null check (qty > 0),
  returned_qty numeric(12,2) not null default 0 check (returned_qty >= 0)
);
create index if not exists inv_il_issue_idx on inv_issue_lines(issue_id);

-- the ONLY way stock changes: never goes below zero
create or replace function inv_adjust_stock(p_item uuid, p_delta numeric) returns numeric
language plpgsql as $$
declare v numeric;
begin
  update inv_items set qty = qty + p_delta where id = p_item returning qty into v;
  if v is null then raise exception 'Item not found' using errcode = 'P0001'; end if;
  return v;
exception when check_violation then
  raise exception 'Not enough stock' using errcode = 'P0001';
end $$;

alter table inv_stores enable row level security;
alter table inv_categories enable row level security;
alter table inv_vendors enable row level security;
alter table inv_items enable row level security;
alter table inv_orders enable row level security;
alter table inv_order_lines enable row level security;
alter table inv_grns enable row level security;
alter table inv_grn_lines enable row level security;
alter table inv_issues enable row level security;
alter table inv_issue_lines enable row level security;
