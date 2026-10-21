# Project Structure

The shape of a React Native project: **one git repo per app**, holding an Expo app, that app's Supabase project, and nothing else. No workspace, no monorepo, no API server. `pnpm` is the package manager — never `npm`, `yarn` or `bun`. Expo SDK packages install with `pnpm expo install <pkg>`, which picks the version the SDK supports; everything else is `pnpm add`. Every script is `pnpm <script>`, every one-off CLI `pnpm dlx`.

Shared code does not travel between apps as a package; every app starts from the same baseline (Starting an app, below), and these gates keep every app the same shape.

## Repo Layout

```
.
├── app/                        # Expo Router routes — the file tree is the navigation tree
│   ├── _layout.tsx             # Root layout: the providers; renders AppShell, which holds the auth gate
│   ├── (auth)/
│   │   ├── _layout.tsx
│   │   └── sign-in.tsx         # Apple (iOS) + Google buttons, and why an account is needed
│   ├── (tabs)/
│   │   ├── _layout.tsx         # NativeTabs
│   │   ├── index.tsx           # Home tab
│   │   ├── workouts/
│   │   │   ├── _layout.tsx     # Stack — a tab that pushes screens needs its own
│   │   │   ├── index.tsx       # /workouts list
│   │   │   └── [id].tsx        # /workouts/:id
│   │   └── settings.tsx        # Settings tab: every row store-and-monetisation requires
│   ├── +native-intent.tsx      # maps the OAuth redirect path to / (see security-standards)
│   └── +not-found.tsx
├── src/
│   ├── components/             # UI components, each in its own folder (see below)
│   │   ├── AppShell/           # the auth gate and every app-lifetime effect (see Routes below)
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
│   ├── schemas/                # Zod schemas, singular: workout.schema.ts
│   ├── stores/                 # Zustand stores: use<Name>Store.ts
│   ├── providers/              # React Context providers (cross-cutting client state)
│   ├── constants/              # Cross-file constants: ads.ts, breakpoints.ts
│   └── types/                  # database.types.ts (generated) + singular domain types: workout.types.ts
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
- **Layouts** `_layout.tsx` define the navigator (`Stack` / `NativeTabs`) and wrap providers. The root `_layout.tsx` mounts the providers and renders `AppShell` (its hooks need those providers above them). `AppShell` holds the auth gate and every app-lifetime effect: the splash screen, `focusManager` and Supabase auto-refresh on `AppState`, `configurePurchases()` and `prefetchInitialData()` once a session exists, `initialiseAds()`, and `UpdateRequired` in place of the app when the version is too old.
- **Dynamic routes** `[id].tsx` read their param with `useLocalSearchParams`.
- **One screen file serves iOS and Android.** A small difference is a `Platform.OS` check in place (the Apple sign-in button renders on iOS only; `expo-apple-authentication` has no Android). A component that diverges wholesale gets a `Name.ios.tsx` beside the default `Name.tsx`, and Metro picks per platform. Never a second screen per platform.

### Components — each in its own folder

Every component in `src/components/` lives in a folder named after it, the file inside matching the folder name:

- **Standalone** — `components/AdBanner/AdBanner.tsx`.
- **Domain group** (2+ peers sharing a prefix) — `components/Workout/WorkoutRow.tsx`, `components/Workout/WorkoutStatsBanner.tsx`. Keep the domain prefix on the filename so imports stay self-describing.
- **Compound family** (one component with internal sub-components) — `components/Calendar/Calendar.tsx` (parent) + `components/Calendar/CalendarDay.tsx` (child, keeps the prefix). Driven by composition, not domain count.

**A screen's own components** are a domain group named after the screen. The route file renders the sections; a section's children sit beside it as peers with the same prefix, because folders under `components/` never nest. A component a second screen needs moves up to its own folder or its domain's group.

```
app/(tabs)/index.tsx                     # the Home screen: calls hooks, renders the sections
components/Home/HomeHeader.tsx
components/Home/HomeStats.tsx
components/Home/HomeStatTile.tsx         # HomeStats' child — a peer, not a subfolder
components/Home/HomeRecentWorkouts.tsx
components/Workout/WorkoutRow.tsx        # the Workouts tab uses it too, so not under Home/
```

One exception: **`components/ui/`** holds React Native Reusables' copy-in primitives flat in kebab-case (`button.tsx`, `text.tsx`, `input.tsx`). That layout is owned by the Reusables CLI (`pnpm dlx @react-native-reusables/cli@latest add <component>`; it picks the Uniwind versions when it detects Uniwind's Metro config, so check the added files import nothing from `nativewind`); the files are yours to edit, but don't reformat the folder or put bespoke components there.

## File Naming

```
app/(tabs)/workouts/[id].tsx              # routes — lower-case, Expo Router conventions
components/AdBanner/AdBanner.tsx          # PascalCase folder + file for components
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

The Supabase CLI works on the `supabase/` directory in the current working directory, so it lives at the **repo root** and every `supabase` command runs from there, wrapped as `package.json` scripts. Every app has the same script names: `dev`, `typecheck`, `lint`, `test`, `db:start`, `db:reset`, `db:check`, `db:push`, `db:types`, `build:ios`, `build:android`, `submit:ios`, `submit:android`. The migration workflow lives in `database-standards`; the functions layout in `edge-functions`; the release path in `store-and-monetisation`.

## Starting an app

Every app starts from the same baseline, so no two differ in setup:

1. `pnpm create expo-app@latest <name> --template default` (the current SDK, Expo Router, TypeScript). Delete the example screens, move code under `src/`, and set `strict`, `noUncheckedIndexedAccess` and the `@/*` alias in `tsconfig.json`.
2. Uniwind, then React Native Reusables, each from its own install guide (`global.css`, `withUniwindConfig` outermost in `metro.config.js`).
3. Tests use the `jest-expo` preset with `@testing-library/react-native`; `pnpm expo lint` writes the `eslint-config-expo` flat config; `eas-cli` is a dev dependency, so every `eas` call runs the project's version (`pnpm exec eas …`).
4. `supabase init`, then the skeleton migrations (`database-standards`).
5. `.github/workflows/ci.yml` on every push: `pnpm install --frozen-lockfile`, `pnpm typecheck`, `pnpm lint`, `pnpm test`, then `supabase start` and `pnpm db:check`, checked out with full history (`fetch-depth: 0`).

## The `app-sites` repo

App repos are private, and GitHub Pages is free only for public repos, so the pages the stores require live in **one public repo, `app-sites`**, served at your `github.io` address. It holds `index.md` and one folder per app:

```
app-sites/
├── index.md
└── <app-slug>/
    ├── privacy.md          # App Store Connect + Play Console privacy policy URL
    ├── support.md          # App Store Connect support URL
    └── delete-account.md   # Play Console account-deletion URL; the in-app path and an email route
```

The folder is added when the app is set up; the repo is created once, the first time.

## Path Aliases

Import via the `@/` alias (`@/*` → `src/*` in `tsconfig.json`) — `import { useSession } from '@/hooks/useSession'` — never deep relative paths. Route files import from `src/` the same way.
