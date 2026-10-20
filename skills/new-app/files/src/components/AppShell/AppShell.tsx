import { useEffect } from 'react'
import { AppState } from 'react-native'
import type { AppStateStatus } from 'react-native'
import { Stack } from 'expo-router'
import { ThemeProvider } from 'expo-router/react-navigation'
import { StatusBar } from 'expo-status-bar'
import { PortalHost } from '@rn-primitives/portal'
import { focusManager } from '@tanstack/react-query'
import Constants from 'expo-constants'
import { useUniwind } from 'uniwind'
import UpdateRequired from '@/components/UpdateRequired/UpdateRequired'
import { useAppConfig } from '@/hooks/appConfig/useAppConfig'
import { useSession } from '@/hooks/useSession'
import { NAV_THEME } from '@/lib/theme'
import { isVersionBelow } from '@/lib/version'

const FALLBACK_VERSION = '0.0.0'

const onAppStateChange = (status: AppStateStatus) => focusManager.setFocused(status === 'active')

const AppShell = () => {
  const { theme } = useUniwind()
  const { isAuthenticated, isLoading } = useSession()
  const { data: config } = useAppConfig()

  useEffect(() => {
    const subscription = AppState.addEventListener('change', onAppStateChange)
    return () => subscription.remove()
  }, [])

  if (isLoading) return null

  const appVersion = Constants.expoConfig?.version ?? FALLBACK_VERSION
  if (config && isVersionBelow(appVersion, config.min_supported_version)) return <UpdateRequired />

  return (
    <ThemeProvider value={NAV_THEME[theme ?? 'light']}>
      <StatusBar style={theme === 'dark' ? 'light' : 'dark'} />
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Protected guard={isAuthenticated}>
          <Stack.Screen name="(tabs)" />
        </Stack.Protected>
        <Stack.Protected guard={!isAuthenticated}>
          <Stack.Screen name="(auth)" />
        </Stack.Protected>
      </Stack>
      <PortalHost />
    </ThemeProvider>
  )
}

export default AppShell
