# TanStack Query — Server State, Caching & the Data Layer

Server state lives in **TanStack Query v5** (`@tanstack/react-query`). This gate owns the data layer for the app: the per-domain directory shape, the network client, query keys, stale times, `queryOptions`, hooks, mutations, invalidation, polling, pagination, and prefetch. Where this gate and the data-fetching notes in `frontend-patterns` / `project-structure` disagree, **this gate wins**.

It is written to be **project-agnostic**. It assumes the stack in `project-structure` (Expo app + Node/Express API + `packages/shared`), but nothing here depends on a particular auth or tenancy model — it works the same whether the app is single-user, multi-tenant, or has no users at all. Where a rule only applies to one of those, it says so.

The point of the gate is not the example domain — it's the **shape**. Every domain that touches the network is laid out identically, so any screen's data story reads the same way and a new domain is a copy-paste-and-rename away.

---

## ⬛ The headline rule: every domain has the SAME structure

**This is the most important rule in the gate — weight it above the caching mechanics.** Every TanStack domain is laid out identically, split across two homes:

| File | Lives in | Holds |
| --- | --- | --- |
| `lib/api/<domain>.ts` | **`lib/api/`** — never under `hooks/` | the network layer (fetcher functions) |
| `lib/api/<domain>/<sub>.ts` | `lib/api/<domain>/` | network sub-file when a domain has distinct sub-resources |
| `hooks/<domain>/<domain>.cache.ts` | `hooks/<domain>/` | query keys + stale times + `queryOptions` factories (one per domain, at the domain root) |
| `hooks/<domain>/use<Domain><Verb>.ts` | `hooks/<domain>/` | every `use*` hook — query, mutation, and domain-specific non-query — one per file |
| `hooks/<domain>/<sub>/use<Domain><SubVerb>.ts` | `hooks/<domain>/<sub>/` | hooks grouped under a sub-resource folder when a domain spans many sub-entities |
| `hooks/<domain>/prefetch<Domain>Queries.ts` | `hooks/<domain>/` | warms the domain's queries (e.g. on sign-in) |

**The dividing line, stated once and applied everywhere: is it React / React-Query (hooks, query keys, `queryOptions`, `prefetchQuery`) → `hooks/<domain>/`. Is it raw HTTP → `lib/api/<domain>.ts`.** A file with no React and no TanStack import never belongs under `hooks/`.

Each of these is a **gate failure**:

- a fetcher / `fetch` / `response.json()` living under `hooks/`;
- a domain with no `<domain>.cache.ts`;
- a query key or `staleTime` hand-built inside a hook instead of imported from the cache file;
- a network file named `<domain>Api.ts` (the `api/` folder already says "api") instead of `lib/api/<domain>.ts`;
- an `index.ts` barrel anywhere in the domain folder;
- a component calling `fetch` directly, or a server read done with `useState` + `useEffect` instead of a cached `use*` hook.

> This **reverses** the older "everything for a domain in one `lib/api/<domain>.ts` file" note. The network layer and the React-Query layer now live apart, on the rule above. Everything below elaborates this shape — §0 is the map.

## 0. File & folder map (the canonical layout)

```
src/
├── lib/
│   ├── queryClient.ts            createAppQueryClient() — global defaults (staleTime / gcTime / retry)
│   ├── prefetch.ts               the prefetch registry warmed after sign-in
│   ├── time.ts                   seconds() / minutes() duration helpers
│   └── api/
│       ├── client.ts             the typed HTTP client — unwraps the { success, data } envelope, attaches auth
│       ├── <domain>.ts           the domain's NETWORK layer (simple domain — one file)
│       └── <domain>/             or a sub-folder when the domain spans multiple sub-resources
│           └── <sub>.ts
└── hooks/
    ├── useDebounce.ts            generic, cross-cutting UI hooks stay flat here
    └── <domain>/                 the domain's REACT-QUERY layer
        ├── <domain>.cache.ts     query keys + stale times + queryOptions factories — ALWAYS at the domain root
        ├── prefetch<Domain>Queries.ts   warms the domain's queries — ALWAYS at the domain root
        ├── use<Domain><Verb>.ts  one hook per file (useWorkouts, useWorkout, useCreateWorkout, …)
        └── <sub>/                optional sub-folder when a domain spans many related sub-entities
            └── use<Domain><SubVerb>.ts
```

## 0a. What's set up ONCE vs. what repeats

Most of this gate is the **per-domain shape that repeats**. A small **foundation is wired a single time** when the app is stood up, then left alone:

