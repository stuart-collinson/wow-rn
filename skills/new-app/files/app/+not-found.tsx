import { Link, Stack } from 'expo-router'
import { View } from 'react-native'
import { Text } from '@/components/ui/text'

const NotFoundScreen = () => (
  <>
    <Stack.Screen options={{ title: 'Not found' }} />
    <View className="flex-1 items-center justify-center gap-4 bg-background p-6">
      <Text className="text-xl font-bold text-foreground">This screen does not exist.</Text>
      <Link href="/">
        <Text className="text-primary">Go home</Text>
      </Link>
    </View>
  </>
)

export default NotFoundScreen
