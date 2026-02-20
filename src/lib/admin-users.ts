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
}

export interface InviteCompanyUserResponse extends AdminUsersListResponse {
  user: {
    userId: string
    email: string
    role: Role
    invited: boolean
    isGlobalSuperAdmin: boolean
  }
  message: string
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
        const responseBody = await error.context.json()
        if (
          responseBody &&
          typeof responseBody === 'object' &&
          'error' in responseBody &&
          typeof responseBody.error === 'string'
        ) {
          return Promise.reject(new Error(responseBody.error))
        }
      } catch {
        // fallback below
      }
    }
    throw new Error(error.message)
  }

  if (!data || typeof data !== 'object') {
    throw new Error('Respuesta invalida de admin-users')
  }

  if ('error' in data && typeof data.error === 'string') {
    throw new Error(data.error)
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
  })
}
