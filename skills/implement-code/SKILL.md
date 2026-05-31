---
name: implement-code
description: Implement a React Native / Expo feature against the engineering standards
disable-model-invocation: true
---

# Implement Code

You are about to implement code in a React Native (Expo) project. The engineering standards are injected into this session at startup by the `rn-ways-of-working` plugin — they are already in your context. Apply them; do not write a line that violates them.

## Step 1 — Understand the request

Confirm your understanding of:
- What is being built.
- Where it lives — a route (`app/`), a component, a hook, a store, the API (`apps/api`), or the database (a migration).
- Whether it's app, API, database, or several.

## Step 2 — Plan before you code

Briefly outline:
- Files to create or modify.
- Types needed — local vs shared in `types/` or `packages/shared`.
- State ownership — TanStack Query (server), Zustand (shared client), RHF (forms), or `useState` (local).
- Any security considerations (token storage, RLS, deep-link/input validation).

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
- [ ] Styling is NativeWind `className` on RN/gluestack components — no stray inline `style` objects
- [ ] Components from `@/components/ui` (gluestack) or `react-native`, reused before building new
- [ ] One component per file; parent owns logic, sub-components render
- [ ] Server data via TanStack Query (never mirrored into Zustand); forms via RHF + Zod
- [ ] Loading / empty / error states all handled; long lists use `FlatList`/`FlashList`
- [ ] Navigation via Expo Router typed routes; auth gated in the root layout

**API (backend)**
- [ ] Four-layer split respected: routes → controller → service → repository
- [ ] Zod `safeParse` on input; `.js` extensions on relative imports
- [ ] Explicit columns in selects; RLS-respecting client by default
- [ ] Standard response envelope; `DomainError` from services

**Database**
- [ ] Migration is idempotent (`IF NOT EXISTS` / `DROP … IF EXISTS` / `DO`-block guards)
- [ ] RLS enabled + policies in the same migration; `snake_case`, singular table name

**Security**
- [ ] No secrets in the app; tokens in SecureStore; identity from the verified JWT

## Step 4 — Self-review

Re-read each file against the checklist and fix violations before presenting. Don't ask the user to fix things you can resolve yourself.
