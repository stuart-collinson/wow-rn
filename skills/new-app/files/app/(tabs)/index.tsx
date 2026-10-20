import { View } from 'react-native'
import { Button } from '@/components/ui/button'
import { Text } from '@/components/ui/text'
import { useAppConfig } from '@/hooks/appConfig/useAppConfig'
import { useSession } from '@/hooks/useSession'
import { useSignOut } from '@/hooks/useSignOut'

const HomeScreen = () => {
  const { session } = useSession()
  const { data: config } = useAppConfig()
  const signOut = useSignOut()

  return (
    <View className="flex-1 items-center justify-center gap-6 bg-background p-6">
      <Text className="text-2xl font-bold text-foreground">Signed in</Text>
      <Text className="text-muted-foreground">{session?.user.email ?? 'No email on this account'}</Text>
      <Text className="text-muted-foreground">Ads enabled: {config?.ads_enabled === true ? 'yes' : 'no'}</Text>
      <Button variant="outline" onPress={() => signOut.mutate()} disabled={signOut.isPending}>
        <Text>Sign out</Text>
      </Button>
    </View>
  )
}

export default HomeScreen
