# Empaquetado movil (roadmap practico)

## Estado actual
- La app actual es Tauri desktop + UI web mobile-first (React + Tailwind + shadcn/ui).
- Se puede abrir en navegador como PWA-like operativa mientras se define el paso a Tauri Mobile.

## Opcion recomendada hoy (entrega rapida)
1. Desplegar frontend Vite en HTTPS.
2. Configurar Supabase Auth + RLS + Storage.
3. Consumir la app desde Android/iOS como web app anclada (Add to Home Screen).
4. Mantener comandos Rust para reglas en Tauri desktop y pruebas internas.

## Paso siguiente (Tauri Mobile)
1. Instalar toolchain:
   - Android Studio + SDK/NDK
   - Xcode (macOS)
   - `cargo install tauri-cli --version '^2.0'`
2. Inicializar targets:
   - `npm run tauri android init`
   - `npm run tauri ios init`
3. Ajustar permisos de camara/escaneo QR en AndroidManifest e Info.plist.
4. Migrar flujo de escaneo a plugin nativo o bridge webview compatible.
5. Ejecutar:
   - `npm run tauri android dev`
   - `npm run tauri ios dev`

## QR y camara
- Para operar en navegador, usa un lector QR web (camera API) o pistola escaner HID.
- Para produccion movil nativa, mover el escaneo a plugin nativo reduce latencia y mejora estabilidad.

## Offline / cortes breves
- Mantener cola local de operaciones PENDING.
- Reintentos exponenciales al recuperar conectividad.
- En este repo, el helper `src/lib/retry.ts` cubre la capa de reintentos.
