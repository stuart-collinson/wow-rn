# Security Standards

Security rules for a React Native (Expo) app backed by a Node API and Supabase. Mobile changes the threat model from the web: the app bundle ships to the user's device and can be unpacked, so **nothing secret survives in the client**. The API and Supabase RLS are where trust actually lives.

## Secrets — nothing secret lives in the app

```typescript
// FAIL — service-role key in the app. EXPO_PUBLIC_* ships to every device.
const supabase = createClient(url, process.env.EXPO_PUBLIC_SUPABASE_SERVICE_ROLE_KEY)

// PASS — the app only ever holds the anon/publishable key (it's designed to be public, RLS guards the data)
const supabase = createClient(url, env.EXPO_PUBLIC_SUPABASE_ANON_KEY)
```

- Anything `EXPO_PUBLIC_*` is **readable by anyone with the app** — treat it as published. The Supabase anon key is meant to be public; a service-role key, API signing secret, or third-party server key is not and lives **only on the Node API**.
- No hardcoded keys, tokens, or passwords anywhere. `.env*` files are gitignored; no secrets in git history.
- Server secrets are configured on the API host (and EAS secrets for build-time native config), never bundled into the app.

**Checklist:** no hardcoded secrets · only the anon/publishable key in the app · service-role and third-party secrets API-only · `.env*` gitignored.

## Token & sensitive-data storage

```typescript
// FAIL — auth tokens / PII in AsyncStorage (unencrypted plaintext on disk)
await AsyncStorage.setItem('accessToken', token)

// PASS — encrypted at rest via the OS keystore / keychain
import * as SecureStore from 'expo-secure-store'
await SecureStore.setItemAsync('accessToken', token)
```

- **Auth tokens, refresh tokens, and any PII go in `expo-secure-store`** (iOS Keychain / Android Keystore), never AsyncStorage. AsyncStorage is fine for non-sensitive UI state (theme, last tab).
- Back the **Supabase client's session storage with a SecureStore adapter** so the persisted session is encrypted. SecureStore has a ~2KB per-value limit on Android — if a session exceeds it, chunk it or store only the refresh token securely.
- Configure the Supabase client with `autoRefreshToken: true`, `persistSession: true`, `detectSessionInUrl: false`, and pause/resume auto-refresh on `AppState` so tokens refresh in the foreground.

**Checklist:** tokens/PII in SecureStore not AsyncStorage · Supabase session storage encrypted · no sensitive data in plaintext on disk.

## Input & deep-link validation

```typescript
// PASS — Zod-validate every external input, including route/deep-link params
const { id } = useLocalSearchParams<{ id: string }>()
const parsed = z.string().uuid().safeParse(id)
if (!parsed.success) return <NotFound />
```

- All user input, API responses, and **deep-link / route params** are validated with Zod before use — a deep link is attacker-controllable input.
- Validate API responses at the boundary; a compromised or buggy upstream shouldn't crash the app with an unexpected shape.
- Whitelist, don't blacklist. Error messages don't leak sensitive info.

**Checklist:** all inputs Zod-validated · deep-link params validated · API responses validated at the boundary.

## Authorisation — RLS is the floor

Authorisation lives on the server, never in the app. The client deciding "this user is an admin, show the button" is a UX nicety, not a security control — a modified client skips it.

- **RLS enabled on every table with user data** (see `database-standards`). It's the enforcement that survives a tampered client.
- The Node API re-checks authorisation in the service layer; never trust a role or user id sent from the app — read identity from the verified JWT (`req.user.id`).
- Sensitive operations are gated on the server before they execute, not hidden in the UI.

**Checklist:** RLS on all user tables · server-side authz on sensitive operations · identity read from the verified JWT, never the request body.

## Injection

```typescript
// PASS — Supabase parameterises automatically
const { data } = await supabase.from('user').select('id, name').eq('email', userEmail)

// FAIL — string-built SQL
const query = `SELECT * FROM "user" WHERE email = '${userEmail}'`
```

Never compose SQL as a string. The Supabase client parameterises; genuine raw-SQL needs go in a Postgres function (RPC). For `ILIKE` patterns, escape `%`, `_`, `\` in user input before interpolating into the pattern.

## Transport & platform

- **HTTPS only.** No cleartext traffic — keep `usesCleartextTraffic` off (Android) and ATS on (iOS). The API is TLS-only.
- Set `autoCapitalize="none"` and `secureTextEntry` on credential inputs; disable autofill/screenshots on sensitive screens where the platform allows.
- Keep Expo SDK and native dependencies current; run `pnpm audit` and address high-severity advisories. Don't ship `expo-dev-client` or debug-only tooling in production builds.
- Validate and constrain file uploads on the API (size limit, MIME allow-list, sanitised filename) — see `backend-patterns`.

## Sensitive data exposure

```typescript
// FAIL — logging secrets / full payloads (logs may ship to a crash reporter)
console.log('login', { email, password, token })

// PASS — shaped, redacted
console.log('login', { userId })
```

- No passwords, tokens, or keys in logs — and remember device logs and crash reporters (Sentry) capture `console` output. Scrub PII before it reaches a reporter.
- Error messages shown to the user are generic; detailed errors stay in server logs. Never surface a stack trace in the app.

**Checklist:** no secrets/PII in logs or crash reports · generic user-facing errors · no stack traces in the app.

## Flag Immediately

| Pattern | Severity | Fix |
|---|---|---|
| Service-role / server secret in `EXPO_PUBLIC_*` | CRITICAL | Move to the API; app holds anon key only |
| Auth token in AsyncStorage | HIGH | Use `expo-secure-store` |
| Authorisation decided only in the app | CRITICAL | Enforce on the server + RLS |
| Table with user data, RLS disabled | CRITICAL | Enable RLS, write policies |
| String-concatenated SQL | CRITICAL | Parameterised query / RPC |
| Unvalidated deep-link param used in a query/navigation | HIGH | Zod-validate before use |
| Cleartext HTTP traffic | HIGH | HTTPS only |
| Logging tokens / passwords / full bodies | MEDIUM | Redact, log shaped fields |

## Common False Positives

- The Supabase **anon/publishable** key in the app (it's designed to be public; RLS guards the data).
- Values in `.env.example` (placeholders, not real secrets).
- Test credentials in test files, clearly marked.
