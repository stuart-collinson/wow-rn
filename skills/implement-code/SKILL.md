---
name: implement-code
description: Implement a React Native / Expo feature against the engineering standards
disable-model-invocation: true
---

# Implement Code

You are about to implement code in a React Native (Expo) project. The engineering standards are loaded in full through the `GATES.md` import in this repo's `CLAUDE.md` — apply them; do not write a line that violates them. If the `SessionStart` hook warned that the gates are not loaded, Read every gate from the gate root it names before continuing.

## Step 1 — Understand the request

Confirm your understanding of:
- What is being built.
- Where it lives — a route (`app/`), a component, a hook, a store, a fetcher (`src/lib/api/`), an Edge Function (`supabase/functions/`), or the database (a migration).
- Whether it's app, data layer, server-side, database, or several.

## Step 2 — Plan before you code

Briefly outline:
- Files to create or modify.
- Types needed — the generated `Database` row type plus a domain type and mapper in `src/types/`, Zod schemas in `src/schemas/`.
- State ownership — TanStack Query (server), Zustand (shared client), RHF (forms), or `useState` (local).
- Any security considerations (keys, session storage, RLS policies, deep-link validation, consent before ads).

Don't skip this. Don't write code yet.

## Step 3 — Implement

Write the code. Use this checklist before outputting each file:

**TypeScript & style**
- [ ] `type` not `interface`; no `any`; no `@ts-ignore`
- [ ] Arrow functions only; one-line branches omit braces
- [ ] `camelCase` / `PascalCase` components / `SCREAMING_SNAKE_CASE` constants
- [ ] Order: imports → types → constants → logic → render
- [ ] No unused code; near-zero comments

**App (frontend)**
- [ ] Styling is Uniwind `className` on RN views and Reusables components — no stray inline `style` objects, no raw hex
- [ ] Native controls from Expo UI take props, never `className`; Reusables is the only fallback
- [ ] Components reused before built: Expo UI → `@/components/ui` → existing → composition → new
- [ ] One component per file; parent owns logic, sub-components render
- [ ] Server data via TanStack Query hooks (never mirrored into Zustand); forms via RHF + Zod
- [ ] Loading / empty / error states all handled; long lists use `FlatList`/`FlashList`
- [ ] Navigation via Expo Router typed routes; `NativeTabs` for tabs; auth gated with `Stack.Protected` in the root layout
- [ ] No hand-written memoisation (the React Compiler is on); adaptive layout at `md:` for iPad

**Data layer**
- [ ] Supabase client imported only in `src/lib/`; one fetcher per operation in `lib/api/<domain>.ts` with explicit columns, `unwrap`/`assertOk`, a row mapper
- [ ] `<domain>.cache.ts` with a key factory and `queryOptions` factories; one hook per file; no barrels
- [ ] Mutations invalidate the narrowest prefix; sign-out clears the query client and the persister

**Edge Functions**
- [ ] Web-standard `Request`/`Response`, `npm:` imports; `Deno.*` only in `_shared/runtime.ts`
- [ ] Caller verified with `verifyAuth`; identity from the token; admin client only in a job, with a comment why
- [ ] Secrets via `getEnv`; webhooks check the shared secret and are idempotent; logs are shaped fields

**Database**
- [ ] Migration is idempotent (`IF NOT EXISTS` / `DROP … IF EXISTS` / `DO`-block guards); `db reset` run twice
- [ ] RLS enabled + per-action policies in the same migration; `snake_case`, singular table name; `user_id DEFAULT auth.uid()`
- [ ] Types regenerated and committed (`pnpm db:types`)

**Security**
- [ ] Only the publishable key in the app; secrets only in Edge Function secrets
- [ ] Session via the `expo-sqlite` shim (Keychain pattern only for sensitive apps); nothing secret in stores or logs
- [ ] Deep-link params and `app_config` values Zod-validated; ads only after consent and `ads_enabled`

## Step 4 — Self-review

Re-read each file against the checklist and fix violations before presenting. Don't ask the user to fix things you can resolve yourself.
