# wow-rn 2.0: the zero-cost Expo + Supabase stack

**Date:** 2026-10-20
**Status:** Draft awaiting Stuart's approval. Reviewer check done and folded in.
**Scope:** Redefines the stack, architecture and rules that the `rn-ways-of-working` plugin (this repo) prescribes for every React Native app Stuart builds from now on. The follow-on work is the plan that rewrites the gates, skills and agent to match. Nothing in a consuming app is built by this document.

## 1. Intent and why

Stuart is one JavaScript engineer who loves React and is new to native. Over the next year or so he intends to ship four to six small, unrelated apps to the iOS App Store and Google Play, iPad included, each in a different industry with its own look. Realistic scale is a few thousand users per app. None of them will have millions.

The plugin is the real product. Its job is to make app number four start as fast as app number one and to let Claude do most of the scaffolding and implementation under one consistent set of rules. Today's gates describe a 2025 shape (a pnpm monorepo with an Express API between the Expo app and Supabase, gluestack-ui on NativeWind, Expo SDK 54) that does not fit a fleet of tiny indie apps, costs money to run, and has aged against what Expo and Supabase shipped in 2026.

The constraint that shaped every decision below is money: **no recurring monthly cost at all.** Apple's $99 a year and Google's one-off $25 are the only accepted costs. Every service in the stack must have a free tier that comfortably covers a few thousand users per app, and anything that would cost money before an app earns money is out.

## 2. Goals, non-goals, anti-goals

**Goals**

- A single, modern, opinionated stack for 2027 onward that Claude can execute without research on every app.
- Zero monthly cost per app at the expected scale, with the few paid escalations named explicitly so they are a choice, not a surprise.
- Simple now, with one documented seam that lets an app grow a real API later without rewriting screens.
- Apps that feel native on iOS 27 and Android 16 while carrying each app's own brand.
- A repeatable start: a `/new-app` skill that produces a running, store-shaped skeleton as the first commit.
- Gate text that stays within roughly its current size so every session still loads it in full.

**Non-goals**

- Web as a target. Apps are iPhone, iPad and Android only.
- Offline-first or local-first sync. Apps are online-first with a persisted cache.
- Analytics, crash reporting, feature-flag vendors, or any observability tooling. Deferred until an app succeeds.
- A separate starter template repository, a template folder in this plugin, or a monorepo.
- End-to-end UI testing. Tests cover schemas, utilities and store logic only.
- Supporting the old Express/monorepo shape alongside the new one. Git history keeps it.

**Anti-goals** (the design has failed if any of these become true)

- A bill arrives before an app has revenue.
- A gate, skill or README still mentions the Express API, gluestack-ui, NativeWind, `packages/shared`, the Supabase `anon` or `service_role` keys, or AsyncStorage as the default store.
- Server-side code is written in a way that only runs on Deno.
- Starting a new app requires remembering steps that are not in the README and the `/new-app` skill.

## 3. Constraints

- **Money:** $0/month. See §1. Where a free tier has a hard edge (Supabase's two active free projects, EAS Update's 1,000 monthly users, EAS Build's 15 + 15 builds a month, Supabase Storage's 1 GB and 5 GB egress per project) the design routes around it rather than paying.
- **One person, Claude-assisted.** Rules must be executable by Claude from the gates alone. Ceremony that only pays off for teams is out.
- **One plugin for every app.** Nothing app-specific lives in the plugin. Per-app variation is configuration and content, not architecture.
- **Context budget.** Everything under `gates/` is loaded into every session of every app. Current total is about 99,000 characters. The new set must land at or below that. Skills load on demand and are the right home for anything large and occasional.
- **Store rules.** Apple requires Sign in with Apple whenever another third-party sign-in is offered, an in-app account deletion path, a privacy policy URL and a support URL. Google Play requires a public web page where users can request account deletion, and makes new personal developer accounts run a closed test with 12 testers for 14 days before the first production release.
- **Platform floor.** Expo's current stable SDK at the time an app is created (SDK 58 as of this document: React Native 0.88, React 19.2, TypeScript 6, New Architecture only, Hermes V1, React Compiler on by default in new projects). Node 22 LTS. Xcode 26.4 or newer.

## 4. Decisions

Each row says who decided it. "Stuart" means he chose it in conversation on 2026-10-20. "Mine" means it is my call, made to fit his decisions, and he can overrule it while reading.

### 4.1 Platform and repo

