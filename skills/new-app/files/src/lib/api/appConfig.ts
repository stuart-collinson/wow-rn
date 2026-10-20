import { supabase } from '@/lib/supabase'
import { unwrap } from '@/lib/api/dataError'
import { appConfigSchema } from '@/schemas/appConfig.schema'
import type { AppConfig } from '@/schemas/appConfig.schema'

export const fetchAppConfig = async (): Promise<AppConfig> => {
  const rows = unwrap(await supabase.from('app_config').select('key, value'))
  return appConfigSchema.parse(Object.fromEntries(rows.map((row) => [row.key, row.value])))
}
