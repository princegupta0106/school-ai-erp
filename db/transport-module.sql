-- ================= TRANSPORT MODULE =================
-- Safe to re-run. Pushed automatically by run.bat / push-sql.bat (like every file in db/).
--   transport_vehicles    : the buses (capacity, driver, document expiry dates)
--   transport_routes      : a named route (zone, one-way / two-way) run by one vehicle
--   transport_stops       : the ordered stops of a route, with pick-up / drop times
--   transport_assignments : which student rides which route and gets on at which stop
create table if not exists transport_vehicles (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references schools(id) on delete cascade,
  name text not null,                       -- "Bus 1"
  reg_no text,                              -- registration number plate
  capacity int not null default 40 check (capacity between 1 and 200),
  driver_name text,
  driver_phone text,
  attendant_name text,
  attendant_phone text,
  insurance_expiry date,
  fitness_expiry date,
  permit_expiry date,
  puc_expiry date,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists tr_veh_school_idx on transport_vehicles(school_id);
create unique index if not exists tr_veh_name_uq on transport_vehicles(school_id, lower(name));

create table if not exists transport_routes (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references schools(id) on delete cascade,
  name text not null,                       -- "Route 1"
  zone text,                                -- "North Zone"
  direction text not null default 'two_way' check (direction in ('one_way','two_way')),
  vehicle_id uuid references transport_vehicles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists tr_route_school_idx on transport_routes(school_id);
create index if not exists tr_route_vehicle_idx on transport_routes(vehicle_id);
create unique index if not exists tr_route_name_uq on transport_routes(school_id, lower(name));

create table if not exists transport_stops (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references schools(id) on delete cascade,
  route_id uuid not null references transport_routes(id) on delete cascade,
  name text not null,
  seq int not null default 1,               -- order along the route (1 = first pick-up)
  pickup_time time,                         -- morning: when the bus reaches this stop
  drop_time time,                           -- afternoon: when the bus reaches this stop
  created_at timestamptz not null default now()
);
create index if not exists tr_stop_route_idx on transport_stops(route_id, seq);

create table if not exists transport_assignments (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references schools(id) on delete cascade,
  student_id uuid not null references users(user_id) on delete cascade,
  route_id uuid not null references transport_routes(id) on delete cascade,
  stop_id uuid not null references transport_stops(id) on delete cascade,
  created_by uuid references users(user_id) on delete set null,
  created_at timestamptz not null default now(),
  unique (student_id, route_id)             -- one student can ride several routes, but each only once
);
create index if not exists tr_asg_school_idx on transport_assignments(school_id);
create index if not exists tr_asg_route_idx on transport_assignments(route_id);
create index if not exists tr_asg_stop_idx on transport_assignments(stop_id);

-- the server uses the service key, so RLS with no policies keeps these tables closed to everyone else
alter table transport_vehicles enable row level security;
alter table transport_routes enable row level security;
alter table transport_stops enable row level security;
alter table transport_assignments enable row level security;
