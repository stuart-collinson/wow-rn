import { Platform, StyleSheet, View } from 'react-native'
import * as AppleAuthentication from 'expo-apple-authentication'
import { Button } from '@/components/ui/button'
import { Text } from '@/components/ui/text'
import { useSignInWithApple } from '@/hooks/useSignInWithApple'
import { useSignInWithGoogle } from '@/hooks/useSignInWithGoogle'

const APPLE_BUTTON_HEIGHT = 48

const styles = StyleSheet.create({
  appleButton: { height: APPLE_BUTTON_HEIGHT },
})

const SignInButtons = () => {
  const signInWithApple = useSignInWithApple()
  const signInWithGoogle = useSignInWithGoogle()
  const isPending = signInWithApple.isPending || signInWithGoogle.isPending
  const error = signInWithApple.error ?? signInWithGoogle.error

  return (
    <View className="w-full gap-3 md:max-w-sm">
      {Platform.OS === 'ios' && (
        <AppleAuthentication.AppleAuthenticationButton
          buttonType={AppleAuthentication.AppleAuthenticationButtonType.SIGN_IN}
          buttonStyle={AppleAuthentication.AppleAuthenticationButtonStyle.BLACK}
          cornerRadius={10}
          style={styles.appleButton}
          onPress={() => signInWithApple.mutate()}
        />
      )}
      <Button onPress={() => signInWithGoogle.mutate()} disabled={isPending}>
        <Text>Continue with Google</Text>
      </Button>
      {error && <Text className="text-center text-destructive">{error.message}</Text>}
    </View>
  )
}

export default SignInButtons
