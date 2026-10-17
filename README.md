# wow-rn — my ways of working for React Native

My engineering standards for **React Native** projects, packaged as a Claude Code plugin called `rn-ways-of-working`. It's a personal thing — one source of truth for how I want Claude to write code across my Expo apps, the same way [`wow`](https://github.com/stuart-collinson/wow) is for my Next.js work. A repo enables one or the other, never both.

The stack it assumes: **Expo + Expo Router · gluestack-ui v3 + NativeWind · Zustand · React Hook Form + Zod · TanStack Query** on the app, a **Node/Express + Supabase** API behind it, and **pnpm** everywhere.

If you stumbled on this, feel free to poke around, but the opinions in here are mine.

## What's in it

| Part | What it does |
|---|---|
| `gates/` | The standards themselves — seven markdown files, listed below. Loaded in full into every session of a repo that uses this plugin. |
| `skills/` | Slash commands: `/commit`, `/implement-code`, `/review-code`. |
| `agents/` | `security-reviewer`, a specialist I can delegate heavier audits to. |
| `hooks/` + `scripts/` | A `SessionStart` check that confirms the gates are loaded and warns loudly when they are not. |

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

`gates/ROUTING.md` says which gates apply to which kind of task. `gates/GATES.md` is the entry point that imports all of them — it is the file consuming repos point at.

## How the gates get into a session

Two things happen when Claude Code starts in a repo that uses this plugin:

1. **The repo's own `CLAUDE.md` imports the gates.** One line, `@~/.claude/plugins/marketplaces/rn-ways-of-working/gates/GATES.md`, points at the plugin's entry file in the marketplace cache. Claude Code expands `@` imports at launch with no size limit, so every gate arrives in full. Because the line lives in the repo, only that repo gets these gates — a Next.js repo importing `wow` never sees them.
2. **The plugin's `SessionStart` hook checks the import is there.** If it is, it says so in a line. If it isn't, or the file it points at is missing, it prints a loud warning with the exact line to add.

The gates deliberately do **not** travel through the hook. Claude Code caps a hook's `additionalContext` at 10,000 characters; anything larger is replaced by a file path and a 2 KB preview, with no error. These gates are ~99,000 characters. Until version 1.0.0 the hook shipped all of them, and every session silently received the first thousand characters of `coding-standards` and nothing else.

## Use it in a new project

Two files to add to the new repo, then one session to approve things. Takes a minute.

### 1. Enable the plugin — `.claude/settings.json`

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

This gives the repo the skills, the agent and the hook, and keeps them updated whenever this plugin's version changes.

### 2. Import the gates — `CLAUDE.md`

Add this to the repo's `CLAUDE.md`, creating the file if there isn't one:

```markdown
## Engineering standards

The `rn-ways-of-working` gates load in full through this import. They are rules, not suggestions; where this file and a gate overlap, this file wins.

@~/.claude/plugins/marketplaces/rn-ways-of-working/gates/GATES.md
```

The `~` path is where Claude Code keeps the marketplace clone on every machine, so the line is safe to commit. Keep it outside any code block — Claude Code ignores imports inside backticks.

### 3. Open Claude Code and accept two prompts

Start `claude` in the repo. The first time on a machine you'll be asked to:

- **Install the plugin** that `.claude/settings.json` enables. Accept.
- **Approve the external import.** The `CLAUDE.md` line points outside the working directory, and Claude Code asks once per project before loading it. Accept.

Then start a new session, because imports are expanded at launch.

### 4. Check it worked

The hook's startup context should begin `React Native engineering standards — rn-ways-of-working` and say the gates are loaded in full. If it begins `WARNING — rn-ways-of-working gates are NOT loaded`, the message says exactly what to fix.

For a real check, ask the session something only a gate answers — *"what does the database-standards gate say about RLS in migrations?"* — and it should answer without reading any files.

Commit `.claude/settings.json` and `CLAUDE.md`. The next clone of the repo, on any machine, needs only step 3.

## Updating the gates

1. Edit the gate file in `gates/`.
2. Bump `version` in `.claude-plugin/plugin.json` — patch for tweaks, minor for new content, major for anything consumers must act on.
3. Commit and push.

Consuming repos pick the new version up on their next session via `autoUpdate`, and the import reads from the refreshed cache, so the new text is live immediately.

### Adding a gate

Create the file under `gates/`, add an `@name.md` line to `gates/GATES.md`, and add it to `gates/ROUTING.md`. A gate missing from `GATES.md` is a gate nobody gets.

## Layout

```
.claude-plugin/
├── plugin.json           # plugin manifest — bump version here
└── marketplace.json      # this repo is its own marketplace
gates/
├── GATES.md              # entry point: imports every gate; consuming repos import this file
├── ROUTING.md            # which gates apply to which task
└── *.md                  # the gates
hooks/hooks.json          # wires check-gates.mjs into SessionStart
scripts/check-gates.mjs   # confirms the import is in place; warns if not; never carries gate text
skills/                   # /commit, /implement-code, /review-code
agents/                   # security-reviewer
CLAUDE.md                 # notes for Claude when working on this repo itself
```
