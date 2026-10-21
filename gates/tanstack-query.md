# TanStack Query — Server State, Caching & the Data Layer

Server state lives in **TanStack Query v5** (`@tanstack/react-query`). This gate owns the data layer for the app: the per-domain directory shape, the Supabase network layer, query keys, stale times, `queryOptions`, hooks, mutations, invalidation, polling, pagination, persistence, and prefetch. Where this gate and the data-fetching notes in `frontend-patterns` / `project-structure` disagree, **this gate wins**.

It assumes the stack in `project-structure`. The point of the gate is not the example domain — it's the **shape** below.

---

## ⬛ The headline rule: every domain has the SAME structure

**This is the most important rule in the gate — weight it above the caching mechanics.** Every TanStack domain is laid out identically, split across two homes:

| File | Lives in | Holds |
| --- | --- | --- |
| `lib/api/<domain>.ts` | **`lib/api/`** — never under `hooks/` | the network layer: fetcher functions on `supabase-js` |
| `hooks/<domain>/<domain>.cache.ts` | `hooks/<domain>/` | query keys + stale times + `queryOptions` factories (one per domain, at the domain root) |
| `hooks/<domain>/use*.ts` | `hooks/<domain>/` | every hook — `useWorkouts`, `useWorkout`, `useCreateWorkout` — one per file |
| `hooks/<domain>/prefetch<Domain>Queries.ts` | `hooks/<domain>/` | warms the domain's queries (e.g. on sign-in) |

`<domain>` is the plural folder and fetcher name (`workouts`); `<Domain>` is the singular type name (`Workout`). Type and schema files are singular: `types/workout.types.ts`, `schemas/workout.schema.ts`.

**The dividing line: is it React / React-Query (hooks, query keys, `queryOptions`, `queryClient.query`) → `hooks/<domain>/`. Is it a Supabase call → `lib/api/<domain>.ts`.** A file with no React and no TanStack import never belongs under `hooks/`, and the Supabase client is never imported above `lib/`.

Each of these is a **gate failure**: a `supabase.from(...)` call under `hooks/`, in a component or a route file; a domain with reads but no `<domain>.cache.ts` (write-only network files such as `auth.ts`, `account.ts` and `pushTokens.ts` need none); a query key or `staleTime` hand-built inside a hook; a network file named `<domain>Api.ts` instead of `lib/api/<domain>.ts`; an `index.ts` barrel anywhere in the domain folder; a server read done with `useState` + `useEffect` instead of a cached `use*` hook.

## 0. File & folder map (the canonical layout)

```
src/
├── lib/
│   ├── supabase.ts               the typed client — createClient<Database>() (see security-standards)
│   ├── storage.ts                kvStorage — expo-sqlite/kv-store, shared by the persister and Zustand
│   ├── queryClient.ts            createAppQueryClient() + queryPersister + persistOptions
│   └── api/
│       ├── dataError.ts          DataError, NetworkError, unwrap() / assertOk() — the only place a Supabase error is interpreted
│       └── <domain>.ts           the domain's NETWORK layer (a sub-folder when it spans sub-resources)
└── hooks/
    └── <domain>/                 the domain's REACT-QUERY layer
        ├── <domain>.cache.ts     query keys + stale times + queryOptions factories — ALWAYS at the domain root
        ├── prefetch<Domain>Queries.ts   warms the domain's queries — ALWAYS at the domain root
        └── use*.ts               one hook per file (useWorkouts, useWorkout, useCreateWorkout, …)
```

## 0a. What's set up ONCE vs. what repeats

The **foundation is written once per app**: `lib/supabase.ts`, `lib/storage.ts`, `lib/queryClient.ts`, `lib/api/dataError.ts`, `lib/prefetch.ts`, `lib/time.ts`, and the provider, auth-listener and `focusManager` / `onlineManager` wiring (§2–§3). A new domain is copy-paste-and-rename of the **per-domain files** plus one line in `lib/prefetch.ts`; editing any other foundation file to add a domain means the shape has drifted.

## 1. Server state lives in TanStack Query

