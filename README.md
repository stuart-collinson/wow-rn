# wow-rn — my ways of working for React Native

My engineering standards for **React Native (Expo)** apps, packaged as a Claude Code plugin called `rn-ways-of-working`. One source of truth for how I want Claude to write code across my small indie apps, the same way [`wow`](https://github.com/stuart-collinson/wow) is for my Next.js work. A repo enables one or the other, never both.

The stack it assumes, at no monthly cost: **Expo (current SDK) + Expo Router with native tabs · Uniwind (Tailwind v4) + React Native Reusables + Expo UI · TanStack Query · Zustand · React Hook Form + Zod · Supabase (one free project per app, RLS, a few Edge Functions) · RevenueCat · AdMob · Expo push · pnpm.** No API server, no analytics vendors, no web.

If you stumbled on this, feel free to poke around, but the opinions in here are mine.

## Before you start an app

### 1. Accounts

| Account | Cost | When |
|---|---|---|
| Apple Developer Program | $99/year | Always. App Store, TestFlight, Sign in with Apple (plus its `.p8` key, so account deletion can revoke tokens), push keys. |
| Google Play Console | $25 once | Always. A new personal account runs a closed test with 12 testers for 14 days before its first production release. |
| GitHub | Free | Always. Private app repos, CI, and the public `app-sites` repo for store pages. |
| Expo | Free | Always. `eas submit`, credentials, EAS Update, the Supabase integration command. |
| Supabase | Free for two apps | Always. One project per app. App three means Pro ($25/month plus $10/month per extra project). Free projects pause after a week without activity; restore them from the dashboard. |
| Google Cloud project | Free | Always. One web OAuth client for Google sign-in, its ID and secret entered in Supabase (Auth → Providers → Google). Under your existing Google account. |
| RevenueCat | Free to $2.5K/month revenue, then 1% | Only when an app sells something. Apple's paid-apps agreement and bank details too. |
| Google AdMob | Free | Only when an app shows ads. |
| Firebase project | Free | Only when an app sends push to Android (FCM credentials for Expo's push service). |

Not needed: Hono, AWS, Cloudflare, Resend, Sentry, PostHog, Vercel.

### 2. Tools on the Mac

Node 22+, pnpm, Xcode and Android Studio, Docker Desktop (runs Supabase locally), the Supabase CLI, `gh`. The EAS CLI runs through `npx eas-cli`.

### 3. Enable the plugin in the new repo

`.claude/settings.json`:

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

`CLAUDE.md`, with the import line outside any code block:

```markdown
## Engineering standards

The `rn-ways-of-working` gates load in full through this import. They are rules, not suggestions; where this file and a gate overlap, this file wins.

@~/.claude/plugins/marketplaces/rn-ways-of-working/gates/GATES.md
```

Then, once per repo:

1. Start `claude` in the repo and accept the prompt to install `rn-ways-of-working`. If no prompt appears, run `claude plugin install rn-ways-of-working@rn-ways-of-working --scope project`.
2. Answer **Yes** to "Allow external CLAUDE.md file imports?". The highlighted default is **No**, and a No is remembered: the gates never load in that repo and Claude Code never asks again. To undo a No, quit Claude Code, set `"hasClaudeMdExternalIncludesApproved": true` for the repo under `projects` in `~/.claude.json`, and start again.
3. Start a new session and send any message. If the gates didn't load, the plugin says so and why; silence means they did.

Headless runs (`claude -p`, CI) never show the prompt, so answer it interactively first.

## What's in it

| Part | What it does |
|---|---|
| `gates/` | The standards — eight markdown files, loaded in full into every session of a repo that uses this plugin. |
| `skills/` | `/commit`, `/implement-code`, `/review-code`. |
| `agents/` | `security-reviewer`, for heavier audits. |
| `hooks/` + `scripts/` | A `SessionStart` check that the import line is in place, and a first-prompt check that Claude Code really loaded the gates. Each warns when something is wrong. |

### The gates

| Gate | Covers |
|---|---|
| `coding-standards.md` | Universal TS style — `type` not `interface`, arrow functions, guard clauses, no `any`, immutability, naming, near-zero comments, Zod at boundaries |
| `project-structure.md` | One private repo per app: `app/` routes, `src/` code, `supabase/` at root, the public `app-sites` repo |
| `frontend-patterns.md` | Expo Router with native tabs and the auth gate, Expo UI versus Tailwind, Uniwind + Reusables, forms, lists, adaptive iPad layouts, accessibility |
| `tanstack-query.md` | The data layer — `lib/api/` fetchers on supabase-js, cache files, hooks, mutations, the persisted cache, pagination, prefetch, `app_config` |
| `database-standards.md` | Migrations (idempotent, append-only), RLS, schema conventions, functions and jobs, the skeleton schema |
| `edge-functions.md` | The little server code: when a function is justified, the portability rule, verifying callers, webhooks, Apple token revocation, push |
| `security-standards.md` | The mobile threat model — publishable versus secret keys, session storage, RLS as the floor, deep links, ads consent, webhooks |
| `store-and-monetisation.md` | RevenueCat, AdMob with the `app_config` kill switch, push, review prompts, account deletion, store pages, release and EAS Update policy |

`gates/ROUTING.md` says which gates apply to which task. `gates/GATES.md` imports all of them and is the file consuming repos point at. The gates travel through that import, never through the hook: Claude Code caps a hook's context at 10,000 characters and the gates are about 100,000.

## First real app checklist

Things only a human with live accounts can finish, once per app: Google and Apple sign-in against the hosted project (Apple needs a physical device), the `auth/callback` redirect URL in Supabase's Redirect URLs, the Sign in with Apple key in Edge Function secrets, account deletion tested end to end from the settings screen (Apple revoke included), push credentials via `eas credentials`, RevenueCat sandbox purchases, the three `app-sites` URLs entered in App Store Connect and the Play Console, and Google's closed test.

## Updating the gates

1. Edit the gate file in `gates/`. Keep the total near 100,000 characters (`wc -c gates/*.md`).
2. Bump `version` in `.claude-plugin/plugin.json` — patch for tweaks, minor for new content, major for anything consumers must act on. Gate text updates without a bump, but skills, hooks and the agent only update when the version changes; skip it and they fall behind the gates.
3. Commit and push. Auto-update runs in the background of an interactive session, so the change arrives one session later. To take it now: `claude plugin marketplace update rn-ways-of-working && claude plugin update rn-ways-of-working@rn-ways-of-working`, then start a new session.

Adding a gate: create the file under `gates/`, add an `@name.md` line to `gates/GATES.md`, add it to `gates/ROUTING.md`. A change that adds or removes a vendor or account also updates the table above.

## Layout

```
.claude-plugin/
├── plugin.json           # plugin manifest — bump version here
└── marketplace.json      # this repo is its own marketplace
gates/
├── GATES.md              # entry point: imports every gate; consuming repos import this file
├── ROUTING.md            # which gates apply to which task
└── *.md                  # the eight gates
hooks/hooks.json          # SessionStart → check-gates.mjs; InstructionsLoaded + UserPromptSubmit → confirm-gates-loaded.mjs
scripts/check-gates.mjs   # confirms the import line is in place; warns if not; never carries gate text
scripts/confirm-gates-loaded.mjs  # records the GATES.md load; warns on the first prompt when it didn't happen
skills/                   # /commit, /implement-code, /review-code
agents/                   # security-reviewer
CLAUDE.md                 # notes for Claude when working on this repo itself
```
