## Which gates apply

Paths are relative to the gate root.

- Every task: coding-standards.md, project-structure.md, security-standards.md
- App / UI task: also frontend-patterns.md
- App data-fetching / server-state task: also tanstack-query.md
- API task: also backend-patterns.md and database-standards.md
- Database / migration task: also database-standards.md
- Touches several areas: all seven

tanstack-query owns the app's data layer — the per-domain `hooks/` layout, the
shared API client, query keys, caching, invalidation, prefetch. Apply it
whenever an app task touches server data.

Heavier security audits can be delegated to the `security-reviewer` agent.