- Anything that comes from Supabase is **server state** and lives in the TanStack cache by default.
- Client / UI state (form drafts, toggles, selections, filters) stays in component state or Zustand — see `frontend-patterns`. **Never mirror query data into Zustand**: that creates two sources of truth that drift.
- **RLS scopes every row to the signed-in user.** Fetchers never filter by `user_id` — a client-side filter hides a missing policy.

## 2. One QueryClient — global defaults in `lib/queryClient.ts`

Create it **once** at the app root and tune defaults for mobile: TanStack's defaults (`staleTime: 0`, refetch on mount / focus / reconnect, `retry: 3`) are wasteful of battery and cellular data. Set a modest `staleTime` floor, let each domain tune up in its cache file, and give `gcTime` the same life as the persisted cache.

```ts
// lib/queryClient.ts
import { QueryClient } from '@tanstack/react-query'
import { createAsyncStoragePersister } from '@tanstack/query-async-storage-persister'
import Constants from 'expo-constants'
import * as Updates from 'expo-updates'
import { kvStorage } from '@/lib/storage'
import { hours, seconds } from '@/lib/time'

const CACHE_MAX_AGE = hours(24)

export const queryPersister = createAsyncStoragePersister({ storage: kvStorage })

export const persistOptions = {
  persister: queryPersister,
  maxAge: CACHE_MAX_AGE,
  buster: Updates.updateId ?? Constants.expoConfig?.version ?? '0',   // a new build or EAS Update never reads an old cache
}

export const createAppQueryClient = () =>
  new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: seconds(30),        // modest floor — most screens don't need fresher than this
        gcTime: CACHE_MAX_AGE,         // must be ≥ maxAge or the persisted cache is collected early
        refetchOnWindowFocus: true,    // wired to AppState in §3 for RN
        retry: false,                  // supabase-js already retries reads on a network failure
      },
      mutations: {
        retry: false,                  // user-triggered; never silently retried
        networkMode: 'always',         // fail fast offline instead of pausing — there is no offline queue
      },
    },
  })
```

`supabase-js` retries a GET itself — up to three retries with backoff on a network failure, a 503 or a 520 — so TanStack's retries stay off; stacking both turns one dead connection into a dozen requests. An `rpc()` is a POST and isn't retried. Without `networkMode: 'always'`, the `onlineManager` wiring (§3) pauses an offline write with `isPending` stuck on instead of failing it.

### 2a. The persisted cache — online-first, instant on relaunch

Mount the client with `PersistQueryClientProvider` so the last-seen data renders before the network answers and the app survives a tunnel. Use a lazy initialiser so the client survives re-renders.

```tsx
// app/_layout.tsx
import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client'
import { createAppQueryClient, persistOptions } from '@/lib/queryClient'

const [queryClient] = useState(() => createAppQueryClient())

return (
  <PersistQueryClientProvider client={queryClient} persistOptions={persistOptions}>
    {/* ...app... */}
  </PersistQueryClientProvider>
)
```

- Reads are instant from cache, then refetched when stale. **Writes need a connection** — there is no offline mutation queue; a failed mutation surfaces to the user (§8).
- **The auth listener clears the cache, not a button.** The session provider subscribes through `subscribeToAuthChanges()` in `lib/api/auth.ts` (wrapping `onAuthStateChange`), and on `SIGNED_OUT` or an `INITIAL_SESSION` with no session runs `queryClient.cancelQueries()`, `queryClient.clear()`, `await queryPersister.removeClient()` and resets every persisted Zustand store. Sessions end without anyone tapping sign-out — a revoked refresh token, an app killed mid-sign-out — and the persisted cache would otherwise show the next user the previous user's screens.
- **Sign-out** (`hooks/useSignOut.ts`) first does what needs the live session — `deletePushTokenRequest(token)` when push is on, `Purchases.logOut()` when payments are on, each in its own `try`/`catch` that logs and carries on — then `signOutRequest()`. A failed step never leaves the user signed in.

## 3. React Native wiring — `focusManager` + `onlineManager`

