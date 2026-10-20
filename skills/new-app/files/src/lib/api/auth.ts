import * as AppleAuthentication from 'expo-apple-authentication'
import { GoogleSignin, isSuccessResponse } from '@react-native-google-signin/google-signin'
import type { Session } from '@supabase/supabase-js'
import { env } from '@/lib/env'
import { supabase } from '@/lib/supabase'

GoogleSignin.configure({
  webClientId: env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID,
  iosClientId: env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID,
})

export const getSessionRequest = async (): Promise<Session | null> => {
  const { data, error } = await supabase.auth.getSession()
  if (error) throw error
  return data.session
}

export const subscribeToAuthChanges = (onChange: (session: Session | null) => void): (() => void) => {
  const { data } = supabase.auth.onAuthStateChange((_event, session) => onChange(session))
  return () => data.subscription.unsubscribe()
}

export const signInWithAppleRequest = async (): Promise<void> => {
  const credential = await AppleAuthentication.signInAsync({
    requestedScopes: [
      AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
      AppleAuthentication.AppleAuthenticationScope.EMAIL,
    ],
  })
  if (!credential.identityToken) throw new Error('Apple sign-in returned no identity token')

  const { error } = await supabase.auth.signInWithIdToken({ provider: 'apple', token: credential.identityToken })
  if (error) throw error
}

export const signInWithGoogleRequest = async (): Promise<void> => {
  await GoogleSignin.hasPlayServices()
  const response = await GoogleSignin.signIn()
  if (!isSuccessResponse(response)) return

  const idToken = response.data.idToken
  if (!idToken) throw new Error('Google sign-in returned no id token')

  const { error } = await supabase.auth.signInWithIdToken({ provider: 'google', token: idToken })
  if (error) throw error
}

export const signOutRequest = async (): Promise<void> => {
  const { error } = await supabase.auth.signOut()
  if (error) throw error
}
