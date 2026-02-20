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
  redirectTo?: string
}

type CreateUserRequest = {
  action: 'create'
  companyId: string
  email: string
  role: AppRole
  password: string
  fullName?: string
  isGlobalSuperAdmin?: boolean
}

type ResendInviteRequest = {
  action: 'resend'
  companyId: string
  email: string
  redirectTo?: string
}

type RequestBody = ListUsersRequest | InviteUserRequest | CreateUserRequest | ResendInviteRequest

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
  email_confirmed_at: string | null
}

const corsHeaders: HeadersInit = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json',
}

const allowedRoles: AppRole[] = ['BODEGUERO', 'SUPERVISOR', 'ADMIN', 'SUPERADMIN']
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const minPasswordLength = 8

function jsonResponse(status: number, payload: unknown) {
  return new Response(JSON.stringify(payload), { status, headers: corsHeaders })
}

function jsonError(status: number, code: string, message: string) {
  return jsonResponse(status, { code, error: message })
}

function getEnv(name: string): string {
  const value = Deno.env.get(name)
  if (!value) {
    throw new Error(`Missing environment variable ${name}`)
  }
  return value
}

function normalizeEmail(value: string): string {
  return value.trim().toLowerCase()
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
      redirectTo: typeof body.redirectTo === 'string' ? body.redirectTo : undefined,
    }
  }

  if (body.action === 'create') {
    if (typeof body.email !== 'string' || typeof body.role !== 'string' || typeof body.password !== 'string') {
      return null
    }
    return {
      action: 'create',
      companyId: body.companyId,
      email: body.email,
      role: body.role as AppRole,
      password: body.password,
      fullName: typeof body.fullName === 'string' ? body.fullName : undefined,
      isGlobalSuperAdmin:
        typeof body.isGlobalSuperAdmin === 'boolean' ? body.isGlobalSuperAdmin : undefined,
    }
  }

  if (body.action === 'resend') {
    if (typeof body.email !== 'string') {
      return null
    }
    return {
      action: 'resend',
      companyId: body.companyId,
      email: body.email,
      redirectTo: typeof body.redirectTo === 'string' ? body.redirectTo : undefined,
    }
  }

  return null
}

function resolveAuthHeader(req: Request, payload: unknown): string | null {
  const headerValue = req.headers.get('Authorization')
  if (headerValue?.startsWith('Bearer ')) {
    return headerValue
  }

  if (!payload || typeof payload !== 'object') {
    return null
  }

  const maybeToken = (payload as { accessToken?: unknown }).accessToken
  if (typeof maybeToken === 'string' && maybeToken.trim().length > 0) {
    return `Bearer ${maybeToken.trim()}`
  }

  return null
}