| Area | Decision | By |
|---|---|---|
| Language | TypeScript, `strict` plus `noUncheckedIndexedAccess`. | Stuart |
| Framework | React Native through Expo, development builds from day one (`expo-dev-client`), never shipping on Expo Go. Current stable SDK; upgrade each release. | Stuart / mine on dev builds |
| Navigation | Expo Router. Native tabs (`NativeTabs`, stable since SDK 58), native stack headers and toolbars, `Stack.Protected` auth gate in the root layout, typed routes on. | Stuart |
| Repo shape | One private git repo per app. `app/` for routes, `src/` for everything else, `supabase/` at the repo root. No `apps/`, no `packages/`, no workspace. Store pages live in a separate public `app-sites` repo (§4.6, §5.4). | Stuart (one project per app) / mine on layout |
| Shared code across apps | Reaches each app through the `/new-app` skill's recipe and reference files, and through the gates. No published packages. | Stuart |
| Package manager | pnpm. EAS detects it from the lockfile. | Stuart |
| Targets | iPhone, iPad and Android. `supportsTablet: true` with breakpoint-aware adaptive layouts, not a stretched phone layout. No web. | Stuart |

### 4.2 Backend

| Area | Decision | By |
|---|---|---|
| Database and auth | Supabase, one hosted project per app on the free plan. The free plan allows two active projects (per organisation according to third-party write-ups; unconfirmed), so apps one and two are free and app three forces a choice Stuart makes at the time: Pro at $25 a month plus $10 a month per extra project, or a second Supabase account or organisation, which I could not confirm is within Supabase's terms. Local development runs on the Supabase CLI stack via Docker Desktop (free for personal use). No hosted staging project by default, because it would burn a slot. | Stuart / mine on no staging |
| API server | None. The app talks to Supabase directly with `@supabase/supabase-js`; Row Level Security is the authorisation layer. | Stuart |
| Database-side logic | Postgres first: RPC functions for atomic multi-table writes, triggers for invariants, `pg_cron` for schedules, `pg_net` for outbound calls from the database. | Mine |
| Server-side code | Supabase Edge Functions, written portably: Web-standard `Request`/`Response`, `npm:` imports only, the only Deno-specific calls (`Deno.serve`, `Deno.env.get`) isolated in one shared file so a move to Supabase Compute, Node, Bun or Cloudflare Workers changes one file. Used only for the three things a phone cannot do: receive webhooks, call third parties with secret keys, run privileged jobs. | Stuart / mine on the portability rule |
| Why not more server | Deno, which Edge Functions run on, is winding down (team joined Cloudflare on 2026-10-09, runtime maintained for one year). Supabase has said existing functions keep working and a Node and Bun capable successor called Compute is in advanced development with a migration path, no timeline. Server code is therefore kept thin and portable, not a place to invest. | Mine |
| Graduation path | When an app needs a real API (because business logic gets complex or a second client appears, never because of traffic at this scale), it is Hono, which runs on Node, Bun and Workers alike, with the same Zod schemas. The only app code that changes is the per-domain fetcher layer. The Express gate is deleted now; git history keeps it. | Stuart |
| Keys | New Supabase API keys only: the publishable key in the app, the secret key only in Edge Functions, asymmetric JWT signing keys. The legacy `anon` and `service_role` keys never appear in a new repo; Supabase deprecates them at the end of 2026. | Mine |
| Database access style | `supabase-js` typed query builder with generated types committed to `src/types/database.types.ts`. No ORM. Drizzle and Prisma need a server and are out. | Mine |
| Schema and migrations | Unchanged from today's `database-standards` gate: SQL migrations under `supabase/migrations/`, append-only, idempotent, RLS in the same file, tested with `supabase db reset` twice. | Stuart (kept) |
| File storage | Supabase Storage, 1 GB and 5 GB egress a month per project. Private buckets with signed URLs. Cloudflare R2 is the named escape hatch if an app ever becomes media-heavy. The Neosframe gates prefer S3; the documented reason for Supabase Storage here is cost. | Stuart |

### 4.3 Authentication

| Area | Decision | By |
|---|---|---|
| Sign-in methods | Sign in with Apple and Google only, both native: `expo-apple-authentication` and the free `@react-native-google-signin/google-signin` API, each exchanged with `supabase.auth.signInWithIdToken`. Both always ship because Apple requires Apple sign-in once Google is offered. | Stuart |
| Email | No email flows of any kind. Supabase's built-in sender is capped at 2 messages an hour and only delivers to the project's own team, so email sign-in would need an SMTP provider. None is configured. | Stuart |
| Session storage | The `expo-sqlite/localStorage` shim as the Supabase auth storage adapter (what `eas integrations:supabase:connect` scaffolds), with `persistSession`, `autoRefreshToken`, `detectSessionInUrl: false` and auto-refresh tied to `AppState`. The session lives in the app sandbox. Escalation rule: an app handling health, finance or similarly sensitive data uses Supabase's `LargeSecureStore` pattern (AES key in `expo-secure-store`) instead. | Stuart / mine on the escalation rule |
| Profile row | A `profile` table populated by a trigger on `auth.users` insert. | Mine |
| Account deletion | An in-app button calling a `SECURITY DEFINER` RPC `delete_my_account()` that removes the `auth.users` row so everything cascades, followed by sign-out. Required by Apple. | Mine |