Two bits of wiring at the app root, done **once**. Without them, `refetchOnWindowFocus` never fires (there is no browser window) and queries keep firing with no connection.

```ts
// AppShell, inside a useEffect with cleanup — refetch stale queries when the app returns to the foreground
const subscription = AppState.addEventListener('change', (status) => focusManager.setFocused(status === 'active'))
return () => subscription.remove()

// lib/queryClient.ts, at module load — pause queries while offline, resume on reconnect (expo-network)
onlineManager.setEventListener((setOnline) => {
  const subscription = Network.addNetworkStateListener((state) => setOnline(!!state.isConnected))
  return () => subscription.remove()
})
```

## 4. The network layer — `lib/api/<domain>.ts` on `supabase-js`

### The error boundary — `lib/api/dataError.ts`

`supabase-js` returns `{ data, error }` instead of throwing. That contract is turned into a thrown, typed error in **one** place, so hooks, retry logic and screens deal in domain types and `DataError`, never in PostgREST shapes.

```ts
// lib/api/dataError.ts
import type { PostgrestError } from '@supabase/supabase-js'

type Result<T> = { data: T | null; error: PostgrestError | null }

export class DataError extends Error {
  constructor(public code: string, message: string, public details?: string) {
    super(message)
    this.name = 'DataError'
  }
}

export class NetworkError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'NetworkError'
  }
}

const toError = (error: PostgrestError): Error =>
  error.code ? new DataError(error.code, error.message, error.details) : new NetworkError(error.message)

export const unwrap = <T>({ data, error }: Result<T>): T => {
  if (error) throw toError(error)
  if (data === null) throw new DataError('NO_DATA', 'Query returned no data')
  return data
}

export const assertOk = ({ error }: { error: PostgrestError | null }) => {
  if (error) throw toError(error)
}
```

`unwrap` is for reads and writes that `.select()` a row back; `assertOk` is for writes that return nothing (`delete`, an `update` without `.select()`, an `rpc`). An error with no `code` is the network failing, not PostgREST, so it becomes a `NetworkError` and a screen can say "You're offline" rather than "Something went wrong".

### The domain fetchers — `lib/api/<domain>.ts`

A domain fetcher is **one query per operation**: the typed builder, explicit columns, `unwrap`/`assertOk`, a row mapper. Nothing more — no `try`/`catch`, no `user_id` filters (RLS), no presentation logic.

```ts
// lib/api/workouts.ts — the NETWORK layer (no React, no TanStack). Zero comments.
import { supabase } from '@/lib/supabase'
import { assertOk, unwrap } from '@/lib/api/dataError'
import { WORKOUT_COLUMNS, toWorkout } from '@/types/workout.types'
import type { Workout } from '@/types/workout.types'
import type { CreateWorkoutInput } from '@/schemas/workout.schema'

export type WorkoutListParams = { search?: string; cursor?: string; pageSize: number }

export const fetchWorkouts = async (params: WorkoutListParams) => {
  let query = supabase
    .from('workout')
    .select(WORKOUT_COLUMNS)
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(params.pageSize + 1)
  if (params.search) query = query.ilike('name', `%${params.search.replaceAll('*', '').replace(/[\\%_]/g, '\\$&')}%`)
  if (params.cursor) query = query.lt('created_at', params.cursor)
  const rows = unwrap(await query)
  const page = rows.slice(0, params.pageSize)
  const hasMore = rows.length > params.pageSize
  return { data: page.map(toWorkout), meta: { nextCursor: hasMore ? (page.at(-1)?.created_at ?? null) : null, hasMore } }
}

export const fetchWorkout = async (id: string): Promise<Workout> =>
  toWorkout(unwrap(await supabase.from('workout').select(WORKOUT_COLUMNS).eq('id', id).single()))

export const createWorkoutRequest = async (input: CreateWorkoutInput): Promise<Workout> =>
  toWorkout(unwrap(await supabase.from('workout').insert({ name: input.name, duration_minutes: input.durationMinutes }).select(WORKOUT_COLUMNS).single()))

export const deleteWorkoutRequest = async (id: string) =>
  assertOk(await supabase.from('workout').delete().eq('id', id))
```

