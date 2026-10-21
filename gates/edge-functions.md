# Edge Functions

There is no API server: the app talks to Supabase directly and RLS authorises. The little code that must run on a server lives in **Supabase Edge Functions** under `supabase/functions/`, written so it never depends on today's runtime. Deno, which Edge Functions run on, is winding down; Supabase says existing functions keep working and a Node/Bun-capable successor is coming. Functions written to this gate move there, or to any Web-standard runtime, unchanged.

## When a function is justified

A function exists for exactly three reasons. Anything else is a gate failure.

| Reason | Example | Why the phone can't |
|---|---|---|
| **A webhook comes in** | RevenueCat posts a subscription event | the sender needs a URL and a shared secret |
| **A secret goes out** | calling an LLM, an email API, Expo's push service, revoking a Sign in with Apple token | the key would ship in the bundle |
| **A privileged job** | an admin action, a job that spans users | the user's JWT can't, and shouldn't, do it |

Before writing one, check it isn't Postgres's job (`database-standards` → Functions, Triggers & Jobs): an atomic multi-table write is an RPC, a schedule is `pg_cron`, an outbound call from SQL is `pg_net`. And it is never "an API for the app" — the app reads and writes through `supabase-js` and RLS (`tanstack-query`).

## Layout

```
supabase/functions/
├── _shared/
│   ├── runtime.ts            serve() + getEnv() — the only file that mentions Deno
│   └── <helper>.ts           shared helpers and Zod schemas, Web-standard only
├── revenuecat-webhook/
│   └── index.ts              one function, one folder, index.ts is the entry
├── revoke-apple-token/
│   └── index.ts
└── send-push/
    └── index.ts
```

Folders are kebab-case. Each function is one handler. In `supabase/config.toml` a function only signed-in users call keeps `verify_jwt = true` (the platform check accepts the new signing keys); a webhook or a secret-key job sets `verify_jwt = false`. Every function still verifies its caller itself (below).

## The portability rule

- A handler is `(request: Request) => Promise<Response>`. Web-standard APIs only: `Request`, `Response`, `fetch`, `URL`, `crypto`.
- Imports use **`npm:` specifiers** (`npm:@supabase/server`, `npm:zod`, `npm:expo-server-sdk`). No `https://deno.land/...`, no `jsr:`.
- **`Deno.*` appears in exactly one file**, `_shared/runtime.ts`. A handler never calls it.

```ts
// _shared/runtime.ts — the only file that knows the runtime
export const serve = (handler: (request: Request) => Promise<Response>) => Deno.serve(handler)

export const getEnv = (name: string): string => {
  const value = Deno.env.get(name)
  if (!value) throw new Error(`Missing environment variable ${name}`)
  return value
}
```

Moving to another runtime means rewriting these six lines, nothing else.

## Verifying the caller

Authentication and the Supabase client come from `@supabase/server`, which reads the platform-provided `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEYS` and `SUPABASE_SECRET_KEYS` and runs on any runtime.

```ts
// supabase/functions/<name>/index.ts
import { createContextClient, verifyAuth } from 'npm:@supabase/server/core'
import { serve } from '../_shared/runtime.ts'

serve(async (request) => {
  const { data: auth, error } = await verifyAuth(request, { auth: 'user' })
  if (error) return Response.json({ message: error.message }, { status: error.status })

  const supabase = createContextClient({ auth: { token: auth.token, keyName: auth.keyName } })   // RLS applies
  const { data, error: queryError } = await supabase.from('workout').select('id').limit(1)
  if (queryError) return Response.json({ message: 'Query failed' }, { status: 500 })

  return Response.json({ data })
})
```