### 4.4 UI and styling

| Area | Decision | By |
|---|---|---|
| Look and feel | Native chrome, branded content. Navigation chrome (tabs, headers, toolbars) and platform controls (sheets, pickers, menus, switches, date pickers, long native lists) come from Expo Router and Expo UI (`@expo/ui`, SwiftUI on iOS and Jetpack Compose on Android, stable since SDK 56). The content area, where the brand lives, is React Native views styled with Tailwind. | Stuart |
| Styling engine | Uniwind, free tier only, on Tailwind CSS v4. Metro plugin (`withUniwindConfig`), no Babel preset, `global.css` with `@import 'tailwindcss'` and `@import 'uniwind'`. Themes are CSS variables under light and dark variants, so re-theming an app is editing one CSS file. Nothing in the gates may depend on Uniwind Pro features. | Stuart |
| Component library | React Native Reusables (shadcn/ui for React Native, MIT, copy-in). New apps start from its `minimal-uniwind` template; components are added with its CLI into `src/components/ui/` and are owned code. Icons are `lucide-react-native`, with `expo-symbols` where native tabs want SF Symbols. | Stuart / mine on icons |
| Boundary rule | Expo UI components are styled by their own props and follow the system theme; they are never given `className`. Tailwind classes go on React Native views and Reusables components. Where Expo UI lacks something or behaves awkwardly, Reusables is the fallback, never a third library. | Mine |
| Dark mode | Follows the system by default (`userInterfaceStyle: automatic`); Uniwind handles light and dark variants automatically. | Mine |
| Lists, images, animation | `FlatList` for short lists, `@shopify/flash-list` v2 for long ones, `expo-image` for images, `react-native-reanimated` 4 for animation (Reusables' skeleton already uses it). | Mine |
| Performance rules | The React Compiler is on, so the gates stop asking for hand-written `useMemo`, `useCallback` and `React.memo`. Optimise only when measured. | Mine |

### 4.5 Data layer and state

| Area | Decision | By |
|---|---|---|
| Server state | TanStack Query v5, keeping today's per-domain shape: `lib/api/<domain>.ts` fetchers, `hooks/<domain>/<domain>.cache.ts` with query keys, stale times and `queryOptions` factories, one hook per file, `prefetch<Domain>Queries.ts`, no barrels. | Stuart (kept) |
| What a fetcher is now | A thin function calling `supabase-js` with explicit column selects, mapping `snake_case` rows to `camelCase` domain types, throwing a typed error that carries the PostgREST code so retry logic can skip the caller's-fault cases. The envelope-unwrapping HTTP client is deleted. The folder stays named `lib/api/` because it is the seam a future Hono API would plug into. | Mine |
| Offline behaviour | Online-first with a persisted cache: `PersistQueryClientProvider` with an async-storage persister over `expo-sqlite/kv-store`, a 24 hour `maxAge`, the app version as the cache buster. `onlineManager` wired to `expo-network`, `focusManager` to `AppState`. Writes require a connection. | Stuart / mine on the mechanics |
| Pagination | Keyset pagination through `supabase-js` (`order` on `created_at` and `id`, fetch page size plus one to derive `hasMore`) consumed by `useInfiniteQuery`. Never offset. | Mine |
| Realtime | Optional per domain: a Supabase Realtime subscription that invalidates the matching query keys. Not a default. | Mine |
| Client state | Zustand, only for cross-cutting client state, persisted through `expo-sqlite/kv-store` when it must survive relaunch. Local React state and TanStack Query handle everything else. | Stuart |
| Forms | React Hook Form with Zod 4 via `zodResolver`. One RHF instance per form, even across wizard steps. | Stuart |
| Schemas and types | Zod schemas in `src/schemas/<domain>.schema.ts` for forms and every trust boundary (deep links, Edge Function payloads, `app_config` values). Domain types in `src/types/<domain>.types.ts`, derived from the generated `Database` types. Schemas that an Edge Function needs live in `supabase/functions/_shared/` and are not imported from `src/`, because the two run in different runtimes; a deliberate twin is kept in sync by a one-line comment naming its partner. | Mine |
| Remote config | A single `app_config` table (`key text primary key, value jsonb, updated_at`) per app, RLS on, readable by `anon` and `authenticated`, no client write policy. Edited only in the Supabase dashboard table editor. Read through a `useAppConfig()` query with a long stale time and the persisted cache. Keys shipped by the skeleton: `ads_enabled` (boolean) and `min_supported_version` (string, drives a gentle "please update" screen, which matters because store releases are the only reliable update path). | Stuart (table, no UI) / mine on the keys |

### 4.6 Product services

| Area | Decision | By |
|---|---|---|
| Payments | RevenueCat: `react-native-purchases` plus `react-native-purchases-ui` for remotely editable paywalls. Free until $2,500 a month of tracked revenue, then 1%. Entitlements are read from the SDK on the client; a "restore purchases" action always exists. A RevenueCat webhook into an Edge Function is added only when a server-side decision needs to know the plan. | Stuart |
| Ads | Google AdMob via `react-native-google-mobile-ads` (v17, New Architecture only, development build required). Initialisation order is consent form, then App Tracking Transparency on iOS, then the SDK. All ad rendering goes through one `AdBanner` component that reads `ads_enabled` from `app_config`, so ads switch off per app from the database with no release. Test unit IDs in development. The library's Android port is still partial; the gate says to check its status before enabling Android ads. | Stuart |
| Push | `expo-notifications` with Expo's push service (free, 600 a second). Tokens in a `device_push_token` table under RLS; an Edge Function sends through `npm:expo-server-sdk`. iOS uses an APNs key held by Expo; Android needs FCM v1 credentials from a free Firebase project. Prompt for permission at a meaningful moment, never on first launch. | Stuart |
| Store review prompt | `expo-store-review`: `requestReview()` after a positive moment, throttled locally (state in `expo-sqlite/kv-store`). "Rate us" buttons open `storeUrl()` instead, because the system prompt cannot be forced. | Stuart (requirement) / mine on the rule |
| Store pages | One public GitHub repo, `app-sites`, served by GitHub Pages at Stuart's github.io address, with a folder per app holding the three pages the stores require: privacy policy, support, and account-deletion request. App repos stay private, which is why the pages cannot live in them: GitHub Pages is free only for public repos. No custom domain. | Stuart |
| Monitoring, analytics, flags | None. Not Sentry, not PostHog. App Store Connect and the Play Console provide basic crash reports for free. Add a vendor only when an app succeeds. | Stuart |

### 4.7 Tooling and release

| Area | Decision | By |
|---|---|---|
| Lint and format | ESLint 10 flat config via `eslint-config-expo`, Prettier. `pnpm lint`, `pnpm typecheck`. | Stuart |
| Tests | Jest 30 via `jest-expo`. Required: Zod schemas, pure utilities, Zustand store logic and fetcher row-mappers. Component and end-to-end tests are allowed but not required. | Stuart |
| CI | GitHub Actions on push and pull request: install with a frozen lockfile, typecheck, lint, test, on Linux. A second job runs the Supabase local stack and `supabase db reset` to prove the migration chain applies; it is free and catches the most expensive class of mistake. | Stuart / mine on the migrations job |
| Builds | Local by default: `eas build --local` on the Mac, then `eas submit --path`, which is free. EAS cloud builds only when away from the Mac, inside the free 15 + 15 a month. Build numbers managed by EAS (`appVersionSource: remote`, auto-increment) so local and cloud builds share one counter. | Stuart / mine on build numbers |
| Over-the-air updates | Store releases are the real path. `expo-updates` stays configured with a fingerprint runtime version and a channel per profile, used for hotfixes while under EAS Update's free 1,000 monthly users, and simply stops serving beyond that. Nothing self-hosted. | Stuart |
| Local tools | Node 22, pnpm, Xcode and Android Studio, Docker Desktop, the Supabase CLI and EAS CLI. | Mine |

### 4.8 Accounts

The README must carry this list so a new app starts with nothing missing. No account creation guide, just the list.

| Account | Cost | When |
|---|---|---|
| Apple Developer Program | $99/year | Always. App Store, TestFlight, Sign in with Apple, push keys. |
| Google Play Console | $25 once | Always. Closed test with 12 testers for 14 days before the first production release on a new personal account. |
| GitHub | Free | Always. Private app repos, CI, and the one public `app-sites` repo for store pages. |
| Expo | Free | Always. `eas submit`, credentials, EAS Update, and the Supabase integration command. |
| Supabase | Free for two apps | Always. One project per app; the free plan allows two active projects. App three means Pro at $25 a month plus $10 a month per extra project, or a second account or organisation, decided then. |
| Google Cloud project | Free, no billing | Always. OAuth client IDs for Google sign-in. A project under the existing Google account. |
| RevenueCat | Free until $2.5K/month revenue | Only when an app sells something. Apple's paid-apps agreement and bank details are also needed then. |
| Google AdMob | Free | Only when an app shows ads. |
| Firebase project | Free | Only when an app sends push to Android (FCM credentials for Expo's push service). |

Not needed: Hono (a library, not a service), AWS, Cloudflare, Resend, Sentry, PostHog, Vercel.

## 5. Architecture

### 5.1 One app, end to end

```
Screen (app/…)                      reads route params, composes components and hooks, nothing else
  └─ Component (src/components)     renders; Tailwind classes on RN views and Reusables, Expo UI for native controls
       └─ Hook (src/hooks/<domain>) TanStack Query, spreading a queryOptions factory from <domain>.cache.ts
            └─ Fetcher (src/lib/api/<domain>.ts)   supabase-js query, explicit columns, row → domain type
                 └─ Supabase (PostgREST + RLS)      the authorisation layer; the user's JWT scopes every row
                      ├─ Postgres functions, triggers, pg_cron     database-side logic
                      └─ Edge Functions (supabase/functions)       webhooks in, secret-key calls out, admin jobs
```

Client state (Zustand), forms (React Hook Form) and the persisted query cache (`expo-sqlite/kv-store`) sit beside this path, never in it. Remote configuration is one more query against `app_config`.

### 5.2 The graduation seam

Screens, components, hooks, cache files, prefetch and schemas never import the Supabase client. Only `src/lib/api/<domain>.ts` does. When a Hono API arrives, a `client.ts` returns to `lib/api/`, each fetcher becomes one HTTP call, and nothing above the fetcher changes. The gates enforce this by making a Supabase import anywhere outside `src/lib/` a gate failure.

### 5.3 Per-app repo layout

```
.
├── app/                         # Expo Router routes only
│   ├── _layout.tsx              # providers, persisted QueryClient, Stack.Protected auth gate
│   ├── (auth)/sign-in.tsx       # Apple + Google buttons
│   ├── (tabs)/_layout.tsx       # NativeTabs
│   ├── (tabs)/index.tsx
│   └── +not-found.tsx
├── src/
│   ├── components/              # PascalCase folder per component; ui/ is Reusables' copy-in, kebab-case
│   ├── hooks/                   # cross-cutting hooks flat; hooks/<domain>/ for TanStack domains
│   ├── lib/                     # supabase.ts, env.ts, queryClient.ts, time.ts, prefetch.ts, api/<domain>.ts
│   ├── schemas/                 # Zod: <domain>.schema.ts
│   ├── stores/                  # Zustand: use<Name>Store.ts
│   ├── providers/
│   └── types/                   # database.types.ts (generated, committed), <domain>.types.ts
├── supabase/
│   ├── config.toml
│   ├── migrations/              # YYYYMMDDhhmmss_<description>.sql
│   ├── seed.sql
│   └── functions/               # <name>/index.ts, _shared/
├── assets/
├── .github/workflows/ci.yml
├── global.css                   # Tailwind v4 + Uniwind + theme variables
├── metro.config.js              # withUniwindConfig outermost
├── app.json                     # app.config.ts only if a value must come from env
├── eas.json
└── package.json
```

The skeleton's first migrations: the shared `updated_at` touch trigger, `profile` with its `auth.users` trigger, `app_config` with its two seed keys, `delete_my_account()`, and `device_push_token`.

### 5.4 The `app-sites` repo

One public repo, created once (by `/new-app` on its first run if it is missing, using `gh repo create`), served by GitHub Pages with the default Jekyll theme. `index.md` lists the apps; each app has `<app-slug>/privacy.md`, `<app-slug>/support.md` and `<app-slug>/delete-account.md`. The delete-account page explains the in-app path and gives a contact for requests, which satisfies Google Play's requirement. Its three URLs go into App Store Connect and the Play Console. The structure is my call; the decision to use one public sites repo is Stuart's.

## 6. What changes from today's gates

| Today | Becomes |
|---|---|
| pnpm workspace monorepo: `apps/mobile`, `apps/api`, `packages/shared` | One single-app repo per app |
| Express 5 API with routes → controller → service → repository | No API. Supabase direct with RLS; Postgres functions; thin portable Edge Functions. Hono named as the future path |
| `lib/api/client.ts` envelope client over REST | Fetchers call `supabase-js`; no client; `lib/api/` kept as the seam |
| gluestack-ui v3 on NativeWind (Tailwind v3), `components/ui/` owned by the gluestack CLI | React Native Reusables on Uniwind (Tailwind v4); `components/ui/` owned by the Reusables CLI |
| JS tabs and headers | Expo Router native tabs, native stack, Expo UI for platform controls |
| `EXPO_PUBLIC_SUPABASE_ANON_KEY`, service-role key on the API | `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY`; secret key only in Edge Functions |
| Session in an encrypted SecureStore adapter; tokens never in AsyncStorage | Session in the `expo-sqlite/localStorage` shim by default; Keychain pattern as the escalation for sensitive apps |
| AsyncStorage for Zustand persistence | `expo-sqlite/kv-store` for Zustand and the TanStack persister |
| `useMemo`/`useCallback`/`React.memo` guidance | React Compiler assumed; no manual memoisation rules |
| Expo SDK 54+ | Current stable SDK (58 at writing) |
| Jest + RNTL expected | Jest for schemas, utilities, stores and mappers only |
| Email sign-in examples (`SignInForm` with email and password) | Apple and Google native sign-in only |
| No guidance on payments, ads, push, review prompts, store pages, release | A new store-and-monetisation gate covers all of them |
| `packages/shared` for cross-side Zod schemas | `src/schemas/` in the app; `_shared/` inside Edge Functions |

## 7. The gate set after the change

Target total at or below today's ~99,000 characters. Sizes are budgets, not quotas.

| File | Action | Scope | Budget |
|---|---|---|---|
| `coding-standards.md` | Keep, light edit | Remove backend references and the class-method exception's "on the backend" framing. Otherwise unchanged. | ~11K |
| `project-structure.md` | Rewrite | The single-app layout in §5.3, folder and file naming, `app/` versus `src/`, `supabase/` at root, the `app-sites` repo in §5.4, path aliases. | ~7K |
| `frontend-patterns.md` | Rewrite | Expo Router with native tabs and `Stack.Protected`; the Expo UI versus Tailwind boundary rule; Uniwind styling and theming; Reusables usage and the reuse-before-build order; adaptive iPad layouts with breakpoints; loading, empty and error states; lists, images, animation; accessibility; env via a validated `lib/env.ts` with the publishable key; React Compiler stance. | ~13K |
| `tanstack-query.md` | Rewrite the network layer, trim | Keep the headline same-shape rule, cache files, `queryOptions`, hooks, mutations and invalidation, optimistic updates, polling, prefetch, no barrels. Replace §4 with the `supabase-js` fetcher contract, the typed error, and the row-mapping rule. Add the persisted cache, `expo-network` and `AppState` wiring, keyset pagination through `supabase-js`, optional Realtime invalidation, and the graduation seam. Drop the Express linkage and the envelope client. | ~22K |
| `database-standards.md` | Update | Types path `src/types/database.types.ts`; the skeleton tables (`profile`, `app_config`, `device_push_token`) and functions (`delete_my_account`, touch trigger); `anon`-readable config policy; RPC and trigger conventions; `pg_cron` and `pg_net`; everything about migrations and RLS kept. | ~12K |
| `edge-functions.md` | New | When a function is justified (webhook in, secret out, privileged job) and when Postgres should do it instead; folder layout and `_shared/`; the portability rule and the one runtime file; verifying the caller with the new keys; secrets via `supabase secrets`; webhook authentication (RevenueCat shared secret); the push sender; local run and test; logging rules; the Hono graduation paragraph. | ~6K |
| `security-standards.md` | Rewrite | Publishable versus secret keys; the session storage default and escalation rule; `EXPO_PUBLIC_*` is public; RLS as the floor; deep-link and `app_config` validation; ads consent and ATT; webhook secrets; no tokens in logs; transport; the severity table and false positives updated. | ~7K |
| `store-and-monetisation.md` | New | RevenueCat (entitlements, paywall, restore); AdMob (consent order, `AdBanner`, `ads_enabled`, test IDs, Android caveat); push (token table, permission moment, sender); store review prompt rule; account deletion in-app and the deletion-request page; the three store pages in `app-sites`; `app.json` requirements (`supportsTablet`, usage descriptions, privacy manifest); release path (local build, `eas submit`, version and build numbers); EAS Update policy; `min_supported_version`. | ~8K |
| `backend-patterns.md` | Delete | Replaced by `edge-functions.md` and the graduation paragraph. | 0 |
| `ROUTING.md` | Update | Every task: coding-standards, project-structure, security-standards. UI: frontend-patterns. Data: tanstack-query. Database: database-standards. Server code: edge-functions plus database-standards. Payments, ads, push, release, store: store-and-monetisation. | small |
| `GATES.md` | Update | Imports the eight gates above. | small |

Estimated total: ~86K.

## 8. Skills, agent, README, CLAUDE.md

### 8.1 `/new-app` (new skill)

A user-invoked skill holding the scaffolding recipe Stuart described: "a guide I point the agent at when I start an app, so the first commit is the skeleton rather than a README." Skills cost one line of context until invoked, so the recipe and its reference files add nothing to normal sessions. Reference files live under `skills/new-app/files/` and are copied or adapted into the new repo using `${CLAUDE_PLUGIN_ROOT}`.

The recipe, in order:

1. Preconditions: the accounts from §4.8 the app needs, the local tools from §4.7, `eas login`, `supabase login` and `gh auth login` done. The skill asks one question up front: hosted Supabase now, or local only? Local only runs everything against `supabase start`, skips `eas init`, the Supabase integration, `link` and `push`, and writes the local URL and key to `.env.local`, so a dry run or an app that is not ready for a hosted project never consumes a free slot. The hosted steps can be run later from the same recipe.
2. Scaffold with the Reusables CLI's `minimal-uniwind` template, switch to pnpm, set bundle identifiers, scheme, `supportsTablet`, `userInterfaceStyle`, typed routes, and the config plugins the app needs.
3. Hosted mode: choose the Supabase organisation first; if it has no free slot, stop and surface the §4.2 choice rather than guessing. Then `eas init`, `eas integrations:supabase:connect` to create the hosted project and write the env vars, `supabase init` and `supabase link`. Both modes: copy the skeleton migrations, `supabase db reset` locally, twice, generate types. Hosted mode only: `supabase db push`.
4. Wire `lib/env.ts`, `lib/supabase.ts`, `lib/queryClient.ts` with the persister, the root layout with providers and the auth gate, the sign-in screen with Apple and Google, the `NativeTabs` layout, `useAppConfig()` and the update prompt.
5. Optional modules, each a yes or no when the skill runs: payments (RevenueCat), ads (AdMob with `AdBanner`), push (token table, sender function, credentials).
6. Add the app's folder with the three pages to a local clone of `app-sites` (creating the repo if it does not exist), commit and push it, and record the three URLs for the store listings. Then `.github/workflows/ci.yml`, `eas.json` profiles, `.env.example`, and the app's own README pointing at the plugin README's account list and first-real-app checklist.
7. Verify: typecheck, lint, test pass; migrations reset twice cleanly; a development build boots in the iOS simulator and reads `app_config`. In hosted mode, also Google sign-in in the simulator (Apple sign-in needs a device signed into an Apple ID).
8. Initial commit.

The exact reference-file set is the builder's call; it should be small, and each file should be one the gates already describe.

### 8.2 Existing skills and the agent

- `/implement-code`: the location list gains Edge Functions and loses the API; the checklist's App section becomes Uniwind classes on RN views and Reusables, Expo UI for native controls, no manual memoisation; the API section becomes an Edge Functions section (portability, caller verification, secrets); the Security line becomes publishable key only, session storage rule, RLS.
- `/review-code`: the compliance table changes the same way.
- `/commit`: unchanged.
- `agents/security-reviewer.md`: premise rewritten for no API; token storage rule updated to the `expo-sqlite` default with the Keychain escalation; keys updated; Edge Function and ads consent checks added.

### 8.3 README

- Stack summary rewritten.
- A "Before you start an app" section: the existing plugin install steps, the account table from §4.8, the local tools, then "run `/new-app`".
- The gate table updated to the eight gates.
- A short "first real app" checklist of the things only Stuart can verify with live accounts: Google and Apple sign-in against the hosted project, push on a device, RevenueCat sandbox purchases, the three `app-sites` URLs entered in both stores, and Google Play's closed test.

### 8.4 CLAUDE.md (this repo)

Add two rules: any change that adds or removes a vendor, service or account updates the README's account table and the `/new-app` recipe in the same commit; and the gate total stays at or below roughly 100,000 characters, checked with `wc -c gates/*.md` before pushing.

### 8.5 Version

`2.0.0`. A gate is removed and the prescribed stack changes. No repo consumes 1.x today, so nothing beyond the bump is needed; the old shape lives only in git history.

## 9. Verification of the rewrite

The implementation plan should carry these checks:

- `wc -c gates/*.md` total at or below the budget; the existing import-resolution loop and hook smoke test from CLAUDE.md pass.
- A banned-terms grep across `gates/`, `skills/`, `agents/`, `README.md` for `gluestack`, `NativeWind`, `Express`, `apps/api`, `packages/shared`, `ANON_KEY`, `service_role`, `AsyncStorage`, `SecureStore` returns only deliberate "not this" mentions.
- Each gate is read once as a whole for internal consistency with the others (same folder names, same hook names, same key names).
- A dry run of `/new-app` in local-only mode in a scratch directory produces an app that typechecks, lints, tests, boots as a development build in the iOS simulator against the local Supabase stack, reads `app_config`, and whose migrations reset twice cleanly. This is the builder's definition of done. Everything that needs live accounts (Google and Apple sign-in, push, purchases, store pages) sits on the README's first-real-app checklist and is Stuart's to run with the first app.

## 10. Left to the builder

- Exact gate wording and code samples, matched to the current Expo, Uniwind, Reusables, Supabase and RevenueCat docs at the time of writing (use Context7 for each).
- The reference-file set for `/new-app` and whether a step is a copied file or a command.
- The shape of the typed fetcher error and the keyset pagination helper.
- `app.json` versus `app.config.ts` for the skeleton.
- The wording of the three `app-sites` page templates.
- The CI migrations job's exact Supabase CLI invocation and which local services it excludes for speed.
- The icon approach for `NativeTabs` on each platform.
- A short table in `frontend-patterns` of which controls come from Expo UI and which from Reusables.
- How `useEntitlements()` wraps RevenueCat's customer-info listener, and how the "please update" screen reads `min_supported_version`.

## 11. Facts gathered on 2026-10-20

- Expo SDK 58 released 2026-10-15: React Native 0.88, iOS 27, native tabs, toolbars, data loaders and middleware stable, Node 22.13+ or 24.3+. SDK 56 (2026-05-21): RN 0.85, React 19.2, TypeScript 6.0.3, Hermes V1 default, Expo UI stable and in the default template, `@expo/vector-icons` deprecated, `eas integrations:convex:connect`. ([SDK 58](https://expo.dev/changelog/sdk-58), [SDK 56](https://expo.dev/changelog/sdk-56))
- Deno team joined Cloudflare 2026-10-09; Deno Deploy shuts within six months; the runtime gets one year of maintenance. A Supabase engineer on Hacker News: Edge Functions keep working, Compute (Deno, Node, Bun) is in advanced development, no timeline. ([heise](https://www.heise.de/en/news/Cloudflare-to-discontinue-Deno-runtime-Open-source-community-to-take-over-11487398.html), [HN](https://news.ycombinator.com/item?id=50027914))
- NativeWind v5 is a release candidate marked not for production (page updated 2026-09-15); v4.2.7 is the Tailwind v3 stable line. Uniwind 1.12 is stable on Tailwind v4 with a free tier and a Pro tier at $99 per seat per year; its benchmarks are its own. ([NativeWind v5](https://www.nativewind.dev/v5), [Uniwind comparison](https://uniwind.dev/vs-nativewind), [Uniwind pricing](https://uniwind.dev/pricing))
- React Native Reusables ships a `minimal-uniwind` template and a CLI (`npx react-native-reusables@latest init`). (Context7, `/founded-labs/react-native-reusables`)
- Supabase free plan: 2 active projects, paused after a week of inactivity, 50K MAU, 500 MB database, 1 GB storage, 5 GB egress, 500K Edge Function invocations. Pro is $25 a month per organisation plus $10 a month compute per additional project. Legacy `anon` and `service_role` keys deprecated by end of 2026 in favour of publishable and secret keys. Built-in email: 2 messages an hour, team addresses only, not for production. ([pricing](https://supabase.com/pricing), [key migration](https://supabase.com/docs/guides/getting-started/migrating-to-new-api-keys), [SMTP](https://supabase.com/docs/guides/auth/auth-smtp))
- Expo's own Supabase guide uses the `expo-sqlite/localStorage` shim for session storage and `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, set up by `eas integrations:supabase:connect`. ([guide](https://docs.expo.dev/guides/using-supabase/))
- EAS free plan: 15 iOS and 15 Android low-priority builds a month, EAS Update to 1,000 monthly users, submissions included, no overage charges. Starter is $19 a month. ([pricing](https://expo.dev/pricing), [plans](https://docs.expo.dev/billing/plans/))
- Expo lists `react-native-purchases` (RevenueCat) and `expo-iap` for in-app purchases; both need a development build. RevenueCat is free to $2,500 monthly tracked revenue, then 1%. ([Expo IAP guide](https://docs.expo.dev/guides/in-app-purchases/))
- `react-native-google-mobile-ads` v17 requires React Native 0.86+ and the New Architecture, ships an Expo config plugin, needs a development build, and its Android port is partial. ([README](https://github.com/invertase/react-native-google-mobile-ads))
- Expo push notifications are free with a 600 per second per project rate limit. ([FAQ](https://docs.expo.dev/push-notifications/faq/))
- Jest remains the React Native default; Vitest is not practical there. React Query is still on v5 (5.101 as of June 2026).
- PostHog's free plan is one project; Sentry's is one user, 5K errors and 50 replays a month. Both are deferred anyway.

## 12. Decision log

Round 1 (cost): one Supabase project per app, Pro or a second free account later; Apple and Google sign-in only; store releases with EAS Update as a bonus; local builds by default.
Round 2 (look): native chrome with branded content; Uniwind; React Native Reusables; no web.
Round 3 (data): portable Supabase Edge Functions; online-first with a persisted cache; Zustand only when needed; React Hook Form with Zod 4.
Round 4 (money): RevenueCat; AdMob with a remote kill switch; the switch lives in an `app_config` table with no UI; no monitoring or analytics tooling.
Round 5 (platform): Expo push; Supabase Storage; `expo-sqlite` for everything on device; adaptive iPad layouts.
Round 6 (tooling): pnpm; ESLint 10 with `eslint-config-expo` and Prettier; tests for schemas and utilities only; GitHub Actions for typecheck, lint and test.
Round 7 (this repo): delete the Express gate and name Hono as the path; no template repo, a `/new-app` skill instead; this document in the repo and as a published page; GitHub Pages for store pages.
Round 8 (after the reviewer check): one public `app-sites` repo for store pages, because app repos are private and GitHub Pages is free only for public repos; no repo consumes 1.x today.
