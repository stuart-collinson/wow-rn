import type { QueryClient } from '@tanstack/react-query'
import { prefetchAppConfigQueries } from '@/hooks/appConfig/prefetchAppConfigQueries'

const TASKS = [{ domain: 'appConfig', run: prefetchAppConfigQueries }]

export const prefetchInitialData = (queryClient: QueryClient): void => {
  for (const task of TASKS) {
    void task.run(queryClient).catch((error) => console.error(`[prefetch] ${task.domain} failed`, error))
  }
}
