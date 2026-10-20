import { useEffect, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import { getSessionRequest, subscribeToAuthChanges } from '@/lib/api/auth'

export const useSession = () => {
  const [session, setSession] = useState<Session | null>(null)
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    getSessionRequest()
      .then(setSession)
      .catch(() => setSession(null))
      .finally(() => setIsLoading(false))
    return subscribeToAuthChanges(setSession)
  }, [])

  return { session, isLoading, isAuthenticated: Boolean(session) }
}
