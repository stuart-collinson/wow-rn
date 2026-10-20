import type { QueryClient } from '@tanstack/react-query'
import { appConfigQuery } from '@/hooks/appConfig/appConfig.cache'

export const prefetchAppConfigQueries = (queryClient: QueryClient) => queryClient.prefetchQuery(appConfigQuery())