- **Naming is a fixed convention.** Reads are `fetch<Domain>` for one row and `fetch<Domain>s` for a list (`fetchWorkout`, `fetchWorkouts`); every write is `<verb><Domain>Request`. No bare imperative names (`getWorkout`, `listWorkouts`).
- **Explicit columns, always.** `WORKOUT_COLUMNS` (`types/workout.types.ts`) lists every column the mapper reads; never `select('*')`. Related rows come from relational selects (`exercise:exercise_id(id, name)`), never a loop.
- **Rows are `snake_case`; domain types are `camelCase`.** The mapper (`toWorkout(row: WorkoutRow): Workout`) lives beside the type in `types/workout.types.ts`, where `WorkoutRow` is `Database['public']['Tables']['workout']['Row']` from the generated types. Hooks and screens never see a snake_case field.
- **Inserts never set `user_id`.** The column defaults to `auth.uid()` (see `database-standards`); the row belongs to whoever is signed in, and a client can't claim otherwise.
- **The seam.** Only `lib/api/` imports `@/lib/supabase` — fetchers, the auth wrappers and the realtime subscriptions — so changing how the app reaches its data changes only this folder.

## 5. The cache file — `<domain>.cache.ts`

One file per domain — the single place that controls its keys, stale times, and query definitions. It holds three things.

### (a) A hierarchical query-key factory

Keys are structured **general → specific** so invalidation can target a whole subtree by prefix: `invalidateQueries({ queryKey: keys.lists() })` clears every cached list; `keys.all` clears the whole domain. Flat keys (`['workout-list']`) share no prefix and lose that.

```ts
export const workoutKeys = {
  all: ['workouts'] as const,
  lists: () => [...workoutKeys.all, 'list'] as const,
  list: (params: Omit<WorkoutListParams, 'cursor'>) => [...workoutKeys.lists(), params] as const,
  details: () => [...workoutKeys.all, 'detail'] as const,
  detail: (id: string) => [...workoutKeys.details(), id] as const,
}
```

The root string is unique per domain; filters go *in* the key so each combination caches independently; no user id in the key (RLS scopes the data and sign-out clears the cache, §2a); and everything imports the factory — a hand-typed array drifts from the stored key and the invalidation silently misses.

### (b) Per-query stale times via `lib/time.ts`

Write durations through helpers (`seconds(n)`, `minutes(n)`, `hours(n)` in `lib/time.ts`), never bare `60 * 1000` literals. Keep a small local `STALE_TIMES` map; the `queryOptions` factories bake it in.

### (c) `queryOptions()` factories — REQUIRED

Define each read query's `queryKey` + `queryFn` + `staleTime` **once** with TanStack's `queryOptions` helper, then reuse the same object in the hook, the prefetch, and any `setQueryData`. The hook can't drift from the prefetch because both spread the same factory, and the key is type-tagged so `setQueryData` is checked against the query's data type.

```ts
// hooks/workouts/workouts.cache.ts
import { infiniteQueryOptions, queryOptions } from '@tanstack/react-query'
import { fetchWorkout, fetchWorkouts } from '@/lib/api/workouts'
import { minutes, seconds } from '@/lib/time'
import type { WorkoutListParams } from '@/lib/api/workouts'

const STALE_TIMES = { list: minutes(2), detail: seconds(30) } as const
const WORKOUT_LIST_DEFAULTS = { pageSize: 20 } as const

export const workoutKeys = { /* as above */ }

export const workoutListQuery = (params: Omit<WorkoutListParams, 'cursor'> = WORKOUT_LIST_DEFAULTS) =>
  infiniteQueryOptions({
    queryKey: workoutKeys.list(params),
    queryFn: ({ pageParam }) => fetchWorkouts({ ...params, cursor: pageParam }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.meta.nextCursor ?? undefined,
    staleTime: STALE_TIMES.list,
  })

export const workoutDetailQuery = (id: string) =>
  queryOptions({
    queryKey: workoutKeys.detail(id),
    queryFn: () => fetchWorkout(id),
    staleTime: STALE_TIMES.detail,
  })
```

