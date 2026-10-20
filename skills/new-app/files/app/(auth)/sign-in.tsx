import { StyleSheet, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import SignInButtons from '@/components/SignInButtons/SignInButtons'
import { Text } from '@/components/ui/text'

const styles = StyleSheet.create({
  screen: { flex: 1 },
})

const SignInScreen = () => (
  <SafeAreaView style={styles.screen}>
    <View className="flex-1 items-center justify-center gap-8 bg-background p-6">
      <Text className="text-3xl font-bold text-foreground">Welcome</Text>
      <SignInButtons />
    </View>
  </SafeAreaView>
)

export default SignInScreen
