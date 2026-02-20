import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.2'

type AppRole = 'BODEGUERO' | 'SUPERVISOR' | 'ADMIN' | 'SUPERADMIN'

type ListUsersRequest = {
  action: 'list'
  companyId: string
}

type InviteUserRequest = {
  action: 'invite'
  companyId: string
  email: string
  role: AppRole
  fullName?: string
  isGlobalSuperAdmin?: boolean
}

type RequestBody = ListUsersRequest | InviteUserRequest

type CompanyMembershipRow = {
  user_id: string
  role: AppRole
  is_active: boolean
  created_at: string
}

type ProfileRow = {
  id: string
  full_name: string | null
}

type GlobalRoleRow = {
  user_id: string
  is_super_admin: boolean
}

type AuthUserRow = {
  id: string
  email: string | null
  created_at: string
}

const corsHeaders: HeadersInit = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json',
}

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const allowedRoles: AppRole[] = ['BODEGUERO', 'SUPERVISOR', 'ADMIN', 'SUPERADMIN']

function jsonResponse(status: number, payload: unknown) {
  return new Response(JSON.stringify(payload), { status, headers: corsHeaders })
}

function getEnv(name: string): string {
  const value = Deno.env.get(name)
  if (!value) {
    throw new Error(`Missing environment variable ${name}`)
  }
  return value
}

function parseRequestBody(payload: unknown): RequestBody | null {
  if (!payload || typeof payload !== 'object') {
    return null
  }

  const body = payload as Partial<RequestBody>
  if (!body.action || !('companyId' in body) || typeof body.companyId !== 'string') {
    return null
  }

  if (body.action === 'list') {
    return {
      action: 'list',
      companyId: body.companyId,
    }
  }

  if (body.action === 'invite') {
    if (typeof body.email !== 'string' || typeof body.role !== 'string') {
      return null
    }
    return {
      action: 'invite',
      companyId: body.companyId,
      email: body.email,
      role: body.role as AppRole,
      fullName: typeof body.fullName === 'string' ? body.fullName : undefined,
      isGlobalSuperAdmin:
        typeof body.isGlobalSuperAdmin === 'boolean' ? body.isGlobalSuperAdmin : undefined,
    }
  }

  return null
}

async function resolveCallerId(authHeader: string, supabaseUrl: string, anonKey: string) {
  const callerClient = createClient(supabaseUrl, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: authHeader } },
  })

  const { data, error } = await callerClient.auth.getUser()
  if (error || !data.user) {
    throw new Error('UNAUTHORIZED')
  }
  return data.user.id
}

async function assertCanManageUsers(
  serviceClient: ReturnType<typeof createClient>,
  callerId: string,
  companyId: string,
) {
  const { data: company, error: companyError } = await serviceClient
    .from('companies')
    .select('id, name')
    .eq('id', companyId)
    .maybeSingle()

  if (companyError) {
    throw new Error(companyError.message)
  }

  if (!company) {
    throw new Error('COMPANY_NOT_FOUND')
  }

  const { data: globalRole, error: globalRoleError } = await serviceClient
    .from('global_roles')
    .select('is_super_admin')
    .eq('user_id', callerId)
    .maybeSingle()

  if (globalRoleError) {
    throw new Error(globalRoleError.message)
  }

  if (globalRole?.is_super_admin) {
    return { isGlobalSuperAdmin: true, companyName: company.name as string }
  }

  const { data: membership, error: membershipError } = await serviceClient
    .from('company_memberships')
    .select('role, is_active')
    .eq('company_id', companyId)
    .eq('user_id', callerId)
    .eq('is_active', true)
    .maybeSingle()

  if (membershipError) {
    throw new Error(membershipError.message)
  }

  if (!membership || membership.role !== 'SUPERADMIN') {
    throw new Error('FORBIDDEN')
  }

  return { isGlobalSuperAdmin: false, companyName: company.name as string }
}

