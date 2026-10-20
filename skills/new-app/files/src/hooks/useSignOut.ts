import { useMutation, useQueryClient } from '@tanstack/react-query'
import { signOutRequest } from '@/lib/api/auth'
import { queryPersister } from '@/lib/queryClient'

export const useSignOut = () => {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async () => {
      await signOutRequest()
      queryClient.clear()
      await queryPersister.removeClient()
    },
  })
}
