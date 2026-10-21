# Security Standards

Security rules for a React Native (Expo) app talking straight to Supabase. Mobile changes the threat model from the web: the app bundle ships to the user's device and can be unpacked, so **nothing secret survives in the client**. There is no API server in front of the database — Supabase RLS and the few Edge Functions are where trust actually lives.

## Secrets — nothing secret lives in the app

```typescript
// FAIL — a secret in the app. EXPO_PUBLIC_* ships to every device.
const supabase = createClient(url, process.env.EXPO_PUBLIC_SUPABASE_SECRET_KEY)

// PASS — the app only ever holds the publishable key (designed to be public; RLS guards the data)
const supabase = createClient<Database>(env.EXPO_PUBLIC_SUPABASE_URL, env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY, { auth: { /* below */ } })
```

- Anything `EXPO_PUBLIC_*` is **readable by anyone with the app** — treat it as published. Public by design: the Supabase publishable key, RevenueCat's public SDK keys, AdMob app and unit IDs. They identify; they don't authorise.
- The Supabase **secret key**, webhook secrets, and any third-party server key live **only in Edge Function secrets** (`edge-functions`). Never in `EXPO_PUBLIC_*`, never in `app.json`, never in git.
- Only the new key names exist in a repo: `sb_publishable_…` in the app, `sb_secret_…` on the server. The legacy key pair Supabase deprecates at the end of 2026 must not appear.
- No hardcoded keys, tokens, or passwords anywhere. `.env*` files are gitignored; `.env.example` ships with empty values.

**Checklist:** no secrets in the bundle · publishable key only in the app · secret key only in Edge Functions · legacy key names absent · `.env*` gitignored.

## Sign-in

Apple and Google only, and every app requires it: the sign-in screen says in one line why an account is needed (your data syncs across devices), and the App Review notes say the same. The calls live in `lib/api/auth.ts`.

- **Apple, iOS only:** `AppleAuthentication.signInAsync()` → `supabase.auth.signInWithIdToken({ provider: 'apple', token: credential.identityToken })`. Apple sends the name only on the first sign-in; save it to `profile.display_name` then.
- **Google, both platforms, in the browser:** `signInWithOAuth({ provider: 'google', options: { redirectTo, skipBrowserRedirect: true } })` → `WebBrowser.openAuthSessionAsync(data.url, redirectTo)` → `exchangeCodeForSession(code)` from the returned URL. `redirectTo` is `Linking.createURL('auth/callback')`, listed in the dashboard's Redirect URLs and `config.toml`'s `additional_redirect_urls`; `app/+native-intent.tsx` maps that path to `/` so Android's copy of the redirect never hits the not-found screen. No native Google SDK: the free one runs on Android sign-in APIs Google has deprecated.

## Session & device storage

```typescript
// PASS — lib/supabase.ts: the session persists in the app sandbox through expo-sqlite's localStorage shim
import 'expo-sqlite/localStorage/install'

export const supabase = createClient<Database>(env.EXPO_PUBLIC_SUPABASE_URL, env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY, {
  auth: { storage: globalThis.localStorage, persistSession: true, autoRefreshToken: true, detectSessionInUrl: false, flowType: 'pkce' },
})
```

- **The default is the app sandbox**, which iOS and Android encrypt at rest per app — what Expo's own Supabase integration scaffolds. `startAutoRefresh()` / `stopAutoRefresh()` follow `AppState` so tokens refresh in the foreground.
- **Escalation rule:** an app handling health, finance, or similarly sensitive data stores the session with Supabase's documented `LargeSecureStore` pattern (an AES key in `expo-secure-store`, the encrypted session in AsyncStorage). Copy that pattern verbatim from Supabase's Expo guide; Supabase warns that "optimising" it introduces subtle vulnerabilities.
- `kvStorage` (`expo-sqlite/kv-store`) holds non-sensitive state: the query cache, settings, review-prompt counters. Anything secret a user types in (a key to a service they own) goes in `expo-secure-store`.
- No token ever lands in a Zustand store, a log line, or a component prop.

**Checklist:** session via the `expo-sqlite` shim (or the Keychain pattern for sensitive apps) · `autoRefreshToken` tied to `AppState` · no tokens in stores or logs.

## Input & deep-link validation

```typescript
// PASS — Zod-validate every external input, including route/deep-link params
const { id } = useLocalSearchParams<{ id: string }>()
const parsed = z.uuid().safeParse(id)
if (!parsed.success) return <NotFound />
```