## 6. Caching rules — tune to how fast the data changes

`staleTime` lives in the domain's cache file; `gcTime` stays at the global 24 hours. Slow-moving data (a profile, `app_config`) gets minutes to an hour; live data gets seconds or `0` plus polling (§9) or Realtime (§9a).

## 7. Hooks — thin React-Query bindings

Hooks are the only thing screens import. They spread a `queryOptions` factory and add runtime-only concerns (`enabled`, `placeholderData`). One named export per file; the file name matches the export.

```ts
// hooks/workouts/useWorkout.ts
import { useQuery } from '@tanstack/react-query'
import { workoutDetailQuery } from '@/hooks/workouts/workouts.cache'

export const useWorkout = (id: string | undefined) =>
  useQuery({
    ...workoutDetailQuery(id ?? ''),
    enabled: Boolean(id),
  })
```

- **Return the raw query result.** Don't rename `data` to `workout` or unwrap it — screens read `data`, `isPending`, `error`, `refetch` and handle the three states in priority order (`frontend-patterns` → Loading, Empty, Error).
- **`enabled` guards on the inputs the query needs.** A query with a missing dependency should not fire.
- Intra-domain imports use the `@/hooks/<domain>/…` and `@/lib/api/<domain>` aliases, never relative `./`.

## 8. Mutations & query invalidation — update what you know, invalidate what you don't

A mutation hook owns the write and the cache reconciliation that follows it. Prefer the **smallest correct reconciliation**:

- **`invalidateQueries` — the default.** Mark matching queries stale and let them refetch; the server stays the source of truth.

  ```ts
  // hooks/workouts/useCreateWorkout.ts
  import { useMutation, useQueryClient } from '@tanstack/react-query'
  import { createWorkoutRequest } from '@/lib/api/workouts'
  import { workoutKeys } from '@/hooks/workouts/workouts.cache'

  export const useCreateWorkout = () => {
    const queryClient = useQueryClient()
    return useMutation({
      mutationFn: createWorkoutRequest,
      onSuccess: () => queryClient.invalidateQueries({ queryKey: workoutKeys.lists() }),
    })
  }
  ```

- **`setQueryData` only with an authoritative value** (the mutation returned the updated row): `queryClient.setQueryData(workoutKeys.detail(id), updated)`. Otherwise invalidate.
- **Invalidate by the narrowest prefix that covers the change.** A new row in a list → `workoutKeys.lists()`, not `workoutKeys.all`.
- **On error, leave the cache untouched** (unless you ran an optimistic update) and surface the failure to the user. A `DataError` with code `42501` is a missing policy or grant — never something to retry or hide.
- **Optimistic UI is opt-in** for mutations whose result is predictable (toggling a favourite, renaming): in `onMutate` cancel the query, snapshot `getQueryData`, `setQueryData` the expected value and return the snapshot; in `onError` restore it; in `onSettled` invalidate. Never for destructive mutations (delete, archive) or unpredictable server results — show `mutation.isPending` there.

## 9. Polling with `refetchInterval`

Only for an async server-side process that must reach a terminal state. `refetchInterval` goes in the **hook**, never the `queryOptions` factory, in callback form so the terminal state stops it: `refetchInterval: (query) => isInProgress(query.state.data?.status) ? POLL_INTERVAL : false`. User-triggered refreshes are pull-to-refresh (`refetch`).

### 9a. Realtime — optional, per domain

When a screen must reflect other devices' writes live, subscribe to Supabase Realtime and **invalidate the matching keys** — never write payloads into the cache by hand. The subscription lives in the fetcher file (`subscribeToWorkouts(onChange)` returning an unsubscribe); a `useWorkoutsRealtime()` hook calls it in a `useEffect` and invalidates `workoutKeys.all`. Enable Realtime on the table in a migration; it is off by default.

## 10. Lists & pagination — `useInfiniteQuery` + `FlatList`

