---
name: new-app
description: Scaffold a new Expo + Supabase app that matches the gates, as the first commit of a new repo; asks hosted or local-only first
disable-model-invocation: true
---

# New App

Scaffold a brand-new app that already obeys every gate: one private repo, Expo Router with native tabs, Uniwind + React Native Reusables, Supabase with RLS, TanStack Query with a persisted cache, Apple and Google sign-in, the `app_config` switches, CI, and the store pages. The result is a running skeleton as the first commit, not a README.

Reference files live at `${CLAUDE_PLUGIN_ROOT}/skills/new-app/files/` and mirror the final repo layout. Copy them verbatim unless a step says to adapt. Every file matches a gate example; when a gate and a file disagree, the gate wins — fix the file and say so.

## Step 0 — Ask, then check

Ask these before touching the disk (one `AskUserQuestion` round):

1. **App name and slug** (`my-app`), **iOS bundle identifier** and **Android package** (`com.<you>.<slug>`), the **contact email** for the store pages.
2. **Hosted Supabase now, or local only?** Local only runs everything against `supabase start`, skips EAS and the hosted project, and never consumes a free Supabase slot. The hosted steps can be run later from this recipe.
3. **Modules:** payments (RevenueCat), ads (AdMob), push — yes or no each. Default all off.

Then check the machine: `node -v` is 22+, `pnpm -v`, `supabase --version`, `docker info` succeeds, `gh auth status` is logged in. Hosted mode also needs `npx eas-cli whoami` and `supabase projects list` to work, and the accounts in the plugin README's "Before you start an app" table. Stop and say what is missing rather than working around it.

## Step 1 — Scaffold the template

In an empty directory named after the slug:

```bash
npx react-native-reusables@latest init -t minimal-uniwind   # the Reusables "Minimal (Uniwind)" template
pnpm install                                                # the template's .npmrc already sets node-linker=hoisted
```

If the CLI prompts for a name, use the slug. The template puts `app/`, `components/`, `lib/`, `global.css`, `metro.config.js` and `components.json` at the root with `@/*` mapped to the root; the next step moves it to the gated layout.

The template usually trails the current Expo SDK by a release or two. Bring it up to date before anything else:

```bash
npx expo install expo@latest && npx expo install --fix                  # every expo-* package to the current SDK
```

## Step 2 — Move to the gated layout

```bash
mkdir -p src && mv components lib src/                      # non-route code lives in src/
```

