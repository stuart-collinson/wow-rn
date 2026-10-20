# Project Structure

The shape of a React Native project: **one git repo per app**, holding an Expo app, that app's Supabase project, and nothing else. No workspace, no monorepo, no API server. `pnpm` is the package manager — never `npm`, `yarn` or `bun`. Every install is `pnpm add`, every script is `pnpm <script>`.

Shared code does not travel between apps as a package; every app is scaffolded to the same skeleton, and these gates keep every app the same shape.

## Repo Layout

```
.
├── app/                        # Expo Router routes — the file tree is the navigation tree
│   ├── _layout.tsx             # Root layout: the providers; renders AppShell, which holds the auth gate
│   ├── (auth)/
│   │   ├── _layout.tsx
│   │   └── sign-in.tsx         # Apple + Google buttons
│   ├── (tabs)/
│   │   ├── _layout.tsx         # NativeTabs
│   │   ├── index.tsx           # Home tab
│   │   └── workouts/
│   │       ├── index.tsx       # /workouts list
│   │       └── [id].tsx        # /workouts/:id
│   └── +not-found.tsx
├── src/
│   ├── components/             # UI components, each in its own folder (see below)
│   │   ├── AppShell/           # Stack.Protected auth gate, focus wiring, the UpdateRequired screen
│   │   └── ui/                 # React Native Reusables copy-in primitives (kebab-case, owned by its CLI)
│   ├── hooks/                  # Cross-cutting hooks flat (useSession.ts, useDebounce.ts)
│   │   └── workouts/           # one folder per TanStack domain (see tanstack-query)
│   ├── lib/                    # Non-React utilities and integrations
│   │   ├── env.ts              # Validated EXPO_PUBLIC_* access (see frontend-patterns)
│   │   ├── supabase.ts         # The typed Supabase client (see security-standards)
│   │   ├── storage.ts          # kvStorage — expo-sqlite/kv-store for Zustand and the query cache
│   │   ├── queryClient.ts      # createAppQueryClient() + queryPersister (see tanstack-query)
│   │   ├── prefetch.ts         # prefetchInitialData() — the sign-in prefetch registry
│   │   ├── time.ts             # seconds() / minutes() / hours()
│   │   ├── version.ts          # isVersionBelow() for min_supported_version
│   │   └── api/                # Network layer: dataError.ts + one fetcher file per domain
│   ├── schemas/                # Zod schemas: <domain>.schema.ts
│   ├── stores/                 # Zustand stores: use<Name>Store.ts
│   ├── providers/              # React Context providers (cross-cutting client state)
│   ├── constants/              # Cross-file constants: ads.ts, breakpoints.ts
│   └── types/                  # database.types.ts (generated) + <domain>.types.ts
├── supabase/                   # Supabase CLI project — see database-standards and edge-functions
│   ├── config.toml
│   ├── migrations/             # YYYYMMDDhhmmss_<description>.sql — the schema, in code
│   ├── seed.sql
│   └── functions/              # Edge Functions: <name>/index.ts + _shared/
├── assets/
├── .github/workflows/ci.yml    # typecheck, lint, test, migrations
├── global.css                  # Tailwind v4 + Uniwind + the app's theme variables
├── metro.config.js             # withUniwindConfig — the outermost wrapper
├── app.json                    # Expo config; app.config.ts only when a value must come from env
├── eas.json                    # build profiles, remote app version source
└── package.json
```

### Routes live in `app/`, everything else in `src/`

The `app/` directory is **routing only**. A file in `app/` is a screen; its job is to read route params, mount a layout, and compose components and hooks from `src/`. No business logic, no large render trees, no large state in a route file — if a screen file grows past ~100 lines, the logic moves to a hook (`src/hooks/`) and the rendering to components (`src/components/`).

