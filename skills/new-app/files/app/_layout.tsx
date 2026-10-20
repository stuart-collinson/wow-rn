import '../global.css'
import { useState } from 'react'
import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client'
import AppShell from '@/components/AppShell/AppShell'
import { createAppQueryClient, persistOptions } from '@/lib/queryClient'

export { ErrorBoundary } from 'expo-router'

const RootLayout = () => {
  const [queryClient] = useState(() => createAppQueryClient())

  return (
    <PersistQueryClientProvider client={queryClient} persistOptions={persistOptions}>
      <AppShell />
    </PersistQueryClientProvider>
  )
}

export default RootLayout