- **Identity comes from the verified token** (`auth.userClaims.id`), never from the request body or query string.
- **`createContextClient` is the default** — it carries the caller's JWT, so RLS still applies inside the function.
- **`createAdminClient()` bypasses RLS.** Use it only in a job that genuinely spans users or runs with no caller (a webhook, a scheduled send), and say why in a one-line comment at the call site. A function that *needs* it to serve an end user is a missing RLS policy, not a reason to bypass.
- **A job with no user** (a `pg_cron` schedule or a trigger calling through `pg_net`) authenticates with the project's secret key: `verifyAuth(request, { auth: 'secret' })` checks the `apikey` header against `SUPABASE_SECRET_KEYS`. The SQL side reads that key from Supabase Vault (`vault.decrypted_secrets`), never from a table or a migration.

## Secrets

- Secrets live in the project: `supabase secrets set REVENUECAT_WEBHOOK_SECRET=…`. Locally they come from `supabase/functions/.env`, which is gitignored and passed with `supabase functions serve --env-file supabase/functions/.env`.
- Read them through `getEnv('NAME')` so a missing secret fails at startup with its name, not with an undefined later.
- The platform injects `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEYS` and `SUPABASE_SECRET_KEYS`; nothing else about Supabase is configured by hand. The legacy key names never appear.

## Webhooks

A webhook handler authenticates the sender, validates the payload, and is idempotent.

```ts
// supabase/functions/revenuecat-webhook/index.ts
import { createAdminClient } from 'npm:@supabase/server/core'
import { getEnv, serve } from '../_shared/runtime.ts'
import { eventSchema, toEntitlementEvent } from '../_shared/revenuecat.ts'   // the fields you read, and their RPC parameters

serve(async (request) => {
  if (request.headers.get('Authorization') !== `Bearer ${getEnv('REVENUECAT_WEBHOOK_SECRET')}`) {
    return new Response('Unauthorized', { status: 401 })
  }

  const parsed = eventSchema.safeParse(await request.json())
  if (!parsed.success) return new Response('Bad payload', { status: 400 })

  const supabase = createAdminClient()   // a webhook has no caller; writes span users
  const { error } = await supabase.rpc('apply_entitlement_event', toEntitlementEvent(parsed.data))
  if (error) return new Response('Update failed', { status: 500 })

  return new Response('ok')
})
```

- **The shared secret is compared on every request**; the URL being obscure is not authentication.
- **The payload is Zod-validated** before anything reads it; the sender's docs are not a contract.
- **A redelivered or out-of-order event is a no-op**: a UNIQUE index on the sender's event id (`database-standards`), or, for RevenueCat, the `event_at` guard in `apply_entitlement_event()` (`store-and-monetisation`).
- Respond quickly with 2xx once the event is stored; do slow work from a trigger or `pg_cron`, not inside the webhook.

## Revoking Sign in with Apple

`revoke-apple-token` is called by the signed-in user during account deletion with `{ authorizationCode }`, Zod-validated. It signs a client secret (an ES256 JWT via `npm:jose`, per Apple's docs) from `APPLE_TEAM_ID`, `APPLE_KEY_ID`, `APPLE_PRIVATE_KEY` (the Sign in with Apple `.p8`) and `APPLE_CLIENT_ID` (the bundle id), exchanges the code at `https://appleid.apple.com/auth/token`, then posts the refresh token to `https://appleid.apple.com/auth/revoke` with `token_type_hint=refresh_token`. A failure is logged and returned as a 502; the app carries on deleting.

## The push sender

`send-push` reads `device_push_token` with the admin client for the users it is told to reach, sends through `npm:expo-server-sdk` in `chunkPushNotifications` batches, and deletes tokens whose receipt says `DeviceNotRegistered`. It is called by `pg_net` from a trigger or `pg_cron` with the secret key as `apikey` (verified with `auth: 'secret'`) — never by a user, signed in or not, or anyone could push to anyone.

## Local run, deploy, logs

`supabase functions serve --env-file supabase/functions/.env` runs every function against `supabase start`; `supabase functions deploy <name>` ships one. Logs are in the dashboard (Functions → Logs). Log shaped fields with a `[function][step]` prefix — `console.log('[send-push][sent]', { userId, count })` — never a token, a secret, a full request body, or a payload with PII. Errors return a generic message to the caller; the detail goes to the log.
