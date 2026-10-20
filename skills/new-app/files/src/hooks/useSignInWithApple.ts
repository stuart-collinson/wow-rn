import { useMutation, useQueryClient } from '@tanstack/react-query'
import { signInWithAppleRequest } from '@/lib/api/auth'
import { prefetchInitialData } from '@/lib/prefetch'

export const useSignInWithApple = () => {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: signInWithAppleRequest,
    onSuccess: () => prefetchInitialData(queryClient),
  })
}
