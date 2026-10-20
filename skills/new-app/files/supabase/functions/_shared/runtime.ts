export const serve = (handler: (request: Request) => Promise<Response>): void => Deno.serve(handler)

export const getEnv = (name: string): string => {
  const value = Deno.env.get(name)
  if (!value) throw new Error(`Missing environment variable ${name}`)
  return value
}
