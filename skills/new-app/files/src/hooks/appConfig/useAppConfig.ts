import { useQuery } from '@tanstack/react-query'
import { appConfigQuery } from '@/hooks/appConfig/appConfig.cache'

export const useAppConfig = () => useQuery(appConfigQuery())
