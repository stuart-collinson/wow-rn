import type { PostgrestError } from '@supabase/supabase-js'

export class DataError extends Error {
  constructor(
    public code: string,
    message: string,
    public details?: string,
  ) {
    super(message)
    this.name = 'DataError'
  }
}

type Result<T> = { data: T | null; error: PostgrestError | null }

export const unwrap = <T>({ data, error }: Result<T>): T => {
  if (error) throw new DataError(error.code, error.message, error.details)
  if (data === null) throw new DataError('NO_DATA', 'Query returned no data')
  return data
}

export const assertOk = ({ error }: { error: PostgrestError | null }): void => {
  if (error) throw new DataError(error.code, error.message, error.details)
}