Long lists paginate by **keyset** (never offset): the fetcher orders by `created_at desc, id desc`, fetches one more row than the page size to learn `hasMore`, and returns the last row's `created_at` as `nextCursor` (§4). There is no URL to hold the cursor on a device, so it lives in the infinite-query cache, not in app state.

`useWorkouts(params?)` is `useInfiniteQuery(workoutListQuery(params))`; no params means the defaults, the same key the prefetch warms. The screen flattens `data?.pages.flatMap((page) => page.data)` into the `FlatList` and calls `fetchNextPage()` from `onEndReached`, **guarded on `hasNextPage && !isFetching`** — calling it while a fetch is in flight or with no next page races and double-fetches. A `created_at` cursor can skip rows sharing a timestamp to the microsecond; add the `id` tie-break with an `or(...)` filter only for batch-written tables.

## 11. Prefetch — a per-domain helper + one registry

Warm the cache for the screens the user lands on right after they sign in. Because the prefetch reuses the same `queryOptions`/`infiniteQueryOptions` factory, the eventual `useQuery` on the screen hits a populated, correctly-keyed entry — no duplicate fetch.

```ts
// hooks/workouts/prefetchWorkoutQueries.ts — the screen's own defaults, or you warm a key it never reads
export const prefetchWorkoutQueries = (queryClient: QueryClient) => queryClient.infiniteQuery(workoutListQuery())

// lib/prefetch.ts — one registry, walked once after sign-in; adding a domain is one line
const TASKS = [{ domain: 'workouts', run: prefetchWorkoutQueries }, { domain: 'appConfig', run: prefetchAppConfigQueries }]
export const prefetchInitialData = (queryClient: QueryClient) => {
  for (const task of TASKS) void task.run(queryClient).catch((error) => console.error(`[prefetch] ${task.domain} failed`, error))
}
```

Warm with `queryClient.query()` / `infiniteQuery()` (TanStack Query 5.102+; `prefetchQuery` is deprecated). They skip data that isn't stale yet and reject on failure, which the registry's `.catch` logs. Trigger it **once**, after a successful sign-in — not from a per-screen effect. Each task is fire-and-forget with its own `.catch` so one domain's failure can't sink the others.

## 12. The `appConfig` domain — remote config is just another query

Every app has an `app_config` table (`database-standards`) read by `anon` and `authenticated`, edited only in the Supabase dashboard. It follows the same shape as any domain, validated at the boundary because the values were typed by hand:

```ts
// schemas/appConfig.schema.ts
export const appConfigSchema = z.object({
  ads_enabled: z.boolean().default(false),
  min_supported_version: z.string().default('0.0.0'),
})
export type AppConfig = z.infer<typeof appConfigSchema>

// lib/api/appConfig.ts
export const fetchAppConfig = async (): Promise<AppConfig> => {
  const rows = unwrap(await supabase.from('app_config').select('key, value'))
  return appConfigSchema.parse(Object.fromEntries(rows.map((row) => [row.key, row.value])))
}

// hooks/appConfig/appConfig.cache.ts
export const appConfigQuery = () => queryOptions({ queryKey: ['appConfig'] as const, queryFn: fetchAppConfig, staleTime: minutes(5) })

// hooks/appConfig/useAppConfig.ts
export const useAppConfig = () => useQuery(appConfigQuery())
```

Consumers read `config?.ads_enabled === true` — a missing row, a failed fetch, or a cold cache all mean "off". The keys keep their database names because they are values in a `key` column, not columns.

## 13. Directory layout, barrels & comments

- **Sub-resources:** a domain spanning several gets `hooks/<domain>/<sub>/`, mirrored as `lib/api/<domain>/<sub>.ts`; the domain-root files stay at the root. Cross-cutting hooks (`useDebounce`) stay flat in `hooks/`. No `index.ts` barrel anywhere.
- **Comments:** hooks, prefetch files and fetchers have none; `<domain>.cache.ts` may carry one for non-obvious cache reasoning. Narrow errors with `error instanceof DataError`, never `as any`.
