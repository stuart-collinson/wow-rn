# Backend Patterns

Patterns for the API stack: **Express 5 (ESM) + TypeScript + Supabase JS client + Zod on Node 20+.** No ORM, no tRPC. The app (`apps/mobile`) talks to this API; the API talks to Supabase. Domain-driven layering: routes → controller → service → repository.

## Naming

| Kind | Convention |
|---|---|
| Domain folder | singular noun, lower-case (`workout/`, `user/`); kebab-case for multi-word (`role-group/`) |
| Routes | `<domain>.routes.ts` |
| Controller | `<domain>.controller.ts` |
| Service | `<domain>.service.ts` |
| Repository | `<domain>.repository.ts` |
| Zod schemas | `<domain>.validation.ts` (shared schemas live in `packages/shared`) |
| Domain types | `<domain>.types.ts` |
| Middleware | `middlewares/<name>.ts` |
| Cross-cutting infra | `lib/<name>.ts` |
| Env validation | `config/env.ts` |

Folder is singular (`workout/`); files inside match (`workout.controller.ts`). One layer per file. One default export per route file; named exports everywhere else.

```typescript
// Classes — PascalCase, singular, suffixed with the layer
export class WorkoutController { }
export class WorkoutService { }
export class WorkoutRepository { }

// Zod schemas — verb + noun + Schema; inferred input types suffix Input
export const createWorkoutSchema = z.object({ /* ... */ })
export type CreateWorkoutInput = z.infer<typeof createWorkoutSchema>
```

**DB columns are `snake_case`; API responses are `camelCase`.** The transform happens in the repository — controllers and services never see snake_case fields.

## ESM Imports

Node ESM requires the `.js` extension on relative imports, even though the source is `.ts`. Use `import type` for types-only imports.

```typescript
// PASS
import { WorkoutController } from './workout.controller.js'
import type { WorkoutService } from './workout.service.js'

// FAIL — missing extension, breaks at runtime under ESM
import { WorkoutController } from './workout.controller'
```

## TypeScript Discipline

`type` not `interface` (exceptions: declaration merging — e.g. extending Express `Request` — and `implements`). No `any`, no `@ts-ignore`; use `unknown` and narrow with Zod. Explicit return types on every function and method, including `Promise<void>` on handlers. Run with `strict: true` and `noUncheckedIndexedAccess: true` — `array[i]` is `T | undefined`, narrow before use.

## Domain Layering

Every domain follows a strict four-layer split. **Layers do not skip, and they do not call upward.**

```
HTTP  →  Routes  →  Controller  →  Service  →  Repository  →  Supabase
```

| Layer | Does | Must NOT do |
|---|---|---|
| Routes | Mount middleware, declare paths, wire DI | Business logic, call Supabase, define schemas |
| Controller | Parse request, call service, shape response | Run queries, call other domains' services, hold business rules |
| Service | Apply business rules, orchestrate, transform | Touch `req`/`res`, call Supabase directly, know about HTTP |
| Repository | Run Supabase queries, map rows → domain types | Apply business rules, throw HTTP-shaped errors |

A controller never queries Supabase. A service never imports from `express`. A repository never touches `req.user`. URL paths are plural (`/workouts`); folders, files, and classes are singular.

```typescript
// workout.routes.ts — DI wiring + paths
const repo = new WorkoutRepository()
const service = new WorkoutService(repo)
const controller = new WorkoutController(service)

router.get('/workouts', requireAuth, controller.list)
router.post('/workouts', requireAuth, controller.create)
export default router

// workout.controller.ts — auth, validate, call service, respond
export class WorkoutController {
  constructor(private readonly service: WorkoutService) {}

  create = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    const userId = req.user?.id
    if (!userId) return respondUnauthorized(res)

    const parsed = createWorkoutSchema.safeParse(req.body)
    if (!parsed.success) return respondValidationError(res, parsed.error)

    try {
      const workout = await this.service.createWorkout(userId, parsed.data)
      res.status(201).json({ success: true, data: workout })
    } catch (err) {
      respondDomainError(res, err, '[workout][create]')
    }
  }
}

// workout.service.ts — business rules, throws DomainError, framework-agnostic
export class WorkoutService {
  constructor(private readonly repo: WorkoutRepository) {}

  async createWorkout(userId: string, input: CreateWorkoutInput): Promise<Workout> {
    const record = await this.repo.create(userId, input)
    if (!record) throw new DomainError('CREATE_FAILED', 'Failed to create workout')
    return toWorkout(record)
  }
}

// workout.repository.ts — the only layer that talks to Supabase, returns domain types
export class WorkoutRepository {
  async create(userId: string, input: CreateWorkoutInput): Promise<WorkoutRecord | null> {
    const { data, error } = await supabaseServiceRole
      .from('workout')
      .insert({ user_id: userId, name: input.name, duration_minutes: input.durationMinutes })
      .select('id, user_id, name, duration_minutes, created_at, updated_at')
      .single()
    if (error) {
      console.error('[workout][repository.create] error:', error)
      return null
    }
    return data as WorkoutRecord
  }
}
```

