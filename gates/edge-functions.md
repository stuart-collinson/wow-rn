# Edge Functions

The app talks to Supabase directly and RLS is the authorisation layer, so there is no API server. The small amount of code that must run on a server lives in **Supabase Edge Functions** under `supabase/functions/`, written so it never depends on the runtime it happens to run on today. Deno, which Edge Functions run on, is winding down; Supabase has said existing functions keep working and a Node/Bun-capable successor is coming. Functions written to this gate move there, or to any Web-standard runtime, unchanged.

## When a function is justified

A function exists for exactly three reasons. Anything else is a gate failure.

| Reason | Example | Why the phone can't |
|---|---|---|
| **A webhook comes in** | RevenueCat posts a subscription event | the sender needs a URL and a shared secret |
| **A secret goes out** | calling an LLM, an email API, Expo's push service | the key would ship in the bundle |
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
└── send-push/
    └── index.ts
```

Folders are kebab-case. Each function is one handler. In `supabase/config.toml` every function declares `verify_jwt = false` — the platform's built-in check only understands the legacy keys — and verifies its caller itself (below).

## The portability rule

- A handler is `(request: Request) => Promise<Response>`. Web-standard APIs only: `Request`, `Response`, `fetch`, `URL`, `crypto`.
- Imports use **`npm:` specifiers** (`npm:@supabase/server`, `npm:zod`, `npm:expo-server-sdk`). No `https://deno.land/...`, no `jsr:`.
- **`Deno.*` appears in exactly one file**, `_shared/runtime.ts`. A handler never calls it.

```ts
// _shared/runtime.ts — the only file that knows the runtime
export const serve = (handler: (request: Request) => Promise<Response>): void => Deno.serve(handler)

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

## Secrets

- Secrets live in the project: `supabase secrets set REVENUECAT_WEBHOOK_SECRET=…`. Locally they come from `supabase/functions/.env`, which is gitignored and passed with `supabase functions serve --env-file supabase/functions/.env`.
- Read them through `getEnv('NAME')` so a missing secret fails at startup with its name, not with an undefined later.
- The platform injects `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEYS` and `SUPABASE_SECRET_KEYS`; nothing else about Supabase is configured by hand. The legacy key names never appear.

## Webhooks

A webhook handler authenticates the sender, validates the payload, and is idempotent.

```ts
// supabase/functions/revenuecat-webhook/index.ts
import { createAdminClient } from 'npm:@supabase/server/core'
import { z } from 'npm:zod'
import { getEnv, serve } from '../_shared/runtime.ts'

const eventSchema = z.object({ event: z.object({ id: z.string(), type: z.string(), app_user_id: z.string() }) })

serve(async (request) => {
  if (request.headers.get('Authorization') !== `Bearer ${getEnv('REVENUECAT_WEBHOOK_SECRET')}`) {
    return new Response('Unauthorized', { status: 401 })
  }

  const parsed = eventSchema.safeParse(await request.json())
  if (!parsed.success) return new Response('Bad payload', { status: 400 })

  const supabase = createAdminClient()   // a webhook has no caller; writes span users
  const { error } = await supabase.from('subscription_event').insert({ ... }) // event.id has a UNIQUE index → duplicate deliveries fail loudly
  if (error && error.code !== '23505') return new Response('Insert failed', { status: 500 })

  return new Response('ok')
})
```

- **The shared secret is compared on every request**; the URL being obscure is not authentication.
- **The payload is Zod-validated** before anything reads it; the sender's docs are not a contract.
- **Idempotency is a UNIQUE index** on the sender's event id (`database-standards`); a redelivery hits `23505` and returns success.
- Respond quickly with 2xx once the event is stored; do slow work from a trigger or `pg_cron`, not inside the webhook.

## The push sender

`send-push` reads `device_push_token` with the admin client for the users it is told to reach, sends through `npm:expo-server-sdk` (`new Expo().sendPushNotificationsAsync(chunk)` per `chunkPushNotifications` batch), and deletes tokens whose receipt says `DeviceNotRegistered`. It is called by `pg_net` from a trigger or a `pg_cron` schedule, or by an authenticated admin; it is never callable by `anon`.

## Local run, deploy, logs

```bash
supabase functions new <name>                       # scaffolds supabase/functions/<name>/index.ts
supabase functions serve --env-file supabase/functions/.env   # serves every function locally against `supabase start`
curl -X POST http://127.0.0.1:54321/functions/v1/<name> -H "Authorization: Bearer <token>"
supabase functions deploy <name>                    # deploys one function to the hosted project
```

Logs are in the dashboard (Functions → Logs). Log shaped fields with a `[function][step]` prefix — `console.log('[send-push][sent]', { userId, count })` — never a token, a secret, a full request body, or a payload with PII. Errors return a generic message to the caller; the detail goes to the log.

## Graduation: Hono

If an app ever needs a real API — business logic too tangled for RPC plus thin functions, or a second client — the answer is **Hono**, which runs on Node, Bun, Deno and Cloudflare Workers with the same Web-standard handlers this gate already mandates. The Zod schemas move across as they are, the handlers become routes, and in the app only `lib/api/` changes (`tanstack-query` → the seam). Traffic alone never justifies it at this scale; Supabase on a bigger compute tier does.
