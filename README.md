# Inventario de Bodega (Tauri + React + Supabase)

Aplicacion mobile-first para bodega con Kardex, OT, QR por item/lote, FIFO y aprobaciones.

## Stack
- UI: React + Vite + TypeScript + Tailwind + shadcn/ui
- Core rules: Rust (`tauri::command`) para QR, FIFO, validaciones de aprobacion y reconciliacion
- Backend: Supabase Postgres + Auth + Storage

## Reglas hard-coded implementadas
- Kardex por movimientos como verdad.
- Multiempresa + RLS.
- Roles: BODEGUERO / SUPERVISOR / ADMIN / SUPERADMIN.
- ADJUST y SCRAP: motivo obligatorio + estado inicial PENDING.
- OUT_OT requiere OT asociada.
- ITEM QR + lotes: lote manual o Auto-FIFO.
- LOT QR: opera directo sobre lote.

## Estructura
- `src/`: UI + hooks + servicios + exports.
- `src-tauri/src/commands.rs`: reglas criticas en Rust.
- `supabase/schema.sql`: esquema + triggers + RLS.
- `supabase/seed.sql`: datos de arranque.
- `docs/mobile-packaging.md`: estrategia movil (PWA hoy, Tauri mobile despues).

## Requisitos
- Node 20+
- Rust + Cargo
- Tauri prerequisites segun OS

## Variables de entorno
Copiar `.env.example` y completar:
- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`

## Scripts
- `npm run dev`: frontend web
- `npm run typecheck`: chequeo TypeScript
- `npm run build`: build frontend
- `npm run tauri:dev`: app Tauri en desarrollo
- `npm run tauri:build`: build Tauri

## Supabase
1. Ejecutar `supabase/schema.sql`.
2. Ejecutar `supabase/seed.sql`.
3. Reemplazar UUID de usuarios seed por `auth.users` reales.

## Flujo operativo
1. Cargar inventario inicial (INITIAL aprobado).
2. Escanear QR ITEM/LOT para entradas/salidas/traslados.
3. Consumir por OT (OUT_OT).
4. Ejecutar conteo ciclico (genera ADJUST PENDING si hay diferencia).
5. Aprobar/rechazar ADJUST/SCRAP por Supervisor/Admin/SuperAdmin.
6. Exportar reportes (Excel/CSV/PDF).
