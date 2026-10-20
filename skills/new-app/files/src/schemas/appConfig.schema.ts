import { z } from 'zod'

export const appConfigSchema = z.object({
  ads_enabled: z.boolean().default(false),
  min_supported_version: z.string().default('0.0.0'),
})

export type AppConfig = z.infer<typeof appConfigSchema>
