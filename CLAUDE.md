# wow-rn — Claude Code Plugin

This repo is the `rn-ways-of-working` plugin, consumed by my React Native repos via `.claude/settings.json`. On every `SessionStart`, a hook runs `scripts/inject-gates.mjs`, which reads every file under `gates/` and injects them as session context — so each session in a consuming repo starts pre-loaded with these standards.

## Before every commit: bump the version

Consumers' `autoUpdate: true` only refreshes the cached plugin when `.claude-plugin/plugin.json`'s `version` changes. Push without a bump and nobody gets the update until they manually run `claude plugin update rn-ways-of-working@rn-ways-of-working`.

So: any commit that changes gates, the hook script, agents, skills, or plugin config must bump the version in `.claude-plugin/plugin.json` in the same commit.

- Gate tweak / typo / rule edit → patch (`0.1.0 → 0.1.1`)
- New gate / skill / agent → minor (`0.1.x → 0.2.0`)
- Breaking change (remove / rename) → major (`0.x.y → 1.0.0`)

## Before pushing: smoke-test the hook

```bash
CLAUDE_PLUGIN_ROOT="$(pwd)" node scripts/inject-gates.mjs | head -c 200
```

Output must start with `{"hookSpecificOutput":{"hookEventName":"SessionStart"` — anything else and Claude Code silently ignores it.

## Layout

- `gates/` — markdown standards. The hook reads all of them on every session start.
- `scripts/inject-gates.mjs` — composes the gates into one `additionalContext` block and emits the `SessionStart` envelope.
- `hooks/hooks.json` — wires the script into `SessionStart` (matchers: `startup|resume|clear|compact`).
- `skills/` — slash-command skills (`/commit`, `/implement-code`, `/review-code`).
- `agents/` — specialist subagents (`security-reviewer`).
- `.claude-plugin/plugin.json` — plugin manifest. `.claude-plugin/marketplace.json` — marketplace manifest (this repo is its own marketplace).

## Adding a gate

If you add a file under `gates/`, also wire it into `scripts/inject-gates.mjs` (a `readGate(...)` call plus a section in the `context` template and the orchestration list) — the script reads named gates, not the whole directory blindly.