- **Route groups** `(name)/` organise screens without adding a URL segment — use them to split signed-in vs signed-out stacks.
- **Layouts** `_layout.tsx` define the navigator (`Stack` / `NativeTabs`) and wrap providers. The root `_layout.tsx` mounts the providers and renders `AppShell`, which holds the auth gate (its hooks need those providers above them).
- **Dynamic routes** `[id].tsx` read their param with `useLocalSearchParams`.

### Components — each in its own folder

Every component in `src/components/` lives in a folder named after it, the file inside matching the folder name:

- **Standalone** — `components/AdBanner/AdBanner.tsx`.
- **Domain group** (2+ peers sharing a prefix) — `components/Workout/WorkoutRow.tsx`, `components/Workout/WorkoutStatsBanner.tsx`. Keep the domain prefix on the filename so imports stay self-describing.
- **Compound family** (one component with internal sub-components) — `components/Calendar/Calendar.tsx` (parent) + `components/Calendar/CalendarDay.tsx` (child, prefix stripped). Driven by composition, not domain count.

One exception: **`components/ui/`** holds React Native Reusables' copy-in primitives flat in kebab-case (`button.tsx`, `text.tsx`, `input.tsx`). That layout is owned by the Reusables CLI (`npx react-native-reusables@latest add <component>`); the files are yours to edit, but don't reformat the folder or put bespoke components there.

## File Naming

```
app/(tabs)/workouts/[id].tsx              # routes — lower-case, Expo Router conventions
components/WorkoutCard/WorkoutCard.tsx    # PascalCase folder + file for components
components/ui/button.tsx                  # Reusables primitives — kebab-case, CLI-owned
hooks/useSession.ts                       # camelCase, 'use' prefix — cross-cutting hooks, flat
hooks/workouts/workouts.cache.ts          # per-domain query keys + queryOptions (see tanstack-query)
stores/useSettingsStore.ts                # camelCase, 'use' prefix, 'Store' suffix
lib/api/workouts.ts                       # network fetchers — camelCase, plural resource, no Api suffix
schemas/workout.schema.ts                 # Zod schemas — camelCase with .schema suffix
types/workout.types.ts                    # domain types + row mappers — .types suffix
types/database.types.ts                   # generated by supabase gen types; committed, never edited
supabase/functions/revenuecat-webhook/index.ts   # Edge Functions — kebab-case folder, index.ts entry
```

## `supabase/` lives at the repo root

The Supabase CLI operates on the `supabase/` directory in the current working directory, so it lives at the **repo root** — that's what makes `supabase start` / `supabase db reset` / `supabase db push` work without any `--workdir` juggling. Each app has **one hosted Supabase project** (free plan) and runs the **local stack via Docker** for development; there is no hosted staging project. Run all `supabase` commands from the repo root, and wrap the common ones as `package.json` scripts. Every app has the same script names: `dev`, `typecheck`, `lint`, `test`, `db:start`, `db:reset`, `db:push`, `db:types`, `build:ios`, `build:android`, `submit:ios`, `submit:android`. The migration workflow lives in `database-standards`; the functions layout in `edge-functions`; the release path in `store-and-monetisation`.

## The `app-sites` repo

App repos are private, and GitHub Pages is free only for public repos, so the pages the stores require live in **one public repo, `app-sites`**, served at your `github.io` address. It holds `index.md` and one folder per app:

```
app-sites/
├── index.md
└── <app-slug>/
    ├── privacy.md          # App Store Connect + Play Console privacy policy URL
    ├── support.md          # App Store Connect support URL
    └── delete-account.md   # Play Console account-deletion URL; explains the in-app path
```

The folder is added when the app is scaffolded; the repo is created once, the first time.

## Path Aliases

Import via the `@/` alias (`@/*` → `src/*` in `tsconfig.json`), never deep relative paths, so a reader can locate the source without tracing `../../`. Route files import from `src/` the same way.

```typescript
import { useSession } from '@/hooks/useSession'
import { Button } from '@/components/ui/button'
```