- `lib/queryClient.ts` — `createAppQueryClient()` global defaults (§2)
- the root `QueryClientProvider` mount + the RN `focusManager` / `onlineManager` wiring (§2–§3)
- `lib/api/client.ts` — the envelope-unwrapping, auth-attaching HTTP client (§4)
- `lib/prefetch.ts` — the sign-in prefetch registry (§11)
- `lib/time.ts` — the `seconds()` / `minutes()` duration helpers (§5b)

Everything else — `lib/api/<domain>.ts`, `hooks/<domain>/<domain>.cache.ts`, the `use*` hooks, `prefetch<Domain>Queries.ts` — is **per domain** and is copy-paste-and-rename. If you find yourself editing a foundation file to add a domain, stop: the shape has drifted.

## 1. Server state lives in TanStack Query

- Anything that comes from the API or Supabase is **server state** and lives in the TanStack cache by default. Stop hand-rolling `useState` + `useEffect` + `fetch` for server reads.
- Client / UI state (form drafts, toggles, selections, filters) stays in component state or Zustand — see `frontend-patterns`. **Never mirror query data into Zustand**: that creates two sources of truth that drift. If a store genuinely needs a server value, read it from the query at the point of use.
- We use TanStack Query, **not tRPC**: the API is a separate REST service and shared types come from `packages/shared`, so tRPC's end-to-end-type-safety benefit doesn't apply.

## 2. One QueryClient — global defaults in `lib/queryClient.ts`

Create it **once** at the app root and tune defaults for mobile. TanStack v5's out-of-the-box defaults (`staleTime: 0`, refetch on mount / focus / reconnect, `retry: 3`) refetch aggressively — fine on the web, wasteful of battery and cellular data. Set a modest global `staleTime` floor to stop refetch storms when navigating between screens, then let each domain tune up from there in its cache file.

```ts
// lib/queryClient.ts
import { QueryClient } from '@tanstack/react-query'
import { minutes, seconds } from '@/lib/time'
import { ApiError } from '@/lib/api/client'

export const createAppQueryClient = () =>
  new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: seconds(30),        // modest floor — most screens don't need fresher than this
        gcTime: minutes(5),            // v5 renamed cacheTime → gcTime
        refetchOnWindowFocus: true,    // wired to AppState in §3 for RN
        retry: (failureCount, error) => {
          // 4xx are the caller's fault and won't fix themselves — surface immediately.
          if (error instanceof ApiError && error.status >= 400 && error.status < 500) return false
          return failureCount < 2
        },
      },
      mutations: {
        retry: false,                  // user-triggered; never silently retried
      },
    },
  })
```

Mount it with a lazy initialiser so the client survives re-renders, and add the devtools only in development:

```tsx
// app/_layout.tsx (or wherever the root providers live)
const [queryClient] = useState(() => createAppQueryClient())

return (
  <QueryClientProvider client={queryClient}>
    {/* ...app... */}
  </QueryClientProvider>
)
```

## 3. React Native wiring — `focusManager` + `onlineManager`

Two bits of wiring at the app root, done **once**, so focus-refetch and offline-pause behave on a device. Without them, `refetchOnWindowFocus` never fires (there is no browser window) and queries keep firing with no connection.

```tsx
// focus: refetch stale queries when the app returns to the foreground.
// Belongs in a useEffect with cleanup — not a bare module-level listener.
import { useEffect } from 'react'
import { AppState, Platform } from 'react-native'
import type { AppStateStatus } from 'react-native'
import { focusManager } from '@tanstack/react-query'

const onAppStateChange = (status: AppStateStatus) => {
  if (Platform.OS !== 'web') focusManager.setFocused(status === 'active')
}

useEffect(() => {
  const subscription = AppState.addEventListener('change', onAppStateChange)
  return () => subscription.remove()
}, [])
```

```ts
// online: pause queries/mutations when offline, resume on reconnect.
// Set once at module load, before the app renders.
import { onlineManager } from '@tanstack/react-query'
import NetInfo from '@react-native-community/netinfo'

onlineManager.setEventListener((setOnline) =>
  NetInfo.addEventListener((state) => setOnline(!!state.isConnected)),
)
```

On a pure-Expo project without `@react-native-community/netinfo`, the `expo-network` equivalent works too:

```ts
import * as Network from 'expo-network'

onlineManager.setEventListener((setOnline) => {
  const subscription = Network.addNetworkStateListener((state) => setOnline(!!state.isConnected))
  return subscription.remove
})
```

## 4. The network layer — `lib/api/<domain>.ts` on the shared client

### The shared client — `lib/api/client.ts`

