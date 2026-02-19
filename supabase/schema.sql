-- Supabase schema for Inventario de Bodega
-- Multiempresa + RLS + Kardex como verdad + stock_balances materializado

create extension if not exists pgcrypto;

create type public.app_role as enum ('BODEGUERO', 'SUPERVISOR', 'ADMIN', 'SUPERADMIN');
create type public.movement_type as enum ('INITIAL', 'IN', 'OUT_OT', 'TRANSFER', 'ADJUST', 'SCRAP');
create type public.movement_status as enum ('PENDING', 'APPROVED', 'REJECTED');
create type public.work_order_status as enum ('OPEN', 'IN_PROGRESS', 'DONE', 'CANCELLED');

create table if not exists public.companies (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  legal_name text,
  created_at timestamptz not null default now()
);

create table if not exists public.global_roles (
  user_id uuid primary key references auth.users (id) on delete cascade,
  is_super_admin boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  full_name text,
  phone text,
  created_at timestamptz not null default now()
);

create table if not exists public.company_memberships (
  company_id uuid not null references public.companies (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role public.app_role not null default 'BODEGUERO',
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  primary key (company_id, user_id)
);

create table if not exists public.locations (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  code text not null,
  name text not null,
  zone text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (company_id, code)
);

create table if not exists public.items (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  sku text not null,
  name text not null,
  category text,
  base_unit text not null,
  has_expiry boolean not null default false,
  by_lot boolean not null default false,
  qr_code text not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (company_id, sku),
  unique (company_id, qr_code)
);

create table if not exists public.lots (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  item_id uuid not null references public.items (id) on delete cascade,
  lot_code text not null,
  qr_code text not null,
  expires_at date not null,
  created_at timestamptz not null default now(),
  unique (company_id, lot_code),
  unique (company_id, qr_code)
);

create table if not exists public.work_orders (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  code text not null,
  responsible text not null,
  cost_center text not null,
  status public.work_order_status not null default 'OPEN',
  notes text,
  created_by uuid references auth.users (id),
  created_at timestamptz not null default now(),
  unique (company_id, code)
);

create table if not exists public.kardex_movements (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  movement_type public.movement_type not null,
  status public.movement_status not null,
  reason text,
  notes text,
  requested_by uuid references auth.users (id),
  requested_by_role public.app_role not null,
  approved_by uuid references auth.users (id),
  approved_by_role public.app_role,
  approved_at timestamptz,
  work_order_id uuid references public.work_orders (id),
  created_at timestamptz not null default now()
);

create table if not exists public.kardex_movement_lines (
  id uuid primary key default gen_random_uuid(),
  movement_id uuid not null references public.kardex_movements (id) on delete cascade,
  company_id uuid not null references public.companies (id) on delete cascade,
  location_id uuid not null references public.locations (id) on delete restrict,
  item_id uuid not null references public.items (id) on delete restrict,
  lot_id uuid references public.lots (id) on delete restrict,
  delta_qty numeric(14, 4) not null check (delta_qty <> 0),
  created_at timestamptz not null default now()
);

create table if not exists public.stock_balances (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  location_id uuid not null references public.locations (id) on delete restrict,
  item_id uuid not null references public.items (id) on delete restrict,
  lot_id uuid references public.lots (id) on delete restrict,
  quantity numeric(14, 4) not null default 0,
  updated_at timestamptz not null default now()
);

create unique index if not exists stock_balances_uniq_with_lot
  on public.stock_balances (company_id, location_id, item_id, lot_id)
  where lot_id is not null;

create unique index if not exists stock_balances_uniq_without_lot
  on public.stock_balances (company_id, location_id, item_id)
  where lot_id is null;

create table if not exists public.cycle_count_sessions (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  location_id uuid not null references public.locations (id) on delete restrict,
  code text not null,
  status text not null default 'OPEN',
  created_by uuid references auth.users (id),
  created_at timestamptz not null default now(),
  unique (company_id, code)
);

create table if not exists public.cycle_count_lines (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.cycle_count_sessions (id) on delete cascade,
  company_id uuid not null references public.companies (id) on delete cascade,
  item_id uuid not null references public.items (id) on delete restrict,
  lot_id uuid references public.lots (id) on delete restrict,
  system_qty numeric(14, 4) not null,
  counted_qty numeric(14, 4) not null,
  delta_qty numeric(14, 4) not null,
  created_at timestamptz not null default now()
);

create table if not exists public.approval_events (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  movement_id uuid not null references public.kardex_movements (id) on delete cascade,
  decision public.movement_status not null,
  decided_by uuid references auth.users (id),
  decided_by_role public.app_role,
  notes text,
  created_at timestamptz not null default now()
);

create index if not exists idx_items_company on public.items (company_id);
create index if not exists idx_lots_item on public.lots (item_id, expires_at);
create index if not exists idx_kardex_company_created on public.kardex_movements (company_id, created_at desc);
create index if not exists idx_kardex_lines_lookup on public.kardex_movement_lines (company_id, item_id, location_id, lot_id);
create index if not exists idx_stock_lookup on public.stock_balances (company_id, location_id, item_id, lot_id);
-- Helper functions
create or replace function public.current_user_id()
returns uuid
language sql
stable
as $$
  select auth.uid();
$$;

create or replace function public.is_super_admin()
returns boolean
language sql
stable
as $$
  select exists (
    select 1
    from public.global_roles gr
    where gr.user_id = auth.uid()
      and gr.is_super_admin = true
  );
$$;

create or replace function public.has_company_access(target_company uuid)
returns boolean
language sql
stable
as $$
  select
    public.is_super_admin()
    or exists (
      select 1
      from public.company_memberships cm
      where cm.company_id = target_company
        and cm.user_id = auth.uid()
        and cm.is_active = true
    );
$$;

create or replace function public.has_company_role(target_company uuid, roles public.app_role[])
returns boolean
language sql
stable
as $$
  select
    public.is_super_admin()
    or exists (
      select 1
      from public.company_memberships cm
      where cm.company_id = target_company
        and cm.user_id = auth.uid()
        and cm.is_active = true
        and cm.role = any (roles)
    );
$$;

create or replace function public.ensure_lot_rules(p_company_id uuid, p_item_id uuid, p_lot_id uuid)
returns void
language plpgsql
as $$
declare
  v_has_expiry boolean;
  v_by_lot boolean;
begin
  select i.has_expiry, i.by_lot
    into v_has_expiry, v_by_lot
  from public.items i
  where i.id = p_item_id
    and i.company_id = p_company_id;

  if not found then
    raise exception 'Item % does not belong to company %', p_item_id, p_company_id;
  end if;

  if (v_has_expiry or v_by_lot) and p_lot_id is null then
    raise exception 'lot_id is required for lot-managed items';
  end if;

  if p_lot_id is not null then
    if not exists (
      select 1
      from public.lots l
      where l.id = p_lot_id
        and l.company_id = p_company_id
        and l.item_id = p_item_id
    ) then
      raise exception 'Invalid lot % for item % and company %', p_lot_id, p_item_id, p_company_id;
    end if;
  end if;
end;
$$;

create or replace function public.kardex_movements_validate()
returns trigger
language plpgsql
as $$
begin
  if new.movement_type in ('ADJUST', 'SCRAP') then
    if new.status <> 'PENDING' then
      raise exception 'ADJUST and SCRAP must start as PENDING';
    end if;

    if coalesce(trim(new.reason), '') = '' then
      raise exception 'Reason is mandatory for ADJUST and SCRAP';
    end if;
  end if;

  if new.movement_type = 'OUT_OT' and new.work_order_id is null then
    raise exception 'OUT_OT requires work_order_id';
  end if;

  if tg_op = 'UPDATE' then
    if old.status in ('APPROVED', 'REJECTED') and new.status <> old.status then
      raise exception 'Approved/rejected movement cannot change status';
    end if;

    if old.status = 'PENDING' and new.status in ('APPROVED', 'REJECTED') then
      if new.approved_by_role is null then
        raise exception 'approved_by_role is required for decision';
      end if;
      if new.approved_by_role not in ('SUPERVISOR', 'ADMIN', 'SUPERADMIN') then
        raise exception 'Only supervisor/admin/superadmin can decide PENDING movements';
      end if;
      new.approved_at := now();
    end if;
  end if;

  return new;
end;
$$;

create or replace function public.kardex_lines_validate()
returns trigger
language plpgsql
as $$
declare
  v_company_id uuid;
begin
  select km.company_id into v_company_id
  from public.kardex_movements km
  where km.id = new.movement_id;

  if v_company_id is null then
    raise exception 'Movement % not found', new.movement_id;
  end if;

  if new.company_id <> v_company_id then
    raise exception 'company_id must match movement company';
  end if;

  perform public.ensure_lot_rules(new.company_id, new.item_id, new.lot_id);

  if not exists (
    select 1 from public.locations loc
    where loc.id = new.location_id and loc.company_id = new.company_id
  ) then
    raise exception 'Location % does not belong to company %', new.location_id, new.company_id;
  end if;

  return new;
end;
$$;

create or replace function public.stock_balances_validate()
returns trigger
language plpgsql
as $$
begin
  perform public.ensure_lot_rules(new.company_id, new.item_id, new.lot_id);
  return new;
end;
$$;

create or replace function public.apply_movement_to_stock(p_movement_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_movement record;
  r record;
begin
  select km.*
    into v_movement
  from public.kardex_movements km
  where km.id = p_movement_id;

  if not found then
    return;
  end if;

  if v_movement.status <> 'APPROVED' then
    return;
  end if;

  for r in
    select
      kml.company_id,
      kml.location_id,
      kml.item_id,
      kml.lot_id,
      sum(kml.delta_qty) as delta_qty
    from public.kardex_movement_lines kml
    where kml.movement_id = p_movement_id
    group by kml.company_id, kml.location_id, kml.item_id, kml.lot_id
  loop
    if r.lot_id is null then
      update public.stock_balances sb
        set quantity = sb.quantity + r.delta_qty,
            updated_at = now()
      where sb.company_id = r.company_id
        and sb.location_id = r.location_id
        and sb.item_id = r.item_id
        and sb.lot_id is null;

      if not found then
        insert into public.stock_balances (company_id, location_id, item_id, lot_id, quantity, updated_at)
        values (r.company_id, r.location_id, r.item_id, null, r.delta_qty, now());
      end if;
    else
      update public.stock_balances sb
        set quantity = sb.quantity + r.delta_qty,
            updated_at = now()
      where sb.company_id = r.company_id
        and sb.location_id = r.location_id
        and sb.item_id = r.item_id
        and sb.lot_id = r.lot_id;

      if not found then
        insert into public.stock_balances (company_id, location_id, item_id, lot_id, quantity, updated_at)
        values (r.company_id, r.location_id, r.item_id, r.lot_id, r.delta_qty, now());
      end if;
    end if;
  end loop;

  delete from public.stock_balances where quantity <= 0;
end;
$$;

create or replace function public.rebuild_stock_balances(p_company_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.stock_balances sb where sb.company_id = p_company_id;

  insert into public.stock_balances (company_id, location_id, item_id, lot_id, quantity, updated_at)
  select
    kml.company_id,
    kml.location_id,
    kml.item_id,
    kml.lot_id,
    sum(kml.delta_qty) as quantity,
    now()
  from public.kardex_movement_lines kml
  join public.kardex_movements km on km.id = kml.movement_id
  where km.company_id = p_company_id
    and km.status = 'APPROVED'
  group by kml.company_id, kml.location_id, kml.item_id, kml.lot_id
  having sum(kml.delta_qty) > 0;
end;
$$;

create or replace function public.kardex_apply_stock_after_insert()
returns trigger
language plpgsql
as $$
begin
  if new.status = 'APPROVED' then
    perform public.apply_movement_to_stock(new.id);
  end if;

  return new;
end;
$$;

create or replace function public.kardex_apply_stock_after_update()
returns trigger
language plpgsql
as $$
begin
  if old.status = 'PENDING' and new.status = 'APPROVED' then
    perform public.apply_movement_to_stock(new.id);

    insert into public.approval_events (company_id, movement_id, decision, decided_by, decided_by_role, notes)
    values (new.company_id, new.id, new.status, new.approved_by, new.approved_by_role, new.notes);
  elsif old.status = 'PENDING' and new.status = 'REJECTED' then
    insert into public.approval_events (company_id, movement_id, decision, decided_by, decided_by_role, notes)
    values (new.company_id, new.id, new.status, new.approved_by, new.approved_by_role, new.notes);
  end if;

  return new;
end;
$$;

create trigger trg_kardex_movements_validate
before insert or update on public.kardex_movements
for each row
execute function public.kardex_movements_validate();

create trigger trg_kardex_lines_validate
before insert or update on public.kardex_movement_lines
for each row
execute function public.kardex_lines_validate();

create trigger trg_stock_balances_validate
before insert or update on public.stock_balances
for each row
execute function public.stock_balances_validate();

create trigger trg_kardex_apply_stock_insert
after insert on public.kardex_movements
for each row
execute function public.kardex_apply_stock_after_insert();

create trigger trg_kardex_apply_stock_update
after update of status on public.kardex_movements
for each row
execute function public.kardex_apply_stock_after_update();

-- RLS
alter table public.companies enable row level security;
alter table public.global_roles enable row level security;
alter table public.profiles enable row level security;
alter table public.company_memberships enable row level security;
alter table public.locations enable row level security;
alter table public.items enable row level security;
alter table public.lots enable row level security;
alter table public.work_orders enable row level security;
alter table public.kardex_movements enable row level security;
alter table public.kardex_movement_lines enable row level security;
alter table public.stock_balances enable row level security;
alter table public.cycle_count_sessions enable row level security;
alter table public.cycle_count_lines enable row level security;
alter table public.approval_events enable row level security;

create policy companies_select on public.companies
for select using (public.has_company_access(id));

create policy memberships_select on public.company_memberships
for select using (public.has_company_access(company_id));

create policy locations_all on public.locations
for all
using (public.has_company_access(company_id))
with check (public.has_company_role(company_id, array['ADMIN', 'SUPERADMIN']::public.app_role[]));

create policy items_read on public.items
for select using (public.has_company_access(company_id));
create policy items_write on public.items
for insert with check (public.has_company_role(company_id, array['ADMIN', 'SUPERADMIN']::public.app_role[]));
create policy items_update on public.items
for update using (public.has_company_role(company_id, array['ADMIN', 'SUPERADMIN']::public.app_role[]));

create policy lots_read on public.lots
for select using (public.has_company_access(company_id));
create policy lots_write on public.lots
for insert with check (public.has_company_role(company_id, array['ADMIN', 'SUPERADMIN']::public.app_role[]));
create policy lots_update on public.lots
for update using (public.has_company_role(company_id, array['ADMIN', 'SUPERADMIN']::public.app_role[]));

create policy work_orders_read on public.work_orders
for select using (public.has_company_access(company_id));
create policy work_orders_write on public.work_orders
for all
using (public.has_company_role(company_id, array['BODEGUERO', 'SUPERVISOR', 'ADMIN', 'SUPERADMIN']::public.app_role[]))
with check (public.has_company_role(company_id, array['BODEGUERO', 'SUPERVISOR', 'ADMIN', 'SUPERADMIN']::public.app_role[]));

create policy kardex_movements_read on public.kardex_movements
for select using (public.has_company_access(company_id));

create policy kardex_movements_insert on public.kardex_movements
for insert with check (public.has_company_role(company_id, array['BODEGUERO', 'SUPERVISOR', 'ADMIN', 'SUPERADMIN']::public.app_role[]));

create policy kardex_movements_update on public.kardex_movements
for update using (
  public.has_company_role(company_id, array['SUPERVISOR', 'ADMIN', 'SUPERADMIN']::public.app_role[])
)
with check (
  public.has_company_role(company_id, array['SUPERVISOR', 'ADMIN', 'SUPERADMIN']::public.app_role[])
);

create policy kardex_lines_read on public.kardex_movement_lines
for select using (public.has_company_access(company_id));
create policy kardex_lines_insert on public.kardex_movement_lines
for insert with check (public.has_company_role(company_id, array['BODEGUERO', 'SUPERVISOR', 'ADMIN', 'SUPERADMIN']::public.app_role[]));

create policy stock_read on public.stock_balances
for select using (public.has_company_access(company_id));

create policy cycle_sessions_all on public.cycle_count_sessions
for all
using (public.has_company_access(company_id))
with check (public.has_company_role(company_id, array['BODEGUERO', 'SUPERVISOR', 'ADMIN', 'SUPERADMIN']::public.app_role[]));

create policy cycle_lines_all on public.cycle_count_lines
for all
using (public.has_company_access(company_id))
with check (public.has_company_role(company_id, array['BODEGUERO', 'SUPERVISOR', 'ADMIN', 'SUPERADMIN']::public.app_role[]));

create policy approval_events_read on public.approval_events
for select using (public.has_company_access(company_id));

create policy profiles_self on public.profiles
for all using (id = auth.uid())
with check (id = auth.uid());

create policy global_roles_select_super on public.global_roles
for select using (public.is_super_admin() or user_id = auth.uid());

-- Storage bucket for labels/reports (path pattern: <company_id>/...)
insert into storage.buckets (id, name, public)
values ('warehouse-docs', 'warehouse-docs', false)
on conflict (id) do nothing;

drop policy if exists warehouse_docs_read on storage.objects;
create policy warehouse_docs_read
on storage.objects for select
using (
  bucket_id = 'warehouse-docs'
  and public.has_company_access((storage.foldername(name))[1]::uuid)
);

drop policy if exists warehouse_docs_write on storage.objects;
create policy warehouse_docs_write
on storage.objects for insert
with check (
  bucket_id = 'warehouse-docs'
  and public.has_company_role(
    (storage.foldername(name))[1]::uuid,
    array['BODEGUERO', 'SUPERVISOR', 'ADMIN', 'SUPERADMIN']::public.app_role[]
  )
);

drop policy if exists warehouse_docs_delete on storage.objects;
create policy warehouse_docs_delete
on storage.objects for delete
using (
  bucket_id = 'warehouse-docs'
  and public.has_company_role(
    (storage.foldername(name))[1]::uuid,
    array['SUPERVISOR', 'ADMIN', 'SUPERADMIN']::public.app_role[]
  )
);
