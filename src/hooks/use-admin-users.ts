import { useCallback, useEffect, useMemo, useState } from 'react'
import type { User } from '@supabase/supabase-js'
import { inviteCompanyUser, listCompanyUsers, type AdminCompanyUser } from '@/lib/admin-users'
import { requireSupabase, supabase } from '@/lib/supabase'
import type { Role } from '@/types/domain'

export interface CompanyOption {
  id: string
  name: string
}

export interface InviteFormInput {
  email: string
  role: Role
  fullName?: string
  isGlobalSuperAdmin?: boolean
  redirectTo?: string
}

type CompanyMembershipRole = {
  company_id: string
  role: Role
}

export interface UseAdminUsersState {
  isConfigured: boolean
  companies: CompanyOption[]
  selectedCompanyId: string
  setSelectedCompanyId: (companyId: string) => void
  selectedCompanyName: string | null
  companyRole: Role | null
  isGlobalSuperAdmin: boolean
  canManageUsers: boolean
  users: AdminCompanyUser[]
  loadingCompanies: boolean
  loadingUsers: boolean
  refreshCompanies: () => Promise<void>
  refreshUsers: () => Promise<void>
  inviteUser: (input: InviteFormInput) => Promise<{ invited: boolean; email: string }>
}

export function useAdminUsers(user: User | null): UseAdminUsersState {
  const [companies, setCompanies] = useState<CompanyOption[]>([])
  const [selectedCompanyId, setSelectedCompanyId] = useState('')
  const [memberships, setMemberships] = useState<CompanyMembershipRole[]>([])
  const [isGlobalSuperAdmin, setIsGlobalSuperAdmin] = useState(false)
  const [users, setUsers] = useState<AdminCompanyUser[]>([])
  const [loadingCompanies, setLoadingCompanies] = useState(false)
  const [loadingUsers, setLoadingUsers] = useState(false)

  const companyRole = useMemo(() => {
    if (!selectedCompanyId) {
      return null
    }
    const membership = memberships.find((value) => value.company_id === selectedCompanyId)
    return membership?.role ?? null
  }, [memberships, selectedCompanyId])

  const canManageUsers = Boolean(isGlobalSuperAdmin || companyRole === 'SUPERADMIN')

  const selectedCompanyName = useMemo(
    () => companies.find((value) => value.id === selectedCompanyId)?.name ?? null,
    [companies, selectedCompanyId],
  )

  const refreshCompanies = useCallback(async () => {
    if (!supabase || !user) {
      setCompanies([])
      setSelectedCompanyId('')
      setMemberships([])
      setIsGlobalSuperAdmin(false)
      return
    }

    const client = requireSupabase()
    setLoadingCompanies(true)

    try {
      const [{ data: companiesRows, error: companiesError }, { data: membershipRows, error: membershipError }] =
        await Promise.all([
          client.from('companies').select('id, name').order('name', { ascending: true }),
          client
            .from('company_memberships')
            .select('company_id, role')
            .eq('user_id', user.id)
            .eq('is_active', true),
        ])

      if (companiesError) {
        throw new Error(companiesError.message)
      }
      if (membershipError) {
        throw new Error(membershipError.message)
      }

      const { data: globalRoleRow, error: globalRoleError } = await client
        .from('global_roles')
        .select('is_super_admin')
        .eq('user_id', user.id)
        .maybeSingle()

      if (globalRoleError) {
        throw new Error(globalRoleError.message)
      }

      const companyOptions =
        companiesRows?.map((row) => ({
          id: row.id as string,
          name: row.name as string,
        })) ?? []

      const membershipOptions =
        membershipRows?.map((row) => ({
          company_id: row.company_id as string,
          role: row.role as Role,
        })) ?? []

      setCompanies(companyOptions)
      setMemberships(membershipOptions)
      setIsGlobalSuperAdmin(Boolean(globalRoleRow?.is_super_admin))

      setSelectedCompanyId((current) => {
        if (current && companyOptions.some((option) => option.id === current)) {
          return current
        }

        const superadminCompany = membershipOptions.find((row) => row.role === 'SUPERADMIN')
        if (superadminCompany) {
          return superadminCompany.company_id
        }

        return companyOptions[0]?.id ?? ''
      })
    } finally {
      setLoadingCompanies(false)
    }
  }, [user])

  const refreshUsers = useCallback(async () => {
    if (!user || !selectedCompanyId || !canManageUsers) {
      setUsers([])
      return
    }

    setLoadingUsers(true)
    try {
      const response = await listCompanyUsers(selectedCompanyId)
      setUsers(response.users)
    } finally {
      setLoadingUsers(false)
    }
  }, [canManageUsers, selectedCompanyId, user])

  async function inviteUser(input: InviteFormInput): Promise<{ invited: boolean; email: string }> {
    if (!selectedCompanyId) {
      throw new Error('Seleccione una empresa')
    }
    if (!canManageUsers) {
      throw new Error('No autorizado para gestionar usuarios')
    }

    const response = await inviteCompanyUser({
      companyId: selectedCompanyId,
      email: input.email,
      role: input.role,
      fullName: input.fullName,
      isGlobalSuperAdmin: input.isGlobalSuperAdmin,
      redirectTo: input.redirectTo,
    })

    setUsers(response.users)
    return {
      invited: response.user.invited,
      email: response.user.email,
    }
  }

  useEffect(() => {
    void refreshCompanies()
  }, [refreshCompanies])

  useEffect(() => {
    void refreshUsers()
  }, [refreshUsers])

  return {
    isConfigured: Boolean(supabase),
    companies,
    selectedCompanyId,
    setSelectedCompanyId,
    selectedCompanyName,
    companyRole,
    isGlobalSuperAdmin,
    canManageUsers,
    users,
    loadingCompanies,
    loadingUsers,
    refreshCompanies,
    refreshUsers,
    inviteUser,
  }
}
