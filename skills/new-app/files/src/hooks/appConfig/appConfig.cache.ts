import { queryOptions } from '@tanstack/react-query'
import { fetchAppConfig } from '@/lib/api/appConfig'
import { minutes } from '@/lib/time'

const STALE_TIMES = { config: minutes(5) } as const

export const appConfigKeys = {
  all: ['appConfig'] as const,
}

export const appConfigQuery = () =>
  queryOptions({
    queryKey: appConfigKeys.all,
    queryFn: fetchAppConfig,
    staleTime: STALE_TIMES.config,
  })
