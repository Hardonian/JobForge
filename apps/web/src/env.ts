import { z } from 'zod'

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  NEXT_PUBLIC_APP_URL: z.string().url().optional(),
})

const processEnv = {
  NODE_ENV: process.env.NODE_ENV,
  NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,
}

const result = envSchema.safeParse(processEnv)

if (!result.success) {
  console.error('Environment validation failed:')
  console.error(JSON.stringify(result.error.format(), null, 2))
  throw new Error('Invalid environment variables')
}

export const env = result.data

export type Env = z.infer<typeof envSchema>
