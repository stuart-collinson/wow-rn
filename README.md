# wow-rn — my ways of working for React Native

This is my engineering standards for **React Native** projects, packaged as a Claude Code plugin. It's a personal thing — a single source of truth for how I want Claude to write code across my Expo apps, the same way [`wow`](https://github.com/stuart-collinson/wow) is for my Next.js work. If you stumbled on this, feel free to poke around, but the opinions in here are mine.

The stack it assumes: **Expo + Expo Router · gluestack-ui v3 + NativeWind · Zustand · React Hook Form + Zod · TanStack Query** on the app, a **Node/Express + Supabase** API behind it, and **pnpm** everywhere.

## What it does

When I start a Claude Code session in a repo that has this plugin enabled, a `SessionStart` hook reads my gate files and injects them into the session context. From then on, Claude already knows my coding standards, RN/Expo patterns, backend patterns, database rules, and security standards without me having to remind it.

- **Gates** (`gates/`) — the single source of truth. Injected into every session.
- **Skills** (`skills/`) — slash commands: `/commit`, `/implement-code`, `/review-code`.
- **Agents** (`agents/`) — specialists like `security-reviewer` I can delegate heavier audits to.
- **Hook** (`hooks/hooks.json` + `scripts/inject-gates.mjs`) — wires the gates into the session at start.

### The gates

| Gate | Covers |
|---|---|
| `coding-standards.md` | Universal TS style — `type` not `interface`, arrow functions, guard clauses, no `any`, immutability, naming, near-zero comments, Zod validation |
| `project-structure.md` | The pnpm monorepo (`apps/mobile`, `apps/api`, `packages/shared`) and the Expo Router app layout |
| `frontend-patterns.md` | RN + Expo Router, gluestack + NativeWind styling, navigation & auth gate, Zustand / RHF, lists, performance, a11y |
| `tanstack-query.md` | The data layer — `lib/api/` ↔ `hooks/<domain>/` split, the shared API client, query keys, caching, `queryOptions`, mutations & invalidation, polling, infinite-list pagination, prefetch |
| `backend-patterns.md` | Node/Express + Supabase, the four-layer split (routes → controller → service → repository), response envelope, auth |
| `database-standards.md` | Supabase migrations (idempotent, append-only), RLS, schema conventions, indexes |
| `security-standards.md` | Mobile threat model — no secrets in the bundle, SecureStore, server-side authz, deep-link validation |

## How my other repos use it

This installs from a Claude Code **plugin marketplace** (this repo *is* the marketplace). Each repo I want it applied to gets a single `.claude/settings.json`:

```json
{
  "extraKnownMarketplaces": {
    "rn-ways-of-working": {
      "source": { "source": "git", "url": "https://github.com/stuart-collinson/wow-rn.git" },
      "autoUpdate": true
    }
  },
  "enabledPlugins": {
    "rn-ways-of-working@rn-ways-of-working": true
  }
}
```

Then a one-time install per project:

```bash
claude plugin marketplace add https://github.com/stuart-collinson/wow-rn --scope project
claude plugin install rn-ways-of-working@rn-ways-of-working --scope project
```

After that, every `claude` session in that repo loads the latest gates automatically (via `autoUpdate`).

## Updating gates

1. Edit the gate file in `gates/`.
2. Bump the `version` in `.claude-plugin/plugin.json` (patch for tweaks, minor for new content, major for breaking changes).
3. Commit and push.

Next session in any consuming repo picks it up via `autoUpdate`. See [`CLAUDE.md`](CLAUDE.md) for the version-bump and smoke-test details.
