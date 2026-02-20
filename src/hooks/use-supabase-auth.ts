import { useEffect, useState } from 'react'
import type { Session, User } from '@supabase/supabase-js'
import { supabase, requireSupabase } from '@/lib/supabase'

export interface UseSupabaseAuthState {
  isConfigured: boolean
  loading: boolean
  user: User | null
  session: Session | null
  signIn: (email: string, password: string) => Promise<void>
  signOut: () => Promise<void>
}

export function useSupabaseAuth(): UseSupabaseAuthState {
  const [loading, setLoading] = useState(() => Boolean(supabase))
  const [session, setSession] = useState<Session | null>(null)

  useEffect(() => {
    if (!supabase) {
      return
    }

    let isMounted = true
    const client = requireSupabase()

    client.auth
      .getSession()
      .then(({ data, error }) => {
        if (!isMounted) {
          return
        }
        if (error) {
          setSession(null)
        } else {
          setSession(data.session ?? null)
        }
      })
      .finally(() => {
        if (isMounted) {
          setLoading(false)
        }
      })

    const {
      data: { subscription },
    } = client.auth.onAuthStateChange((_event, nextSession) => {
      if (isMounted) {
        setSession(nextSession)
      }
    })

    return () => {
      isMounted = false
      subscription.unsubscribe()
    }
  }, [])

  async function signIn(email: string, password: string): Promise<void> {
    const client = requireSupabase()
    const { error } = await client.auth.signInWithPassword({
      email: email.trim(),
      password,
    })

    if (error) {
      throw new Error(error.message)
    }
  }

  async function signOut(): Promise<void> {
    const client = requireSupabase()
    const { error } = await client.auth.signOut()
    if (error) {
      throw new Error(error.message)
    }
  }

  return {
    isConfigured: Boolean(supabase),
    loading,
    user: session?.user ?? null,
    session,
    signIn,
    signOut,
  }
}