- `tsconfig.json`: delete `baseUrl` (TypeScript 6 rejects it), set `"paths": { "@/*": ["./src/*"] }`, and add `"exclude": ["node_modules", "supabase", "ios", "android", "dist"]` so the Deno-side function files stay out of the app's typecheck. Leave `components.json` alone — its `@/` aliases now resolve into `src/`, which is where `npx react-native-reusables@latest add <component>` must write.
- Delete `app/index.tsx` and `app/+html.tsx` (no web), then copy every file under `files/app/` into `app/` and every file under `files/src/` into `src/` (merge; the template's `src/components/ui`, `src/lib/utils.ts` and `src/lib/theme.ts` stay).
- Copy `files/eas.json`, `files/eslint.config.js`, `files/jest.config.js` to the root, `files/env.example` to `.env.example`, `files/github/ci.yml` to `.github/workflows/ci.yml`, and `files/supabase/functions/` to `supabase/functions/`.
- Add to `.gitignore`: `ios/`, `android/`, `.env.local`, `supabase/.temp/`, `supabase/functions/.env`.
- Enable the plugin in the new repo exactly as the plugin README says: `.claude/settings.json` with the marketplace entry, and a `CLAUDE.md` whose import line is `@~/.claude/plugins/marketplaces/rn-ways-of-working/gates/GATES.md` outside any code block.

## Step 3 — Dependencies and scripts

```bash
npx expo install @supabase/supabase-js expo-sqlite expo-network expo-constants expo-apple-authentication @react-native-google-signin/google-signin expo-store-review expo-image @expo/ui @shopify/flash-list zustand react-hook-form @hookform/resolvers zod @tanstack/react-query @tanstack/react-query-persist-client @tanstack/query-async-storage-persister
npx expo install jest-expo jest @jest/globals eslint-config-expo -- --save-dev        # expo install picks the versions that match the SDK; tests import from @jest/globals
pnpm add -D 'eslint@^9'                                                               # eslint-config-expo's React plugin does not run on ESLint 10 yet
```

Two pnpm policies will speak up, and both answers live in `pnpm-workspace.yaml` (pnpm 11 ignores a `pnpm` key in `package.json`):

- **Build scripts.** pnpm refuses install scripts from packages it doesn't know and writes an `allowBuilds` stub listing them; set each to `true` (`@parcel/watcher` and `unrs-resolver` today).
- **Release age.** pnpm rejects packages published within the last 24 hours (`ERR_PNPM_MINIMUM_RELEASE_AGE_VIOLATION`), which bites right after an SDK release. pnpm writes the `minimumReleaseAgeExclude` entries for you; keep them, they are the Expo packages you just asked for.

Replace the template's `scripts` with the gated set:

```json
{
  "dev": "expo start",
  "typecheck": "tsc --noEmit",
  "lint": "eslint .",
  "test": "jest",
  "db:start": "supabase start",
  "db:reset": "supabase db reset",
  "db:push": "supabase db push",
  "db:types": "supabase gen types typescript --local > src/types/database.types.ts",
  "build:ios": "eas build --local --platform ios --profile production",
  "build:android": "eas build --local --platform android --profile production",
  "submit:ios": "eas submit --platform ios",
  "submit:android": "eas submit --platform android"
}
```

## Step 4 — `app.json`

Set `name`, `slug`, `scheme` (the slug), `version: "1.0.0"`, `ios.bundleIdentifier`, `ios.supportsTablet: true`, `ios.usesAppleSignIn: true`, `android.package`, `userInterfaceStyle: "automatic"`, `experiments.typedRoutes: true`. Remove the `web` block. Plugins:

```json
"plugins": [
  "expo-router",
  ["expo-splash-screen", { "image": "./assets/images/splash.png", "resizeMode": "contain", "backgroundColor": "#ffffff" }],
  "expo-sqlite",
  "expo-apple-authentication",
  ["@react-native-google-signin/google-signin", { "iosUrlScheme": "com.googleusercontent.apps.<ios-client-id>" }]
]
```

The `iosUrlScheme` is the reversed iOS client id from Google Cloud; in local-only mode leave the placeholder and note it in the README's first-real-app checklist.

## Step 5 — Supabase

```bash
supabase init                                                # creates supabase/config.toml only
mkdir -p supabase/migrations
cp ${CLAUDE_PLUGIN_ROOT}/skills/new-app/files/supabase/migrations/*.sql supabase/migrations/
pnpm db:start                                                # local stack via Docker
pnpm db:reset && pnpm db:reset                               # applies the skeleton, then proves it re-applies
pnpm db:types                                                # src/types/database.types.ts — commit it
```

If `supabase start` fails with "port is already allocated", another local Supabase project is running on this Mac. Don't stop it: change this app's ports in `supabase/config.toml` (`[api] port`, `[db] port` and `shadow_port`, `[db.pooler] port`, `[studio] port`, `[local_smtp] port`, `[analytics] port`) to an unused range such as `563xx`, and use that API port in `.env.local`.

Write `.env.local` from `.env.example`. **Local only:** `EXPO_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321` and the publishable key printed by `supabase status`; `local` as a placeholder for the two Google client ids. **Hosted:** choose the Supabase organisation first — if it already has two active free projects, stop and surface the choice (Pro, or another organisation) rather than guessing. Then `npx eas-cli init`, `npx eas-cli integrations:supabase:connect` (creates the project and writes the two Supabase env vars), `supabase link --project-ref <ref>`, `pnpm db:push`, `pnpm db:types` against `--linked`. In the Supabase dashboard enable Authentication → Providers → Apple (client id = the bundle identifier) and Google (the web and iOS client ids from Google Cloud), and put the client ids in `.env.local`.

## Step 6 — Optional modules

Each is written to the `store-and-monetisation` gate; there are no reference files for them.

- **Payments:** `npx expo install react-native-purchases react-native-purchases-ui`; `src/lib/purchases.ts` (`configurePurchases`), `src/hooks/useEntitlements.ts`; call `configurePurchases()` and `Purchases.logIn` / `logOut` from `AppShell`; add the RevenueCat keys to `.env.local`.
- **Ads:** `npx expo install react-native-google-mobile-ads expo-tracking-transparency`; the plugin entry with `androidAppId`, `iosAppId`, `userTrackingUsageDescription`, `delayAppMeasurementInit: true`; `src/lib/ads.ts` (`initialiseAds`), `src/constants/ads.ts`, `src/components/AdBanner/AdBanner.tsx` gated on `app_config.ads_enabled`.
- **Push:** `npx expo install expo-notifications expo-device`; `src/lib/notifications.ts` (`registerForPush`), `src/lib/api/pushTokens.ts`, the `supabase/functions/send-push/` function per the `edge-functions` gate; the plugin entry for `expo-notifications`.

## Step 7 — Store pages, CI and the first-real-app checklist

```bash
gh repo view <you>/app-sites >/dev/null 2>&1 || gh repo create app-sites --public --clone   # once, ever
```

In a clone of `app-sites`, add `<slug>/privacy.md`, `support.md` and `delete-account.md` from `files/app-sites/` with `{{APP_NAME}}`, `{{DEVELOPER_NAME}}`, `{{CONTACT_EMAIL}}` and `{{DATE}}` replaced, commit and push, and make sure GitHub Pages serves the `main` branch root (`gh api -X POST repos/<you>/app-sites/pages -f source[branch]=main -f source[path]=/` the first time). The three URLs are `https://<you>.github.io/app-sites/<slug>/privacy`, `/support`, `/delete-account`.

Write the app's `README.md`: the stack in one line, the scripts, a pointer to the plugin README's account table, and a **first-real-app checklist** of what only a human with live accounts can finish: Google and Apple sign-in against the hosted project (Apple needs a physical device), the `iosUrlScheme`, push credentials via `eas credentials`, RevenueCat sandbox purchases, the three store URLs entered in App Store Connect and the Play Console, and Google's closed test.

## Step 8 — Verify, then commit

Every one of these must pass before the first commit:

```bash
pnpm typecheck && pnpm lint && pnpm test                      # jest-expo runs src/lib/version.test.ts
pnpm db:reset                                                 # the chain still applies a third time
npx expo export --platform ios                                # Metro bundles with Uniwind and the entry wiring
npx expo prebuild --platform ios --no-install                 # config plugins run; ios/ is gitignored, delete it after
```

With Xcode installed, also `npx expo run:ios` and confirm the sign-in screen renders in the simulator and Google sign-in works against the hosted project. Then:

```bash
git init && git add -A && git commit -m "chore: scaffold <slug> with /new-app"
```

Offer to create the private GitHub repo (`gh repo create <slug> --private --source=. --push`); don't do it unasked.
