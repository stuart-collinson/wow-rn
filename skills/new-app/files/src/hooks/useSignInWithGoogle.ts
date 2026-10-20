import { useMutation, useQueryClient } from '@tanstack/react-query'
import { signInWithGoogleRequest } from '@/lib/api/auth'
import { prefetchInitialData } from '@/lib/prefetch'

export const useSignInWithGoogle = () => {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: signInWithGoogleRequest,
    onSuccess: () => prefetchInitialData(queryClient),
  })
}