async function listUsers(serviceClient: ReturnType<typeof createClient>, companyId: string) {
  const { data: memberships, error: membershipsError } = await serviceClient
    .from('company_memberships')
    .select('user_id, role, is_active, created_at')
    .eq('company_id', companyId)
    .order('created_at', { ascending: true })

  if (membershipsError) {
    throw new Error(membershipsError.message)
  }

  const rows = (memberships ?? []) as CompanyMembershipRow[]
  if (!rows.length) {
    return []
  }

  const userIds = rows.map((row) => row.user_id)

  const [{ data: profiles, error: profilesError }, { data: globalRoles, error: globalRolesError }] =
    await Promise.all([
      serviceClient.from('profiles').select('id, full_name').in('id', userIds),
      serviceClient.from('global_roles').select('user_id, is_super_admin').in('user_id', userIds),
    ])

  if (profilesError) {
    throw new Error(profilesError.message)
  }
  if (globalRolesError) {
    throw new Error(globalRolesError.message)
  }

  const { data: authUsers, error: authUsersError } = await serviceClient
    .schema('auth')
    .from('users')
    .select('id, email, created_at')
    .in('id', userIds)

  if (authUsersError) {
    throw new Error(authUsersError.message)
  }

  const profileMap = new Map((profiles as ProfileRow[] | null | undefined)?.map((row) => [row.id, row]))
  const globalRoleMap = new Map(
    (globalRoles as GlobalRoleRow[] | null | undefined)?.map((row) => [row.user_id, row]),
  )
  const authUserMap = new Map((authUsers as AuthUserRow[] | null | undefined)?.map((row) => [row.id, row]))

  return rows
    .map((row) => {
      const authUser = authUserMap.get(row.user_id)
      const profile = profileMap.get(row.user_id)
      const globalRole = globalRoleMap.get(row.user_id)

      return {
        userId: row.user_id,
        email: authUser?.email ?? 'unknown',
        role: row.role,
        isActive: row.is_active,
        fullName: profile?.full_name ?? null,
        isGlobalSuperAdmin: Boolean(globalRole?.is_super_admin),
        createdAt: authUser?.created_at ?? row.created_at,
      }
    })
    .sort((a, b) => a.email.localeCompare(b.email))
}

async function findUserByEmail(serviceClient: ReturnType<typeof createClient>, email: string) {
  const { data, error } = await serviceClient
    .schema('auth')
    .from('users')
    .select('id, email, created_at')
    .ilike('email', email)
    .limit(1)

  if (error) {
    throw new Error(error.message)
  }

  const rows = (data ?? []) as AuthUserRow[]
  return rows[0] ?? null
}

