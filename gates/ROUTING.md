## Which gates apply

Paths are relative to the gate root.

- Every task: coding-standards.md, project-structure.md, security-standards.md
- App / UI task: also frontend-patterns.md
- App data-fetching / server-state task: also tanstack-query.md
- Database / migration task: also database-standards.md
- Server-side code (Edge Functions, webhooks, push sending): also edge-functions.md
  and database-standards.md
- Payments, ads, push, store review, account deletion, release: also
  store-and-monetisation.md
- Touches several areas: all eight

tanstack-query owns the app's data layer — the per-domain `lib/api/` and `hooks/`
layout, the Supabase fetchers, query keys, caching, persistence, prefetch. Apply it
whenever an app task touches server data.

Heavier security audits can be delegated to the `security-reviewer` agent.