The API speaks one envelope (see `backend-patterns` → Response Envelope): `{ success: true, data }` on success, `{ success: true, data, meta }` for paginated lists, `{ success: false, error: { code, message, details? } }` on failure, and an empty body for `204`. That contract is unwrapped in **one** place — `lib/api/client.ts` — which also attaches the auth token and turns a failure envelope into a typed `ApiError`. Everything downstream deals in domain types, never the envelope.

```ts
// lib/api/client.ts
import { supabase } from '@/lib/supabase'
import { env } from '@/lib/env'

export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string, public details?: unknown) {
    super(message)
    this.name = 'ApiError'
  }
}

type Envelope<T> = { success: true; data: T; meta?: PageMeta } | { success: false; error: { code: string; message: string; details?: unknown } }
export type PageMeta = { nextCursor: string | null; hasMore: boolean }

const request = async <T>(method: string, path: string, body?: unknown): Promise<{ data: T; meta?: PageMeta }> => {
  const { data: { session } } = await supabase.auth.getSession()
  const response = await fetch(`${env.EXPO_PUBLIC_API_URL}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(session ? { Authorization: `Bearer ${session.access_token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  })

  if (response.status === 204) return { data: undefined as T }

  const json = (await response.json()) as Envelope<T>
  if (!json.success) throw new ApiError(response.status, json.error.code, json.error.message, json.error.details)
  return { data: json.data, meta: json.meta }
}

export const apiClient = {
  get: async <T>(path: string): Promise<T> => (await request<T>('GET', path)).data,
  getPage: <T>(path: string) => request<T[]>('GET', path),       // returns { data, meta } for paginated lists
  post: async <T>(path: string, body?: unknown): Promise<T> => (await request<T>('POST', path, body)).data,
  put: async <T>(path: string, body?: unknown): Promise<T> => (await request<T>('PUT', path, body)).data,
  patch: async <T>(path: string, body?: unknown): Promise<T> => (await request<T>('PATCH', path, body)).data,
  del: async (path: string): Promise<void> => { await request<void>('DELETE', path) },
}
```

The verb set is deliberately small — add to it when a real need appears (a multipart upload, a no-body `POST`), but never re-implement envelope-unwrapping, auth headers, or the base URL inside a domain fetcher.

### The domain fetchers — `lib/api/<domain>.ts`

A domain fetcher is **one thin expression per endpoint** on the client: method, path, return type. Nothing more — no `fetch`, no `response.json()`, no envelope handling, no base URL.

```ts
// lib/api/workouts.ts — the NETWORK layer (no React, no TanStack). Zero comments.
import { apiClient } from '@/lib/api/client'
import type { Workout, CreateWorkoutInput } from '@acme/shared'

export type WorkoutListParams = { search?: string; cursor?: string; pageSize: number }

export const fetchWorkouts = (params: WorkoutListParams) => {
  const query = new URLSearchParams({ pageSize: String(params.pageSize) })
  if (params.search) query.set('search', params.search)
  if (params.cursor) query.set('cursor', params.cursor)
  return apiClient.getPage<Workout>(`/workouts?${query.toString()}`)
}

export const fetchWorkout = (id: string): Promise<Workout> =>
  apiClient.get<Workout>(`/workouts/${encodeURIComponent(id)}`)

export const createWorkoutRequest = (input: CreateWorkoutInput): Promise<Workout> =>
  apiClient.post<Workout>('/workouts', input)

export const deleteWorkoutRequest = (id: string): Promise<void> =>
  apiClient.del(`/workouts/${encodeURIComponent(id)}`)
```

- **Naming is a fixed convention.** GET reads are `fetch<Domain>` / `fetch<Domain>List`; every write is `<verb><Domain>Request` (`createWorkoutRequest`, `updateWorkoutRequest`, `deleteWorkoutRequest`). No bare imperative names (`getWorkout`, `listWorkouts`) — `fetch` for reads, `Request` suffix for writes.
- **Build querystrings with `URLSearchParams`** inside the fetcher and bake them into the path. There is no `params`/options argument on the client verbs.
- **Network-only.** Presentation helpers (a label map, a duration formatter) are not network code — they live in `lib/format.ts` or the component, never the fetcher.
- **Types.** Domain DTOs (`Workout`) live in `packages/shared` when both app and API use them, or `src/types/` when app-local. Small fetcher I/O types (`WorkoutListParams`) sit co-located in the fetcher file.

### How this links to the Node API

The fetcher file is the app's half of a contract the API serves. They line up one-to-one (full rules in `backend-patterns` and `project-structure`):

- **`lib/api/<domain>.ts` (app)** calls REST endpoints served by **`apps/api/src/<domain>/`** — that domain's `routes → controller → service → repository` stack. The URL is plural (`/workouts`); the API folder, files, and classes are singular (`workout/`, `WorkoutController`).
- **The envelope is the seam.** The API always responds in the `{ success, data }` shape `client.ts` expects; paginated endpoints add `meta: { nextCursor, hasMore }` (cursor pagination, never offset). Keep them in lockstep — a new field on the API DTO is a new field on the shared type.
- **One definition, both sides.** The Zod schema for a write payload and the inferred input/DTO types live in **`packages/shared`**, imported by the RN form (via `zodResolver`) and the Express validation layer alike. The client never validates against a type the server doesn't, because they import the same one.
- **Auth crosses the wire as a bearer token.** `client.ts` attaches the Supabase access token; the API's `requireAuth` verifies it and reads identity from the token, never from the body. A single-user or multi-tenant scoping decision is enforced server-side (RLS / the service layer), not by the query key — see §5.

## 5. The cache file — `<domain>.cache.ts`

One file per domain — the single place that controls its keys, stale times, and query definitions. It holds three things.

### (a) A hierarchical query-key factory

Keys are structured **general → specific** so invalidation can target a whole subtree by prefix. TanStack matches by prefix: `invalidateQueries({ queryKey: keys.lists() })` clears every cached list; `keys.all` clears the whole domain. Flat keys (`['workout-list']`) share no prefix and lose that.

```ts
export const workoutKeys = {
  all: ['workouts'] as const,
  lists: () => [...workoutKeys.all, 'list'] as const,
  list: (params: WorkoutListParams) => [...workoutKeys.lists(), params] as const,
  details: () => [...workoutKeys.all, 'detail'] as const,
  detail: (id: string) => [...workoutKeys.details(), id] as const,
}
```

- The domain root string is **unique per domain** (`['workouts', …]` vs `['exercises', …]`); the shared `'list'` / `'detail'` segments under different roots never collide.
- **Filters/params go *in* the key** so each combination caches independently. Object members are fine — TanStack hashes them deterministically and ignores key order.
- **Scope by a partition dimension only if your data has one.** This gate does **not** mandate a tenant/user id in the key. If the app is single-user (the server scopes by the authenticated user via RLS) the id is *not* in the key — the user can't switch identities mid-session, so it adds nothing. If the app is genuinely **multi-tenant and the active tenant can switch at runtime**, add that id to each leaf builder (`list(orgId, params)`, `detail(orgId, id)`) so caches can't bleed across tenants, and pass it from wherever the active tenant lives. Decide once per project; keep it consistent.
- **Everything imports the factory** — hooks, prefetch, and cache writes. Never hand-build a key inline: a hand-typed array drifts from the stored key and the invalidation silently misses.

### (b) Per-query stale times via `lib/time.ts`

Express durations through helpers, never bare `60 * 1000` literals. Keep a small local `STALE_TIMES` map; the `queryOptions` factories bake it in (nothing imports it directly).

```ts
// lib/time.ts
export const seconds = (n: number) => n * 1_000
export const minutes = (n: number) => n * 60_000
```

```ts
const STALE_TIMES = { list: minutes(2), detail: seconds(30) } as const
```

### (c) `queryOptions()` factories — REQUIRED

Define each read query's `queryKey` + `queryFn` + `staleTime` **once** with TanStack's `queryOptions` helper, then reuse the same object in the hook, the prefetch, and any `setQueryData`. This is the glue that makes the split safe: the hook can't drift from the prefetch because both spread the same factory, and the key is type-tagged so `setQueryData` is checked against the query's data type.

```ts
// hooks/workouts/workouts.cache.ts
import { queryOptions } from '@tanstack/react-query'
import { fetchWorkout } from '@/lib/api/workouts'
import { minutes, seconds } from '@/lib/time'
import type { WorkoutListParams } from '@/lib/api/workouts'

const STALE_TIMES = { list: minutes(2), detail: seconds(30) } as const

export const workoutKeys = { /* as above */ }

export const workoutDetailQuery = (id: string) =>
  queryOptions({
    queryKey: workoutKeys.detail(id),
    queryFn: () => fetchWorkout(id),
    staleTime: STALE_TIMES.detail,
  })
```

(Paginated lists use `infiniteQueryOptions` instead — see §10.)

## 6. Caching rules — tune to how fast the data changes

`staleTime` controls when a cached value is considered stale and eligible for a background refetch; `gcTime` controls how long an unused cache entry survives before it's garbage-collected. Decide both **in the domain's cache file**, where the timing reads alongside the query it governs.

- **Reference / slow-moving data** (a catalogue, a profile, settings) — long `staleTime` (minutes to an hour+). It rarely changes, so don't pay to refetch it on every screen focus.
- **Live / fast-moving data** (a feed during activity, anything tied to an in-progress process) — short `staleTime` or `0`, and consider polling (§9).
- **The global floor (§2) is a backstop, not a target.** It exists so navigation between screens doesn't trigger refetch storms; the per-query value is where the real decision lives.
- **`gcTime` ≥ `staleTime`.** Keep the default 5 min unless a screen is expensive to refetch and the user returns often (raise it) or the data is large and rarely revisited (lower it).

## 7. Hooks — thin React-Query bindings

Hooks are the only thing screens import. They spread a `queryOptions` factory and add runtime-only concerns (`enabled`, `placeholderData`). One named export per file; the file name matches the export.

```ts
// hooks/workouts/useWorkout.ts
import { useQuery } from '@tanstack/react-query'
import { workoutDetailQuery } from '@/hooks/workouts/workouts.cache'

export const useWorkout = (id: string | undefined) =>
  useQuery({
    ...workoutDetailQuery(id ?? ''),
    enabled: Boolean(id),   // don't fire until the id resolves
  })
```

- **Return the raw query result.** Don't rename `data` to `workout` or unwrap it — screens read `data`, `isLoading`, `error`, `refetch` and handle the three states in priority order (`frontend-patterns` → Loading, Empty, Error).
- **`enabled` guards on the inputs the query needs** (an id, a resolved session). A query with a missing dependency should not fire.
- Intra-domain imports use the `@/hooks/<domain>/…` and `@/lib/api/<domain>` aliases, never relative `./`.

## 8. Mutations & query invalidation — update what you know, invalidate what you don't

A mutation hook owns the write and the cache reconciliation that follows it. Prefer the **smallest correct reconciliation**:

- **`invalidateQueries` — the default.** Mark matching queries stale and let them refetch; the server stays the source of truth. Reach for it whenever the response doesn't hand you enough to patch confidently.

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

- **`setQueryData` — write the cache directly when you already hold the authoritative value** (the mutation returned the updated entity). Skips a round trip. Use the factory's typed key so the write is checked: `queryClient.setQueryData(workoutKeys.detail(id), updated)`. Don't hand-roll cache data you only *think* is right — invalidate instead.
- **Invalidate by the narrowest prefix that covers the change.** A new row in a list → `invalidateQueries({ queryKey: workoutKeys.lists() })`, not `workoutKeys.all`. Only widen to `all` when the change really does touch every shape of the domain.
- **On error, leave the cache untouched** (unless you ran an optimistic update — see below) and surface the failure to the user (a toast, or inline near the field).

### Optimistic UI — opt-in, with a rollback path

For mutations whose post-mutation state is predictable (toggling a favourite, renaming), update the cache before the server responds and roll back on error. TanStack owns the cache, so the optimistic value and the eventual server value live in one place. This is the canonical v5 shape — cancel in-flight refetches, snapshot, apply, roll back from the snapshot, then settle with an invalidate:

```ts
// hooks/workouts/useToggleFavourite.ts
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toggleFavouriteRequest } from '@/lib/api/workouts'
import { workoutKeys } from '@/hooks/workouts/workouts.cache'
import type { Workout } from '@acme/shared'

export const useToggleFavourite = () => {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: toggleFavouriteRequest,
    onMutate: async ({ id, favourited }) => {
      await queryClient.cancelQueries({ queryKey: workoutKeys.detail(id) })
      const previous = queryClient.getQueryData<Workout>(workoutKeys.detail(id))
      queryClient.setQueryData<Workout>(workoutKeys.detail(id), (old) =>
        old ? { ...old, favourited } : old,
      )
      return { previous, id }
    },
    onError: (_err, _vars, context) => {
      if (context?.previous) queryClient.setQueryData(workoutKeys.detail(context.id), context.previous)
    },
    onSettled: (_data, _err, { id }) => queryClient.invalidateQueries({ queryKey: workoutKeys.detail(id) }),
  })
}
```

Don't optimistically update **destructive** mutations (delete, archive) where a revert would jar, or mutations whose server result you can't predict (a server-assigned id, a derived field) — show a normal pending state (`mutation.isPending`) there.

## 9. Polling with `refetchInterval`

Some queries track an async server-side process (a render, an import, a sync) and must poll until it reaches a terminal state. `refetchInterval` belongs in the **hook**, never in a `queryOptions` factory — it's a runtime view concern, not a cache definition.

```ts
const POLL_INTERVAL = seconds(3)

export const useImportJob = (id: string | undefined) =>
  useQuery({
    ...importJobQuery(id ?? ''),
    enabled: Boolean(id),
    refetchInterval: (query) => {
      const status = query.state.data?.status
      return status === 'pending' || status === 'processing' ? POLL_INTERVAL : false
    },
  })
```

- **Callback form, not a bare number** — poll only while the data says the work is in progress; return `false` (stop) on a terminal state or absent data.
- **Name the interval constant** at the top of the hook file. No magic numbers.
- **Cap the poll** via a terminal-state condition (and/or a time bound). A poll that can run forever is a bug.
- Polling is for genuine async server work only. For anything user-triggered, prefer pull-to-refresh (`refetch`) or a Supabase realtime subscription.

## 10. Lists & pagination — `useInfiniteQuery` + `FlatList`

Long lists paginate with **cursor** pagination (the API returns `meta: { nextCursor, hasMore }` — see `backend-patterns`), consumed with `useInfiniteQuery` and rendered with `FlatList`. There is no URL to hold the cursor on a device, so the cursor lives in the infinite-query cache, not in app state.

Define the paginated query with `infiniteQueryOptions` in the cache file:

```ts
// hooks/workouts/workouts.cache.ts
import { infiniteQueryOptions } from '@tanstack/react-query'
import { fetchWorkouts } from '@/lib/api/workouts'

const DEFAULT_PAGE_SIZE = 20

export const workoutListQuery = (params: Omit<WorkoutListParams, 'cursor'>) =>
  infiniteQueryOptions({
    queryKey: workoutKeys.list(params),
    queryFn: ({ pageParam }) => fetchWorkouts({ ...params, cursor: pageParam, pageSize: params.pageSize ?? DEFAULT_PAGE_SIZE }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.meta?.nextCursor ?? undefined,
    staleTime: minutes(2),
  })
```

```ts
// hooks/workouts/useWorkouts.ts
import { useInfiniteQuery } from '@tanstack/react-query'
import { workoutListQuery } from '@/hooks/workouts/workouts.cache'

export const useWorkouts = (params: Omit<WorkoutListParams, 'cursor'>) =>
  useInfiniteQuery(workoutListQuery(params))
```

```tsx
// the screen — flatten pages, drive fetchNextPage off onEndReached
const { data, fetchNextPage, hasNextPage, isFetching, isFetchingNextPage, refetch } = useWorkouts({ pageSize: 20 })
const workouts = data?.pages.flatMap((page) => page.data) ?? []

return (
  <FlatList
    data={workouts}
    keyExtractor={(workout) => workout.id}
    renderItem={({ item }) => <WorkoutRow workout={item} />}
    onEndReached={() => hasNextPage && !isFetching && fetchNextPage()}
    onEndReachedThreshold={0.5}
    onRefresh={refetch}
    refreshing={isFetching && !isFetchingNextPage}
    ListFooterComponent={isFetchingNextPage ? <Spinner /> : null}
  />
)
```

- **Guard `fetchNextPage` on `hasNextPage && !isFetching`** — calling it while a fetch is in flight or with no next page races and double-fetches.
- For a **non-infinite paginated** screen (discrete page-at-a-time, rare on mobile), use `useQuery` with `placeholderData: keepPreviousData` so changing page doesn't flash a skeleton, and gate the "next" affordance on `isPlaceholderData` and `meta.hasMore`.
- Never `data.map()` a long list inside a `ScrollView` — that's a `frontend-patterns` failure regardless of where the data comes from.

## 11. Prefetch — a per-domain helper + one registry

Warm the cache for the screens the user lands on right after they sign in, so the first render reads from cache instead of showing a spinner. Because the prefetch reuses the same `queryOptions`/`infiniteQueryOptions` factory, the eventual `useQuery` on the screen hits a populated, correctly-keyed entry — no duplicate fetch.

- **Per domain: `prefetch<Domain>Queries.ts`** warms the domain's landing query (reusing the §5 factory). It returns a `Promise` so the registry can await/catch it. Filter values here **must match the screen's defaults**, or you warm a key the screen never reads.

  ```ts
  // hooks/workouts/prefetchWorkoutQueries.ts
  import type { QueryClient } from '@tanstack/react-query'
  import { workoutListQuery } from '@/hooks/workouts/workouts.cache'

  export const prefetchWorkoutQueries = (queryClient: QueryClient) =>
    queryClient.prefetchInfiniteQuery(workoutListQuery({ pageSize: 20 }))
  ```

  (Use `prefetchQuery` for a normal query, `prefetchInfiniteQuery` for an infinite one. Use `ensureQueryData` instead when you need the value back at the call site — it returns cached data or fetches.)

- **One registry: `lib/prefetch.ts`.** A flat list of the domains to warm, walked once after sign-in. Each task fires **fire-and-forget** with its own `.catch` so one domain's warm-up failure can't sink the others. Adding a domain is one line.

  ```ts
  // lib/prefetch.ts
  import type { QueryClient } from '@tanstack/react-query'
  import { prefetchWorkoutQueries } from '@/hooks/workouts/prefetchWorkoutQueries'

  const TASKS = [
    { domain: 'workouts', run: prefetchWorkoutQueries },
  ]

  export const prefetchInitialData = (queryClient: QueryClient): void => {
    for (const task of TASKS) {
      void task.run(queryClient).catch((error) => console.error(`[prefetch] ${task.domain} failed`, error))
    }
  }
  ```

- **Trigger it once**, after a successful sign-in and before navigating into the authed stack — not from a per-screen effect:

  ```ts
  // after sign-in succeeds
  prefetchInitialData(queryClient)
  router.replace('/(tabs)')
  ```

- Prefetch is opportunistic: silent on slow (the screen's own query takes over), silent on failure. Only warm domains users routinely land on; don't block navigation on it.

## 12. Directory layout & no barrels

- **Large domain (≈6+ hooks): own folder** `hooks/<domain>/` holding the domain's `<domain>.cache.ts`, `prefetch<Domain>Queries.ts`, its query/mutation `use*` hooks, **and any domain-specific non-query React hooks** (a selection hook, an upload-orchestration hook). The dividing line is §0's: React → `hooks/<domain>/`; raw HTTP → `lib/api/<domain>.ts`. A *cross-cutting* hook (`useDebounce`) stays flat in `hooks/` — see `frontend-patterns`.
- **Small domain (<6 hooks): stay flat** in `hooks/<domain>/` is still fine, but a one-query domain can live as a couple of files; don't over-fold.
- **Sub-resource sub-folders.** When a domain spans several distinct sub-resources each with their own hooks, group them in `hooks/<domain>/<sub>/`, with the network layer mirroring the split (`lib/api/<domain>/<sub>.ts`). The domain-root files (`<domain>.cache.ts`, `prefetch<Domain>Queries.ts`) always stay at the domain root.
- **No barrel / `index.ts` aggregator — anywhere.** Consumers import each hook directly: `import { useWorkout } from '@/hooks/workouts/useWorkout'`. Barrels invite circular imports, defeat tree-shaking, and pull the whole domain in to use one hook.
- **One name per concept:** `<domain>.cache.ts` (not `<domain>Keys.ts`); the network file is `lib/api/<domain>.ts` (no `Api` suffix).

## 13. Comments & style

Carry the universal `coding-standards` bar — comment the **why**, never the **what** — and hold the query layer to a *harder* bar:

- **`use<Domain><Verb>.ts` hooks and `prefetch<Domain>Queries.ts`: default to zero comments.** They are pure plumbing — a `useQuery`/`useMutation` spreading a factory, or a `prefetchQuery` call. There is nothing to explain.
- **`lib/api/<domain>.ts` fetchers: zero comments, no JSDoc.** A fetcher is one expression; the method and path already say what it does.
- **`<domain>.cache.ts` is the one place a comment is sanctioned**, and only for non-obvious cache reasoning ("invalidate rather than patch because cursor pagination can't place the new row", "key omits the tenant id because the server scopes by the authenticated user"). If the *why* is obvious from the code, no comment.
- No `as any` to read an error field — narrow it (`error instanceof ApiError`) or use a typed helper.

---

## Worked example — the `workouts` domain end to end

The full shape, copy-paste ready. This is what every new domain looks like the moment it lands.

```ts
// lib/api/workouts.ts — the NETWORK layer (no React, no TanStack). Zero comments.
import { apiClient } from '@/lib/api/client'
import type { Workout, CreateWorkoutInput } from '@acme/shared'

export type WorkoutListParams = { search?: string; cursor?: string; pageSize: number }

export const fetchWorkouts = (params: WorkoutListParams) => {
  const query = new URLSearchParams({ pageSize: String(params.pageSize) })
  if (params.search) query.set('search', params.search)
  if (params.cursor) query.set('cursor', params.cursor)
  return apiClient.getPage<Workout>(`/workouts?${query.toString()}`)
}

export const fetchWorkout = (id: string): Promise<Workout> =>
  apiClient.get<Workout>(`/workouts/${encodeURIComponent(id)}`)

export const createWorkoutRequest = (input: CreateWorkoutInput): Promise<Workout> =>
  apiClient.post<Workout>('/workouts', input)
```

```ts
// hooks/workouts/workouts.cache.ts — keys + stale times + queryOptions
import { infiniteQueryOptions, queryOptions } from '@tanstack/react-query'
import { fetchWorkout, fetchWorkouts } from '@/lib/api/workouts'
import { minutes, seconds } from '@/lib/time'
import type { WorkoutListParams } from '@/lib/api/workouts'

const STALE_TIMES = { list: minutes(2), detail: seconds(30) } as const
const DEFAULT_PAGE_SIZE = 20

export const workoutKeys = {
  all: ['workouts'] as const,
  lists: () => [...workoutKeys.all, 'list'] as const,
  list: (params: Omit<WorkoutListParams, 'cursor'>) => [...workoutKeys.lists(), params] as const,
  details: () => [...workoutKeys.all, 'detail'] as const,
  detail: (id: string) => [...workoutKeys.details(), id] as const,
}

export const workoutListQuery = (params: Omit<WorkoutListParams, 'cursor'>) =>
  infiniteQueryOptions({
    queryKey: workoutKeys.list(params),
    queryFn: ({ pageParam }) => fetchWorkouts({ ...params, cursor: pageParam, pageSize: params.pageSize ?? DEFAULT_PAGE_SIZE }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.meta?.nextCursor ?? undefined,
    staleTime: STALE_TIMES.list,
  })

export const workoutDetailQuery = (id: string) =>
  queryOptions({
    queryKey: workoutKeys.detail(id),
    queryFn: () => fetchWorkout(id),
    staleTime: STALE_TIMES.detail,
  })
```

```ts
// hooks/workouts/useWorkouts.ts — thin binding, reuses the factory
import { useInfiniteQuery } from '@tanstack/react-query'
import { workoutListQuery } from '@/hooks/workouts/workouts.cache'
import type { WorkoutListParams } from '@/lib/api/workouts'

export const useWorkouts = (params: Omit<WorkoutListParams, 'cursor'>) =>
  useInfiniteQuery(workoutListQuery(params))
```

```ts
// hooks/workouts/useCreateWorkout.ts — mutation, invalidate the lists
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

```ts
// hooks/workouts/prefetchWorkoutQueries.ts — warms the landing list on sign-in
import type { QueryClient } from '@tanstack/react-query'
import { workoutListQuery } from '@/hooks/workouts/workouts.cache'

export const prefetchWorkoutQueries = (queryClient: QueryClient) =>
  queryClient.prefetchInfiniteQuery(workoutListQuery({ pageSize: 20 }))
```

```ts
// lib/prefetch.ts — register the domain (one line)
const TASKS = [
  { domain: 'workouts', run: prefetchWorkoutQueries },
]
```

---

## Adopt on a new domain — checklist

When a domain (`<domain>`) goes on TanStack Query, in order:

1. **Network layer →** `lib/api/<domain>.ts` (or `lib/api/<domain>/` for a multi-sub-resource domain). One expression per endpoint on the shared `lib/api/client.ts`. Naming: `fetch<Domain>[List]` for reads, `<verb><Domain>Request` for writes. No `fetch`/`response.json()`, no envelope unwrap, no base URL, no `Api` suffix, no comments.
2. **Cache file →** `hooks/<domain>/<domain>.cache.ts` (always at the domain root): a hierarchical key factory, a local `STALE_TIMES` map (via `lib/time.ts`), and a **`queryOptions`/`infiniteQueryOptions` factory per read query** — mandatory; hook, prefetch, and cache writes all reuse it.
3. **Hooks →** `hooks/<domain>/use<Domain><Verb>.ts`, one export per file, spreading the factory. `enabled` guards on the inputs the query needs.
4. **Mutations →** invalidate the narrowest prefix that covers the change, or `setQueryData` when the response is authoritative. Optimistic only when the result is predictable, with a rollback path.
5. **Polling →** if a query tracks an async server process, add `refetchInterval: (query) => …` in the hook (not the cache file). Name the interval; cap the poll.
6. **Pagination →** cursor-based via `useInfiniteQuery` + `FlatList` `onEndReached`, off the API's `meta.nextCursor`.
7. **Prefetch →** `hooks/<domain>/prefetch<Domain>Queries.ts` warming the landing query (filters matching the screen's defaults); register one line in `lib/prefetch.ts`. Omit only for domains users don't routinely land on.
8. **No barrel.** No `index.ts` anywhere in the domain tree; import each hook directly.