async function inviteOrActivateUser(
  serviceClient: ReturnType<typeof createClient>,
  payload: InviteUserRequest,
  canSetGlobalSuperAdmin: boolean,
) {
  const email = payload.email.trim().toLowerCase()
  if (!emailPattern.test(email)) {
    throw new Error('INVALID_EMAIL')
  }

  if (!allowedRoles.includes(payload.role)) {
    throw new Error('INVALID_ROLE')
  }

  if (payload.isGlobalSuperAdmin && !canSetGlobalSuperAdmin) {
    throw new Error('FORBIDDEN_GLOBAL_ROLE')
  }

  let user = await findUserByEmail(serviceClient, email)
  let invited = false

  if (!user) {
    const { data: invitedData, error: inviteError } = await serviceClient.auth.admin.inviteUserByEmail(email)
    if (inviteError || !invitedData.user?.id) {
      throw new Error(inviteError?.message ?? 'FAILED_TO_INVITE_USER')
    }

    user = {
      id: invitedData.user.id,
      email: invitedData.user.email ?? email,
      created_at: invitedData.user.created_at ?? new Date().toISOString(),
    }
    invited = true
  }

  if (payload.fullName && payload.fullName.trim().length > 0) {
    const { error: profileError } = await serviceClient.from('profiles').upsert(
      {
        id: user.id,
        full_name: payload.fullName.trim(),
      },
      { onConflict: 'id' },
    )

    if (profileError) {
      throw new Error(profileError.message)
    }
  }

  const { error: membershipError } = await serviceClient.from('company_memberships').upsert(
    {
      company_id: payload.companyId,
      user_id: user.id,
      role: payload.role,
      is_active: true,
    },
    { onConflict: 'company_id,user_id' },
  )

  if (membershipError) {
    throw new Error(membershipError.message)
  }

  if (payload.isGlobalSuperAdmin) {
    const { error: globalRoleError } = await serviceClient.from('global_roles').upsert(
      {
        user_id: user.id,
        is_super_admin: true,
      },
      { onConflict: 'user_id' },
    )

    if (globalRoleError) {
      throw new Error(globalRoleError.message)
    }
  }

  return {
    userId: user.id,
    email: user.email ?? email,
    role: payload.role,
    invited,
    isGlobalSuperAdmin: Boolean(payload.isGlobalSuperAdmin),
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  if (req.method !== 'POST') {
    return jsonResponse(405, { error: 'Method not allowed' })
  }

  try {
    const authHeader = req.headers.get('Authorization')
    if (!authHeader?.startsWith('Bearer ')) {
      return jsonResponse(401, { error: 'Missing bearer token' })
    }

    const supabaseUrl = getEnv('SUPABASE_URL')
    const anonKey = getEnv('SUPABASE_ANON_KEY')
    const serviceRoleKey = getEnv('SUPABASE_SERVICE_ROLE_KEY')
    const serviceClient = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    })

    const callerId = await resolveCallerId(authHeader, supabaseUrl, anonKey)
    const bodyRaw = await req.json().catch(() => null)
    const body = parseRequestBody(bodyRaw)

    if (!body) {
      return jsonResponse(400, { error: 'Invalid request body' })
    }

    const permissions = await assertCanManageUsers(serviceClient, callerId, body.companyId).catch((error) => {
      if (error instanceof Error && error.message === 'COMPANY_NOT_FOUND') {
        return 'COMPANY_NOT_FOUND'
      }
      if (
        error instanceof Error &&
        (error.message === 'FORBIDDEN' || error.message === 'FORBIDDEN_GLOBAL_ROLE')
      ) {
        return 'FORBIDDEN'
      }
      throw error
    })

    if (permissions === 'COMPANY_NOT_FOUND') {
      return jsonResponse(404, { error: 'Company not found' })
    }
    if (permissions === 'FORBIDDEN') {
      return jsonResponse(403, { error: 'No autorizado para gestionar usuarios' })
    }

    if (body.action === 'list') {
      const users = await listUsers(serviceClient, body.companyId)
      return jsonResponse(200, {
        companyId: body.companyId,
        companyName: permissions.companyName,
        users,
      })
    }

    const invitedUser = await inviteOrActivateUser(
      serviceClient,
      body,
      permissions.isGlobalSuperAdmin,
    ).catch((error) => {
      if (error instanceof Error && error.message === 'INVALID_EMAIL') {
        return 'INVALID_EMAIL'
      }
      if (error instanceof Error && error.message === 'INVALID_ROLE') {
        return 'INVALID_ROLE'
      }
      if (error instanceof Error && error.message === 'FORBIDDEN_GLOBAL_ROLE') {
        return 'FORBIDDEN_GLOBAL_ROLE'
      }
      throw error
    })

    if (invitedUser === 'INVALID_EMAIL') {
      return jsonResponse(400, { error: 'Email invalido' })
    }
    if (invitedUser === 'INVALID_ROLE') {
      return jsonResponse(400, { error: 'Rol invalido' })
    }
    if (invitedUser === 'FORBIDDEN_GLOBAL_ROLE') {
      return jsonResponse(403, { error: 'Solo un superadmin global puede asignar ese flag' })
    }

    const users = await listUsers(serviceClient, body.companyId)
    return jsonResponse(200, {
      companyId: body.companyId,
      companyName: permissions.companyName,
      user: invitedUser,
      users,
      message: invitedUser.invited ? 'Invitacion enviada' : 'Usuario actualizado',
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unhandled error'
    if (message === 'UNAUTHORIZED') {
      return jsonResponse(401, { error: 'Token invalido o expirado' })
    }
    return jsonResponse(500, { error: message })
  }
})
