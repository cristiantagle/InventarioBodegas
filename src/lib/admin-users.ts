import { FunctionsHttpError } from '@supabase/supabase-js'
import { requireSupabase } from '@/lib/supabase'
import type { Role } from '@/types/domain'

export interface AdminCompanyUser {
  userId: string
  email: string
  role: Role
  isActive: boolean
  fullName: string | null
  isGlobalSuperAdmin: boolean
  createdAt: string
  emailConfirmedAt: string | null
  pendingInvite: boolean
}

export interface AdminUsersListResponse {
  companyId: string
  companyName: string
  users: AdminCompanyUser[]
}

export interface InviteCompanyUserInput {
  companyId: string
  email: string
  role: Role
  fullName?: string
  isGlobalSuperAdmin?: boolean
  redirectTo?: string
}

export interface CreateCompanyUserInput {
  companyId: string
  email: string
  role: Role
  password: string
  fullName?: string
  isGlobalSuperAdmin?: boolean
}

export interface ResendCompanyInviteInput {
  companyId: string
  email: string
  redirectTo?: string
}

export interface InviteCompanyUserResponse extends AdminUsersListResponse {
  user: {
    userId: string
    email: string
    role: Role
    invited: boolean
    isGlobalSuperAdmin: boolean
    pendingInvitation: boolean
    actionLink: string | null
  }
  message: string
}

export interface CreateCompanyUserResponse extends AdminUsersListResponse {
  user: {
    userId: string
    email: string
    role: Role
    created: boolean
    isGlobalSuperAdmin: boolean
  }
  message: string
}

export interface ResendCompanyInviteResponse {
  companyId: string
  companyName: string
  email: string
  resent: boolean
  actionLink: string | null
  message: string
}

type ErrorPayload = {
  error?: string
  code?: string
}

function fallbackRedirect() {
  if (typeof window !== 'undefined') {
    return `${window.location.origin}/`
  }
  return 'https://inventario-bodegas.vercel.app/'
}

function toFriendlyMessage(payload: ErrorPayload, fallbackMessage: string) {
  const code = payload.code
  const defaultMessage = payload.error ?? fallbackMessage

  if (!code) {
    return defaultMessage
  }

  const byCode: Record<string, string> = {
    MISSING_TOKEN: 'Sesion expirada. Inicie sesion nuevamente.',
    UNAUTHORIZED: 'Sesion invalida o expirada. Inicie sesion nuevamente.',
    FORBIDDEN: 'No autorizado para gestionar usuarios en esta empresa.',
    COMPANY_NOT_FOUND: 'Empresa no encontrada.',
    INVALID_REQUEST_BODY: 'Solicitud invalida. Recargue la pagina e intente de nuevo.',
    INVALID_EMAIL: 'Email invalido.',
    INVALID_ROLE: 'Rol invalido.',
    INVALID_PASSWORD: 'Password minimo 8 caracteres.',
    FORBIDDEN_GLOBAL_ROLE: 'Solo un superadmin global puede asignar Global SuperAdmin.',
    USER_NOT_FOUND: 'Usuario no encontrado.',
    USER_ALREADY_CONFIRMED: 'El usuario ya esta activo. No requiere invitacion.',
    FAILED_TO_INVITE_USER: 'No se pudo enviar la invitacion. Intente de nuevo.',
    FAILED_TO_CREATE_USER: 'No se pudo crear el usuario. Intente de nuevo.',
    FAILED_TO_RESEND_INVITE: 'No se pudo reenviar la invitacion por correo.',
    DUPLICATE_VALUE: 'Ya existe un registro con esos datos.',
    USER_ALREADY_REGISTERED: 'El usuario ya esta registrado.',
  }

  return byCode[code] ?? defaultMessage
}

async function invokeAdminUsers<T>(payload: Record<string, unknown>): Promise<T> {
  const client = requireSupabase()
  const {
    data: { session },
  } = await client.auth.getSession()

  if (!session?.access_token) {
    throw new Error('Sesion expirada. Inicie sesion nuevamente.')
  }

  const { data, error } = await client.functions.invoke('admin-users', {
    body: {
      ...payload,
      accessToken: session.access_token,
    },
  })

  if (error) {
    if (error instanceof FunctionsHttpError) {
      try {
        const responseBody = (await error.context.json()) as ErrorPayload
        throw new Error(toFriendlyMessage(responseBody, error.message))
      } catch {
        throw new Error(error.message)
      }
    }
    throw new Error(error.message)
  }

  if (!data || typeof data !== 'object') {
    throw new Error('Respuesta invalida de admin-users.')
  }

  if ('error' in data && typeof data.error === 'string') {
    const payloadError = data as ErrorPayload
    throw new Error(toFriendlyMessage(payloadError, payloadError.error ?? 'Error desconocido'))
  }

  return data as T
}

export async function listCompanyUsers(companyId: string): Promise<AdminUsersListResponse> {
  return invokeAdminUsers<AdminUsersListResponse>({
    action: 'list',
    companyId,
  })
}

export async function inviteCompanyUser(
  input: InviteCompanyUserInput,
): Promise<InviteCompanyUserResponse> {
  return invokeAdminUsers<InviteCompanyUserResponse>({
    action: 'invite',
    companyId: input.companyId,
    email: input.email,
    role: input.role,
    fullName: input.fullName,
    isGlobalSuperAdmin: input.isGlobalSuperAdmin ?? false,
    redirectTo: input.redirectTo ?? fallbackRedirect(),
  })
}

export async function createCompanyUser(
  input: CreateCompanyUserInput,
): Promise<CreateCompanyUserResponse> {
  return invokeAdminUsers<CreateCompanyUserResponse>({
    action: 'create',
    companyId: input.companyId,
    email: input.email,
    role: input.role,
    password: input.password,
    fullName: input.fullName,
    isGlobalSuperAdmin: input.isGlobalSuperAdmin ?? false,
  })
}

export async function resendCompanyInvite(
  input: ResendCompanyInviteInput,
): Promise<ResendCompanyInviteResponse> {
  return invokeAdminUsers<ResendCompanyInviteResponse>({
    action: 'resend',
    companyId: input.companyId,
    email: input.email,
    redirectTo: input.redirectTo ?? fallbackRedirect(),
  })
}