- All user input, **deep-link / route params**, Edge Function payloads, and `app_config` values are validated with Zod before use — a deep link is attacker-controllable input, and a config row was typed by hand.
- Whitelist, don't blacklist. Error messages don't leak sensitive info.

## Authorisation — RLS is the floor

Authorisation lives in the database, never in the app. The client deciding "this user is pro, show the button" is a UX nicety, not a security control — a modified client skips it.

- **RLS enabled on every table** with per-action policies (see `database-standards`). It's the enforcement that survives a tampered client, and with no API in front of Postgres it is the only one.
- **The Supabase client is imported only in `lib/`** (`tanstack-query` → the seam). A `supabase.from()` in a component is a review failure because it is where ad-hoc, unreviewed access starts.
- **Edge Functions verify their caller** and take identity from the verified token (`edge-functions`).
- **Privileged operations** (account deletion, anything touching `auth.users`) are `SECURITY DEFINER` functions that act on `auth.uid()` and nothing else.

## Injection

```typescript
// PASS — the typed builder parameterises automatically
const { data } = await supabase.from('workout').select('id, name').eq('id', workoutId)

// FAIL — string-built SQL anywhere, including inside an RPC body
const query = `SELECT * FROM workout WHERE id = '${workoutId}'`
```

Never compose SQL as a string. Genuine raw-SQL needs go in a Postgres function with typed parameters. For `ILIKE` patterns, escape `%`, `_`, `\` in user input before interpolating into the pattern. Never let the user choose a column, table, or operator without an allow-list.

## Ads & tracking

- **Consent before any ad request.** `initialiseAds()` (`store-and-monetisation`) runs the consent form first, asks App Tracking Transparency only when consent allows it, and initialises the SDK last. No `BannerAd` renders before it resolves.
- **No analytics or crash SDK ships by default.** Adding one later is a privacy-manifest and App Store privacy-label change, not a drop-in.

## Transport & platform

- **HTTPS only.** No cleartext traffic — keep `usesCleartextTraffic` off (Android) and ATS on (iOS).
- Set `autoCapitalize="none"` and `secureTextEntry` on credential-like inputs; disable screenshots on sensitive screens where the platform allows.
- Keep the Expo SDK and native dependencies current; run `pnpm audit` and address high-severity advisories. Don't ship `expo-dev-client` or debug-only tooling in production builds.
- **Supabase Storage buckets are private** with signed URLs of 15 minutes or less. Each user's files live under a `<user id>/` folder, with `storage.objects` policies on `(storage.foldername(name))[1] = (SELECT auth.uid())::text`. File size and MIME allow-list are bucket settings; filenames are generated (`crypto.randomUUID()`), never the user's.

## Sensitive data exposure

- Log shaped fields — `console.log('[auth][signed-in]', { userId })` — never a session, token, key, password or whole payload; device logs reach store crash reports. Scrub PII first.
- Error messages shown to the user are generic; detail stays in Edge Function logs. Never surface a stack trace in the app.

## Flag Immediately

| Pattern | Severity | Fix |
|---|---|---|
| Secret key, webhook secret or third-party server key in `EXPO_PUBLIC_*` or the bundle | CRITICAL | Move to Edge Function secrets |
| Authorisation decided only in the app | CRITICAL | RLS policy, or a `SECURITY DEFINER` function scoped to the caller |
| Table with user data, RLS disabled or no policies | CRITICAL | Enable RLS, write per-action policies |
| String-concatenated SQL | CRITICAL | Typed builder / RPC with parameters |
| Webhook handler without a secret check | CRITICAL | Compare the shared secret on every request |
| Legacy API keys (`SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, an `eyJ…` key) in a new repo | HIGH | Publishable and secret keys; the `anon` Postgres role is current |
| Supabase client imported outside `lib/` | HIGH | Move the call into a fetcher |
| Unvalidated deep-link param used in a query/navigation | HIGH | Zod-validate before use |
| Ad request before the consent form resolves | HIGH | Gate on `initialiseAds()` |
| Cleartext HTTP traffic | HIGH | HTTPS only |
| Logging tokens / passwords / full bodies | MEDIUM | Redact, log shaped fields |

## Common False Positives

- The Supabase **publishable** key, RevenueCat public SDK keys and AdMob IDs in the app — public by design; RLS and the stores guard the data and the money.
- Values in `.env.example` (placeholders, not real secrets).
- Test credentials in test files, clearly marked.
