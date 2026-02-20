-- Seed data for local testing
-- Replace UUIDs with real auth.users ids in your Supabase project

begin;

insert into public.companies (id, name, legal_name)
values ('11111111-1111-1111-1111-111111111111', 'Bodega Central', 'Bodega Central SpA')
on conflict (id) do nothing;

-- Optional user-role seeds. These rows are only inserted if users already exist in auth.users.
insert into public.global_roles (user_id, is_super_admin)
select 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid, true
where exists (
  select 1 from auth.users where id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid
)
on conflict (user_id) do update set is_super_admin = excluded.is_super_admin;

with desired_members as (
  select * from (
    values
      ('11111111-1111-1111-1111-111111111111'::uuid, 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid, 'SUPERADMIN'::public.app_role, true),
      ('11111111-1111-1111-1111-111111111111'::uuid, 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'::uuid, 'ADMIN'::public.app_role, true),
      ('11111111-1111-1111-1111-111111111111'::uuid, 'cccccccc-cccc-cccc-cccc-cccccccccccc'::uuid, 'SUPERVISOR'::public.app_role, true),
      ('11111111-1111-1111-1111-111111111111'::uuid, 'dddddddd-dddd-dddd-dddd-dddddddddddd'::uuid, 'BODEGUERO'::public.app_role, true)
  ) as x(company_id, user_id, role, is_active)
)
insert into public.company_memberships (company_id, user_id, role, is_active)
select dm.company_id, dm.user_id, dm.role, dm.is_active
from desired_members dm
join auth.users u on u.id = dm.user_id
on conflict (company_id, user_id) do nothing;

insert into public.locations (id, company_id, code, name, zone)
values
  ('10000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'R1-A1', 'Rack 1 Estante A1', 'RECEPCION'),
  ('10000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'R1-B2', 'Rack 1 Estante B2', 'PRODUCCION'),
  ('10000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'MERMA', 'Zona de Merma', 'CONTROL')
on conflict (company_id, code) do nothing;

insert into public.items (id, company_id, sku, name, category, base_unit, has_expiry, by_lot, qr_code)
values
  ('20000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'RES-25KG', 'Resina Epoxica 25kg', 'QUIMICOS', 'kg', true, true, 'ITEM:11111111-1111-1111-1111-111111111111:20000000-0000-0000-0000-000000000001'),
  ('20000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'GUA-NIT-M', 'Guante Nitrilo M', 'EPP', 'par', false, false, 'ITEM:11111111-1111-1111-1111-111111111111:20000000-0000-0000-0000-000000000002'),
  ('20000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'SOL-500ML', 'Solvente 500ml', 'QUIMICOS', 'unidad', true, true, 'ITEM:11111111-1111-1111-1111-111111111111:20000000-0000-0000-0000-000000000003')
on conflict (company_id, sku) do nothing;

insert into public.lots (id, company_id, item_id, lot_code, qr_code, expires_at)
values
  ('30000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', '20000000-0000-0000-0000-000000000001', 'RES-2401', 'LOT:11111111-1111-1111-1111-111111111111:30000000-0000-0000-0000-000000000001', '2026-05-12'),
  ('30000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', '20000000-0000-0000-0000-000000000001', 'RES-2402', 'LOT:11111111-1111-1111-1111-111111111111:30000000-0000-0000-0000-000000000002', '2026-10-30'),
  ('30000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', '20000000-0000-0000-0000-000000000003', 'SOL-2407', 'LOT:11111111-1111-1111-1111-111111111111:30000000-0000-0000-0000-000000000003', '2026-03-10')
on conflict (company_id, lot_code) do nothing;

insert into public.work_orders (id, company_id, code, responsible, cost_center, status, notes, created_by)
values
  ('40000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'OT-20260219-001', 'Paula Rojas', 'CC-PINTURA', 'IN_PROGRESS', 'Lote piloto P-778', null)
on conflict (company_id, code) do nothing;

insert into public.kardex_movements (
  id, company_id, movement_type, status, reason, requested_by, requested_by_role, approved_by, approved_by_role, approved_at, notes
)
values (
  '50000000-0000-0000-0000-000000000001',
  '11111111-1111-1111-1111-111111111111',
  'INITIAL',
  'APPROVED',
  'Inventario inicial',
  null,
  'ADMIN',
  null,
  'ADMIN',
  now(),
  'Carga inicial de semilla'
)
on conflict (id) do nothing;

insert into public.kardex_movement_lines (movement_id, company_id, location_id, item_id, lot_id, delta_qty)
values
  ('50000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001', 120),
  ('50000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000002', 90),
  ('50000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', '10000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000002', null, 300),
  ('50000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000003', '30000000-0000-0000-0000-000000000003', 45)
on conflict do nothing;

select public.rebuild_stock_balances('11111111-1111-1111-1111-111111111111');

commit;
