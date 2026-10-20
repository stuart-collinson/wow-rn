# wow-rn — Claude Code Plugin

This repo is the `rn-ways-of-working` plugin, consumed by my React Native (Expo) repos via `.claude/settings.json`. The stack it prescribes is zero-monthly-cost: Expo + Expo Router, Uniwind + React Native Reusables + Expo UI, TanStack Query, Supabase direct from the app with RLS (no API server), a few portable Edge Functions, RevenueCat, AdMob, Expo push. The `/new-app` skill scaffolds an app that matches it.

Gate text reaches a session through a **memory import**, never through the hook. Each consuming repo's own `CLAUDE.md` carries the line `@~/.claude/plugins/marketplaces/rn-ways-of-working/gates/GATES.md`, and Claude Code expands that at launch with no size limit. `gates/GATES.md` imports every gate plus `gates/ROUTING.md`. The `SessionStart` hook (`scripts/check-gates.mjs`) only checks that the import is present and resolves, and warns loudly when it is not.

> **Never put gate text in the hook.** Claude Code caps a hook's `additionalContext` at 10,000 characters and replaces anything larger with a file path and a 2 KB preview, with no error. The gates are ~100,000 characters. Before 1.0.0 the hook shipped all of them, and every session silently received the first thousand characters of `coding-standards` and nothing else. `check-gates.mjs` throws rather than emit anything over the cap.

## Two rules that keep the plugin honest

- **The gate total stays at about 100,000 characters.** Every gate is loaded into every session of every app. Check with `wc -c gates/*.md` before pushing; if a gate grows, another shrinks.
- **A vendor or account change updates three places in the same commit:** the gate that uses it, the account table in `README.md` ("Before you start an app"), and the `/new-app` recipe (`skills/new-app/SKILL.md` and its `files/`). Starting a new app must never need a step that isn't written down.

## Before every commit: bump the version

Consumers' `autoUpdate: true` only refreshes the cached plugin when `.claude-plugin/plugin.json`'s `version` changes. Push without a bump and nobody gets the update until they run `claude plugin update rn-ways-of-working@rn-ways-of-working` by hand.

So: any commit that changes gates, the hook script, agents, skills, or plugin config must bump the version in the same commit.

- Gate tweak / typo / rule edit → patch (`2.0.0 → 2.0.1`)
- New gate / skill / agent → minor (`2.0.x → 2.1.0`)
- Anything consumers must act on (rename / removal / a new line in their `CLAUDE.md`) → major (`2.x.y → 3.0.0`)

## Before pushing: smoke-test the hook

```bash
CLAUDE_PLUGIN_ROOT="$(pwd)" CLAUDE_PROJECT_DIR="$(mktemp -d)" node scripts/check-gates.mjs | head -c 200
```

Output must start with `{"hookSpecificOutput":{"hookEventName":"SessionStart"` — anything else and Claude Code silently ignores it. Against an empty project directory, as above, the context must be the `WARNING` form. Point `CLAUDE_PROJECT_DIR` at a consuming repo whose import resolves and it must be the `loaded in full` form.

Check every gate still resolves as an import — a gate missing from `GATES.md` is a gate nobody gets:

```bash
cd gates && grep -o '^@[^ ]*' GATES.md | sed 's/^@//' | xargs -I{} test -f {} && echo "all imports resolve"
```

## Adding a gate

Create the file under `gates/`, add an `@name.md` line to `gates/GATES.md`, and add it to `gates/ROUTING.md`. The hook reads nothing but `ROUTING.md`, so there is nothing to wire there.

## Layout

- `gates/` — the standards. `GATES.md` is the entry point consumers import; `ROUTING.md` says which gates apply to which task and is imported by `GATES.md` and rendered by the hook's warning.
- `scripts/check-gates.mjs` — the `SessionStart` check. Looks for the import in the project's `CLAUDE.md`, `.claude/CLAUDE.md` and `CLAUDE.local.md`, verifies the target exists, and emits a one-line confirmation or the warning.
- `hooks/hooks.json` — wires the script into `SessionStart` (matchers: `startup|resume|clear|compact`).
- `skills/` — `/new-app` (the scaffolding recipe plus `files/`, the reference files it copies into a new app), `/commit`, `/implement-code`, `/review-code`.
- `agents/` — `security-reviewer`.
- `.claude-plugin/plugin.json` — plugin manifest. `.claude-plugin/marketplace.json` — marketplace manifest (this repo is its own marketplace).