function resolveRedirect(redirectTo?: string) {
  const fallbackRedirect =
    Deno.env.get('APP_SITE_URL') ?? Deno.env.get('SITE_URL') ?? 'https://inventario-bodegas.vercel.app/'

  if (!redirectTo || redirectTo.trim().length === 0) {
    return fallbackRedirect
  }

  try {
    const candidate = new URL(redirectTo)
    if (candidate.protocol === 'https:' || candidate.hostname === 'localhost') {
      return candidate.toString()
    }
    return fallbackRedirect
  } catch {
    return fallbackRedirect
  }
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

async function listAllAuthUsers(serviceClient: ReturnType<typeof createClient>): Promise<AuthUserRow[]> {
  const perPage = 200
  let page = 1
  const users: AuthUserRow[] = []

  while (true) {
    const { data, error } = await serviceClient.auth.admin.listUsers({
      page,
      perPage,
    })

    if (error) {
      throw new Error(error.message)
    }

    const pageUsers = data?.users ?? []
    users.push(
      ...pageUsers.map((user) => ({
        id: user.id,
        email: user.email ?? null,
        created_at: user.created_at ?? new Date().toISOString(),
        email_confirmed_at: user.email_confirmed_at ?? null,
      })),
    )

    if (pageUsers.length < perPage) {
      break
    }
    page += 1
  }

  return users
}

async function findUserByEmail(serviceClient: ReturnType<typeof createClient>, email: string) {
  const users = await listAllAuthUsers(serviceClient)
  return users.find((user) => user.email?.toLowerCase() === email.toLowerCase()) ?? null
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

  const profileMap = new Map((profiles as ProfileRow[] | null | undefined)?.map((row) => [row.id, row]))
  const globalRoleMap = new Map(
    (globalRoles as GlobalRoleRow[] | null | undefined)?.map((row) => [row.user_id, row]),
  )

  let authUserMap = new Map<string, AuthUserRow>()
  try {
    const authUsers = await listAllAuthUsers(serviceClient)
    authUserMap = new Map(authUsers.map((user) => [user.id, user]))
  } catch (error) {
    const message = error instanceof Error ? error.message : 'unknown auth list error'
    console.error('admin-users listAllAuthUsers failed', message)
  }

  return rows
    .map((row) => {
      const profile = profileMap.get(row.user_id)
      const globalRole = globalRoleMap.get(row.user_id)
      const authUser = authUserMap.get(row.user_id)

      return {
        userId: row.user_id,
        email: authUser?.email ?? row.user_id,
        role: row.role,
        isActive: row.is_active,
        fullName: profile?.full_name ?? null,
        isGlobalSuperAdmin: Boolean(globalRole?.is_super_admin),
        createdAt: row.created_at,
        emailConfirmedAt: authUser?.email_confirmed_at ?? null,
        pendingInvite: authUser ? !authUser.email_confirmed_at : false,
      }
    })
    .sort((a, b) => a.email.localeCompare(b.email))
}

async function upsertAccessRows(
  serviceClient: ReturnType<typeof createClient>,
  payload:
    | Pick<InviteUserRequest, 'companyId' | 'role' | 'fullName' | 'isGlobalSuperAdmin'>
    | Pick<CreateUserRequest, 'companyId' | 'role' | 'fullName' | 'isGlobalSuperAdmin'>,
  userId: string,
) {
  if (payload.fullName && payload.fullName.trim().length > 0) {
    const { error: profileError } = await serviceClient.from('profiles').upsert(
      {
        id: userId,
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
      user_id: userId,
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
        user_id: userId,
        is_super_admin: true,
      },
      { onConflict: 'user_id' },
    )

    if (globalRoleError) {
      throw new Error(globalRoleError.message)
    }
  }
}

async function sendInviteWithFallback(
  serviceClient: ReturnType<typeof createClient>,
  email: string,
  redirectTo: string,
) {
  const { data: invitedData, error: inviteError } = await serviceClient.auth.admin.inviteUserByEmail(email, {
    redirectTo,
  })

  if (!inviteError && invitedData.user?.id) {
    return {
      userId: invitedData.user.id,
      email: invitedData.user.email ?? email,
      invited: true,
      actionLink: null as string | null,
    }
  }

  const { data: linkData, error: linkError } = await serviceClient.auth.admin.generateLink({
    type: 'invite',
    email,
    options: { redirectTo },
  })

  if (linkError) {
    throw new Error(inviteError?.message ?? linkError.message)
  }

  return {
    userId: linkData.user?.id ?? null,
    email: linkData.user?.email ?? email,
    invited: false,
    actionLink: linkData.properties?.action_link ?? null,
  }
}

async function inviteOrActivateUser(
  serviceClient: ReturnType<typeof createClient>,
  payload: InviteUserRequest,
  canSetGlobalSuperAdmin: boolean,
) {
  const email = normalizeEmail(payload.email)
  if (!emailPattern.test(email)) {
    throw new Error('INVALID_EMAIL')
  }

  if (!allowedRoles.includes(payload.role)) {
    throw new Error('INVALID_ROLE')
  }

  if (payload.isGlobalSuperAdmin && !canSetGlobalSuperAdmin) {
    throw new Error('FORBIDDEN_GLOBAL_ROLE')
  }

  const redirectTo = resolveRedirect(payload.redirectTo)
  let user = await findUserByEmail(serviceClient, email)
  let invited = false
  let actionLink: string | null = null

  if (!user) {
    const invitedResult = await sendInviteWithFallback(serviceClient, email, redirectTo)
    if (!invitedResult.userId) {
      throw new Error('FAILED_TO_INVITE_USER')
    }

    user = {
      id: invitedResult.userId,
      email: invitedResult.email,
      created_at: new Date().toISOString(),
      email_confirmed_at: null,
    }
    invited = invitedResult.invited
    actionLink = invitedResult.actionLink
  } else if (!user.email_confirmed_at) {
    const resent = await resendInvitation(serviceClient, {
      action: 'resend',
      companyId: payload.companyId,
      email,
      redirectTo,
    })
    invited = resent.resent
    actionLink = resent.actionLink
  }

  await upsertAccessRows(serviceClient, payload, user.id)

  return {
    userId: user.id,
    email: user.email ?? email,
    role: payload.role,
    invited,
    isGlobalSuperAdmin: Boolean(payload.isGlobalSuperAdmin),
    pendingInvitation: !user.email_confirmed_at,
    actionLink,
  }
}

async function createOrUpdateUserWithPassword(
  serviceClient: ReturnType<typeof createClient>,
  payload: CreateUserRequest,
  canSetGlobalSuperAdmin: boolean,
) {
  const email = normalizeEmail(payload.email)
  if (!emailPattern.test(email)) {
    throw new Error('INVALID_EMAIL')
  }

  if (!allowedRoles.includes(payload.role)) {
    throw new Error('INVALID_ROLE')
  }

  if (payload.password.length < minPasswordLength) {
    throw new Error('INVALID_PASSWORD')
  }

  if (payload.isGlobalSuperAdmin && !canSetGlobalSuperAdmin) {
    throw new Error('FORBIDDEN_GLOBAL_ROLE')
  }

  let user = await findUserByEmail(serviceClient, email)
  let created = false

  if (!user) {
    const { data, error } = await serviceClient.auth.admin.createUser({
      email,
      password: payload.password,
      email_confirm: true,
    })
    if (error || !data.user?.id) {
      throw new Error(error?.message ?? 'FAILED_TO_CREATE_USER')
    }
    user = {
      id: data.user.id,
      email: data.user.email ?? email,
      created_at: data.user.created_at ?? new Date().toISOString(),
      email_confirmed_at: data.user.email_confirmed_at ?? new Date().toISOString(),
    }
    created = true
  } else {
    const { data, error } = await serviceClient.auth.admin.updateUserById(user.id, {
      password: payload.password,
      email_confirm: true,
    })
    if (error) {
      throw new Error(error.message)
    }
    user = {
      id: data.user.id,
      email: data.user.email ?? email,
      created_at: data.user.created_at ?? user.created_at,
      email_confirmed_at: data.user.email_confirmed_at ?? new Date().toISOString(),
    }
  }

  await upsertAccessRows(serviceClient, payload, user.id)

  return {
    userId: user.id,
    email: user.email ?? email,
    role: payload.role,
    created,
    isGlobalSuperAdmin: Boolean(payload.isGlobalSuperAdmin),
  }
}

async function resendInvitation(
  serviceClient: ReturnType<typeof createClient>,
  payload: ResendInviteRequest,
) {
  const email = normalizeEmail(payload.email)
  if (!emailPattern.test(email)) {
    throw new Error('INVALID_EMAIL')
  }

  const user = await findUserByEmail(serviceClient, email)
  if (!user) {
    throw new Error('USER_NOT_FOUND')
  }
  if (user.email_confirmed_at) {
    throw new Error('USER_ALREADY_CONFIRMED')
  }

  const redirectTo = resolveRedirect(payload.redirectTo)

  let resent = false
  try {
    const maybeAuthClient = serviceClient.auth as unknown as {
      resend?: (params: {
        type: 'invite'
        email: string
        options?: { emailRedirectTo?: string }
      }) => Promise<{ error: { message: string } | null }>
    }

    if (typeof maybeAuthClient.resend === 'function') {
      const { error } = await maybeAuthClient.resend({
        type: 'invite',
        email,
        options: { emailRedirectTo: redirectTo },
      })
      if (!error) {
        resent = true
      }
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'unknown resend error'
    console.error('admin-users resend via auth.resend failed', message)
  }

  if (resent) {
    return {
      email,
      resent: true,
      actionLink: null as string | null,
      delivery: 'email' as const,
    }
  }

  const { data: linkData, error: linkError } = await serviceClient.auth.admin.generateLink({
    type: 'invite',
    email,
    options: { redirectTo },
  })

  if (linkError) {
    throw new Error(`FAILED_TO_RESEND_INVITE:${linkError.message}`)
  }

  return {
    email,
    resent: false,
    actionLink: linkData.properties?.action_link ?? null,
    delivery: 'manual_link' as const,
  }
}

function mapKnownError(message: string): { status: number; code: string; error: string } | null {
  const lower = message.toLowerCase()

  if (message === 'UNAUTHORIZED') {
    return { status: 401, code: 'UNAUTHORIZED', error: 'Token invalido o expirado' }
  }
  if (message === 'COMPANY_NOT_FOUND') {
    return { status: 404, code: 'COMPANY_NOT_FOUND', error: 'Empresa no encontrada' }
  }
  if (message === 'FORBIDDEN') {
    return { status: 403, code: 'FORBIDDEN', error: 'No autorizado para gestionar usuarios' }
  }
  if (message === 'INVALID_EMAIL') {
    return { status: 400, code: 'INVALID_EMAIL', error: 'Email invalido' }
  }
  if (message === 'INVALID_ROLE') {
    return { status: 400, code: 'INVALID_ROLE', error: 'Rol invalido' }
  }
  if (message === 'INVALID_PASSWORD') {
    return { status: 400, code: 'INVALID_PASSWORD', error: `Password minimo ${minPasswordLength} caracteres` }
  }
  if (message === 'FORBIDDEN_GLOBAL_ROLE') {
    return {
      status: 403,
      code: 'FORBIDDEN_GLOBAL_ROLE',
      error: 'Solo un superadmin global puede asignar ese flag',
    }
  }
  if (message === 'USER_NOT_FOUND') {
    return { status: 404, code: 'USER_NOT_FOUND', error: 'Usuario no encontrado' }
  }
  if (message === 'USER_ALREADY_CONFIRMED') {
    return { status: 409, code: 'USER_ALREADY_CONFIRMED', error: 'El usuario ya esta activo' }
  }
  if (message === 'FAILED_TO_INVITE_USER') {
    return {
      status: 500,
      code: 'FAILED_TO_INVITE_USER',
      error: 'No se pudo generar invitacion para el usuario',
    }
  }
  if (message === 'FAILED_TO_CREATE_USER') {
    return {
      status: 500,
      code: 'FAILED_TO_CREATE_USER',
      error: 'No se pudo crear el usuario',
    }
  }
  if (lower.includes('failed_to_resend_invite')) {
    return {
      status: 500,
      code: 'FAILED_TO_RESEND_INVITE',
      error: 'No se pudo reenviar la invitacion',
    }
  }
  if (lower.includes('duplicate key value')) {
    return {
      status: 409,
      code: 'DUPLICATE_VALUE',
      error: 'Ya existe un registro con esos datos',
    }
  }
  if (lower.includes('already registered')) {
    return {
      status: 409,
      code: 'USER_ALREADY_REGISTERED',
      error: 'El usuario ya esta registrado',
    }
  }

  return null
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  if (req.method !== 'POST') {
    return jsonError(405, 'METHOD_NOT_ALLOWED', 'Method not allowed')
  }

  try {
    const bodyRaw = await req.json().catch(() => null)
    const authHeader = resolveAuthHeader(req, bodyRaw)
    if (!authHeader) {
      return jsonError(401, 'MISSING_TOKEN', 'Missing bearer token')
    }

    const supabaseUrl = getEnv('SUPABASE_URL')
    const anonKey = getEnv('SUPABASE_ANON_KEY')
    const serviceRoleKey = getEnv('SUPABASE_SERVICE_ROLE_KEY')
    const serviceClient = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    })

    const callerId = await resolveCallerId(authHeader, supabaseUrl, anonKey)
    const body = parseRequestBody(bodyRaw)

    if (!body) {
      return jsonError(400, 'INVALID_REQUEST_BODY', 'Invalid request body')
    }

    const permissions = await assertCanManageUsers(serviceClient, callerId, body.companyId)

    if (body.action === 'list') {
      let users: Awaited<ReturnType<typeof listUsers>> = []
      try {
        users = await listUsers(serviceClient, body.companyId)
      } catch (error) {
        const message = error instanceof Error ? error.message : 'unknown list error'
        console.error('admin-users list failed', message)
      }

      return jsonResponse(200, {
        companyId: body.companyId,
        companyName: permissions.companyName,
        users,
      })
    }

    if (body.action === 'invite') {
      const user = await inviteOrActivateUser(serviceClient, body, permissions.isGlobalSuperAdmin)
      let users: Awaited<ReturnType<typeof listUsers>> = []
      try {
        users = await listUsers(serviceClient, body.companyId)
      } catch (error) {
        const message = error instanceof Error ? error.message : 'unknown post-invite list error'
        console.error('admin-users post-invite list failed', message)
      }

      const message = user.invited
        ? 'Invitacion enviada'
        : user.pendingInvitation
          ? 'Usuario pendiente de activacion'
          : 'Usuario actualizado'

      return jsonResponse(200, {
        companyId: body.companyId,
        companyName: permissions.companyName,
        user,
        users,
        message,
      })
    }

    if (body.action === 'create') {
      const user = await createOrUpdateUserWithPassword(serviceClient, body, permissions.isGlobalSuperAdmin)
      let users: Awaited<ReturnType<typeof listUsers>> = []
      try {
        users = await listUsers(serviceClient, body.companyId)
      } catch (error) {
        const message = error instanceof Error ? error.message : 'unknown post-create list error'
        console.error('admin-users post-create list failed', message)
      }

      return jsonResponse(200, {
        companyId: body.companyId,
        companyName: permissions.companyName,
        user,
        users,
        message: user.created ? 'Usuario creado y activado' : 'Usuario actualizado y activado',
      })
    }

    const resent = await resendInvitation(serviceClient, body)
    return jsonResponse(200, {
      companyId: body.companyId,
      companyName: permissions.companyName,
      email: resent.email,
      resent: resent.resent,
      actionLink: resent.actionLink,
      message: resent.resent
        ? 'Invitacion reenviada por correo'
        : 'No se pudo reenviar por correo; se genero enlace manual',
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unhandled error'
    console.error('admin-users error', message)
    const known = mapKnownError(message)
    if (known) {
      return jsonError(known.status, known.code, known.error)
    }
    return jsonError(500, 'INTERNAL_ERROR', message)
  }
})
