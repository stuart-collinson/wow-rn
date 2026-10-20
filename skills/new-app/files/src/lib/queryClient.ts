import { QueryClient, onlineManager } from '@tanstack/react-query'
import { createAsyncStoragePersister } from '@tanstack/query-async-storage-persister'
import Constants from 'expo-constants'
import * as Network from 'expo-network'
import { DataError } from '@/lib/api/dataError'
import { kvStorage } from '@/lib/storage'
import { hours, seconds } from '@/lib/time'

const CACHE_MAX_AGE = hours(24)

onlineManager.setEventListener((setOnline) => {
  const subscription = Network.addNetworkStateListener((state) => setOnline(!!state.isConnected))
  return () => subscription.remove()
})

export const queryPersister = createAsyncStoragePersister({ storage: kvStorage })

export const persistOptions = {
  persister: queryPersister,
  maxAge: CACHE_MAX_AGE,
  buster: Constants.expoConfig?.version ?? '0',
}

export const createAppQueryClient = () =>
  new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: seconds(30),
        gcTime: CACHE_MAX_AGE,
        refetchOnWindowFocus: true,
        retry: (failureCount, error) => !(error instanceof DataError) && failureCount < 2,
      },
      mutations: {
        retry: false,
      },
    },
  })
