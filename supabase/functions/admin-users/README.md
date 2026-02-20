# admin-users Edge Function

Gestiona usuarios por empresa desde la app:
- `action: "list"`: lista miembros y sus roles de una empresa.
- `action: "invite"`: invita/activa usuario, asigna rol y opcionalmente marca superadmin global.

## Seguridad
- Requiere JWT del usuario llamante.
- Solo permite gestion si el llamante es:
  - superadmin global (`global_roles.is_super_admin = true`), o
  - `SUPERADMIN` activo en la empresa objetivo.

## Deploy
```bash
supabase functions deploy admin-users --project-ref <project_ref>
```

## Ejemplo de payload
```json
{
  "action": "invite",
  "companyId": "be803fb9-11c8-44ca-b47e-711390217d88",
  "email": "patosolt.25@gmail.com",
  "role": "SUPERVISOR",
  "fullName": "Pato Solt",
  "isGlobalSuperAdmin": false
}
```