## Control Flow & Style

Guard clauses, exit early, strip braces from one-line branches; 3+ levels of nesting is the smell. Immutable by default — build new objects, don't mutate inputs. Run independent calls with `Promise.all`; sequential `await` only when one call depends on the previous. (Full rules in `coding-standards`.)

## Input Validation — Zod

Every external input is validated with Zod before reaching the service layer. Use `safeParse` in controllers — never throw on user input. Use `parse` only when failure indicates a programmer error or a trusted-upstream contract breach. Schemas reused by both the app and the API live in `packages/shared` so client and server validate against one definition.

## Supabase Clients

Three flavours — defined once in `lib/supabase.ts`, never constructed inline.

| Client | Purpose | When |
|---|---|---|
| `supabaseAnon` | Anonymous, public key | Verifying JWTs (`auth.getUser`), nothing else |
| `createRequestClient(jwt)` | Per-request, carries the user's JWT | RLS-respecting reads/writes for the authenticated user — **the default** |
| `supabaseServiceRole` | Bypasses RLS | System jobs, admin operations, anything intentionally tenant-crossing |

The service-role key is a master key — using it where `createRequestClient(jwt)` would do is the same as having no RLS. A request that *needs* service-role to succeed for an end user is a missing RLS policy, not an excuse to bypass.

## Authentication & Authorisation

`requireAuth` middleware verifies the Supabase JWT and attaches `user` and `authToken` to the request.

- Every protected route mounts `requireAuth`. The only exception is `/health`.
- Read identity from `req.user.id` — never from the body, query, or params.
- **Authentication ≠ authorisation.** `requireAuth` confirms identity; the service layer confirms permission.

## Response Envelope

```typescript
res.status(201).json({ success: true, data: workout })
res.status(200).json({ success: true, data: workouts, meta: { nextCursor, hasMore: true } })
res.status(204).send()  // delete, no content

res.status(400).json({
  success: false,
  error: { code: 'VALIDATION_ERROR', message: 'Validation failed', details: [/* ... */] },
})
```

`code` is a stable machine-readable string; `message` is a short human summary; `details` is optional structured data.

| Status | Use | Status | Use |
|---|---|---|---|
| 200 | GET / PUT / PATCH ok | 403 | Authenticated, not authorised |
| 201 | POST created | 404 | Not found |
| 204 | DELETE, no body | 409 | Conflict (uniqueness, race) |
| 400 | Validation / malformed | 422 | Business-rule violation |
| 401 | Missing / invalid token | 429 | Rate limited |
| | | 500 | Unhandled server error |

## Error Handling

- **Services throw `DomainError`** with stable codes (`UNAUTHORIZED`, `FORBIDDEN`, `NOT_FOUND`, `CONFLICT`, `VALIDATION_ERROR`, plus domain-specific). Services don't decide HTTP status codes.
- **Controllers map errors via `respondDomainError(res, err, '[domain][method]')`** — one helper. Stack traces and `err.message` ship only when `NODE_ENV === 'development'`; production responses use a generic `INTERNAL_ERROR` envelope.
- **`app.ts` registers a four-arg error handler last** to catch anything that escaped a controller's try/catch.

## Logging

`console.log` / `console.error` with bracketed `[domain][layer.method]` prefixes. Errors → `console.error`; everything else → `console.log`.

- **Never log secrets** — no `Authorization` headers, JWTs, Supabase keys, passwords.
- **Never log full request bodies blindly** — they may contain PII. Log shaped fields by name (`{ userId, workoutId }`).
- Log decisions and outcomes, not control flow.

## Database Query Discipline

- **Select explicit columns** — never `.select('*')`. Schema drift silently widens responses.
- **Avoid N+1** — use Supabase relational selects (`user:user_id(id, name)`) instead of looping.
- **Cursor pagination over offset** — `limit` plus a stable cursor (`created_at`, `id`) avoids shifting pages under concurrent inserts.
- **Repositories transform rows → domain types** — controllers and services never see snake_case. The raw row types come from the generated `database.types.ts` in `packages/shared` (see `database-standards` → Workflow), not hand-maintained — so a schema change surfaces as a type error in the repository.
- **Parameterised everything** — the Supabase client parameterises automatically. Never compose SQL as a string; genuine raw-SQL needs go in a Postgres function (RPC) called via `client.rpc(...)`.

Schema, migrations, and RLS rules live in `database-standards`.

## Rate Limiting

Public, expensive, and third-party-fanout endpoints must be rate-limited: per-IP for unauthenticated routes, a higher per-user limit for general API, and a stricter limit on expensive operations (search, exports, uploads). A 429 is shaped like the standard error envelope and honours `Retry-After`.
