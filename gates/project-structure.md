# Project Structure

The shape of a React Native project: a **pnpm workspace monorepo** with an Expo app, a Node/Express API, and shared code. `pnpm` is the package manager everywhere — never `npm` or `yarn`. Every install is `pnpm add`, every script is `pnpm <script>`, every workspace command is `pnpm --filter <pkg> <script>`.

## Monorepo Layout

```
.
├── apps/
│   ├── mobile/                 # Expo app (Expo Router)
│   └── api/                    # Node/Express API (see backend-patterns)
├── packages/
│   └── shared/                 # Cross-app code: Zod schemas, domain types, generated DB types
├── supabase/                   # Supabase CLI project (created by `supabase init`) — see database-standards
│   ├── config.toml             # local stack + project config
│   ├── migrations/             # YYYYMMDDhhmmss_*.sql — the schema, in code
│   └── seed.sql                # local seed data
├── pnpm-workspace.yaml
├── package.json                # root scripts only; deps live in the workspaces
└── tsconfig.base.json          # shared compiler options, extended by each workspace
```

`packages/shared` is the home for anything both the app and the API need — most importantly the **Zod schemas and inferred types** for API payloads (so the client and server validate against one definition), and the **generated database types** (`supabase gen types` output). A schema used by both sides lives here, never duplicated.

### `supabase/` lives at the repo root

The Supabase CLI operates on the `supabase/` directory in the current working directory, so it lives at the **repo root** — that's what makes `supabase link` / `supabase db push` / `supabase db reset` work without any `--workdir` juggling. The database is shared infrastructure: the API queries it, and the app talks to Supabase directly for auth, so neither app "owns" it. Run all `supabase` commands from the repo root, and wrap the common ones as root `package.json` scripts (`pnpm db:push`, `pnpm db:reset`, `pnpm db:types`). The full migration workflow lives in `database-standards`.

## Expo App Layout (`apps/mobile`)

Expo Router is **file-based**: the route tree *is* the `app/` directory. Everything that isn't a route lives in `src/`, grouped by kind.

```
apps/mobile/
├── app/                        # Expo Router routes — the file tree is the navigation tree
│   ├── _layout.tsx             # Root layout: providers + auth gate (Stack.Protected)
│   ├── (auth)/                 # Route group — signed-out screens
│   │   ├── _layout.tsx
│   │   ├── sign-in.tsx
│   │   └── sign-up.tsx
│   ├── (tabs)/                 # Route group — signed-in tab navigator
│   │   ├── _layout.tsx         # Tabs layout
│   │   ├── index.tsx           # Home tab
│   │   └── workouts/
│   │       ├── index.tsx       # /workouts list
│   │       └── [id].tsx        # /workouts/:id dynamic route
│   └── +not-found.tsx
├── src/
│   ├── components/             # UI components (each in its own folder)
│   │   └── ui/                 # gluestack-ui copy-in primitives (kebab-case, owned by the CLI)
│   ├── hooks/                  # Generic UI hooks flat (useDebounce.ts); per-domain TanStack folders below
│   │   ├── useDebounce.ts      # cross-cutting hooks stay flat
│   │   └── workouts/           # a TanStack domain's React-Query layer (see tanstack-query)
│   │       ├── workouts.cache.ts        # query keys + stale times + queryOptions factories
│   │       ├── useWorkouts.ts           # one query hook per file (useWorkout.ts, …)
│   │       ├── useCreateWorkout.ts      # one mutation hook per file
│   │       └── prefetchWorkoutQueries.ts # warms the domain on sign-in
│   ├── stores/                 # Zustand stores (useSessionStore.ts)
│   ├── providers/              # React Context providers (cross-cutting client state)
│   ├── lib/                    # Non-React utilities + integrations
│   │   ├── api/                # Network layer — client.ts (envelope unwrap + auth) + one fetcher file per domain (see tanstack-query)
│   │   ├── queryClient.ts      # createAppQueryClient() — global TanStack defaults (see tanstack-query)
│   │   ├── prefetch.ts         # prefetchInitialData() — the sign-in prefetch registry
│   │   ├── time.ts             # seconds() / minutes() duration helpers for stale times
│   │   ├── supabase.ts         # Supabase client (storage adapter, auth config)
│   │   └── env.ts              # Validated EXPO_PUBLIC_* access (see frontend-patterns)
│   └── types/                  # App-local cross-file types
├── assets/
├── global.css                  # NativeWind / Tailwind entry point
├── tailwind.config.js
├── metro.config.js             # wrapped with withNativeWind
├── babel.config.js             # babel-preset-expo + nativewind
└── app.json                    # Expo config (scheme, typedRoutes, plugins)
```

### Routes live in `app/`, everything else in `src/`

The `app/` directory is **routing only**. A file in `app/` is a screen; its job is to read route params, mount a layout, and compose components and hooks from `src/`. No business logic, no large render trees, no large state in a route file — if a screen file grows past ~100 lines, the logic moves to a hook (`src/hooks/`) and the rendering to components (`src/components/`).

- **Route groups** `(name)/` organise screens without adding a URL segment — use them to split signed-in vs signed-out stacks.
- **Layouts** `_layout.tsx` define the navigator (Stack / Tabs) and wrap providers. The root `_layout.tsx` is where the auth gate lives.
- **Dynamic routes** `[id].tsx` read their param with `useLocalSearchParams`.

### Components — each in its own folder

Every component in `src/components/` lives in a folder named after it, the file inside matching the folder name:

- **Standalone** — `components/SiteHeader/SiteHeader.tsx`.
- **Domain group** (2+ peers sharing a prefix) — `components/Workout/WorkoutRow.tsx`, `components/Workout/WorkoutStatsBanner.tsx`. Keep the domain prefix on the filename so imports stay self-describing.
- **Compound family** (one component with internal sub-components) — `components/Calendar/Calendar.tsx` (parent) + `components/Calendar/CalendarDay.tsx` (child, prefix stripped). Driven by composition, not domain count.

One exception: **`components/ui/`** holds gluestack-ui's copy-in primitives flat in kebab-case (`button.tsx`, `box.tsx`) — that layout is owned by the gluestack CLI; don't reformat it or put bespoke components there.

## File Naming

```
app/(tabs)/workouts/[id].tsx     # routes — lower-case, Expo Router conventions
components/WorkoutCard/WorkoutCard.tsx   # PascalCase folder + file for components
hooks/useAuth.ts                 # camelCase, 'use' prefix — cross-cutting hooks, flat
hooks/workouts/workouts.cache.ts # per-domain query keys + queryOptions (see tanstack-query)
hooks/workouts/useWorkouts.ts    # per-domain query/mutation hook — one per file
stores/useSessionStore.ts        # camelCase, 'use' prefix, 'Store' suffix
lib/formatDuration.ts            # camelCase for utilities
lib/api/workouts.ts              # network fetchers — camelCase, plural resource, no Api suffix
types/workout.types.ts           # camelCase with .types suffix
```

## Path Aliases

Import via the `@/` alias (configured in `tsconfig` + babel module-resolver), never deep relative paths, so a reader can locate the source without tracing `../../`. Cross-app code imports from the `shared` workspace package by its package name.

```typescript
import { useSessionStore } from '@/stores/useSessionStore'
import { createWorkoutSchema } from '@acme/shared/schemas/workout'
```
