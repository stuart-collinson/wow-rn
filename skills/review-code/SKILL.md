---
name: review-code
description: Full pre-PR code review against the React Native engineering standards
disable-model-invocation: true
allowed-tools: Bash(git *)
---

# Review Code

A full pre-PR review against the standards injected by the `rn-ways-of-working` plugin (already in your session context). Follow every step in order.

## Step 1 — Collect the full diff

Capture everything that will land in the PR — committed, staged, and unstaged:

```bash
git diff main...HEAD
git diff --cached
git diff
git status
git log main...HEAD --oneline
```

If the base branch isn't `main`, use the actual base branch. If uncertain, ask before proceeding.

## Step 2 — Produce the report

Be specific — reference file + line and quote the offending code. Never be vague.

---

### PR Review Report

**Branch:** `<branch>` · **Base:** `main` · **Commits:** `<n>` · **Files changed:** `<n>`

#### Summary
One short paragraph on what the PR does.

#### 🔴 Blockers
> Must fix before merge — standards violations, security issues, broken patterns.
For each: **File + line** — the problem · **Code:** the snippet · **Fix:** what it should be.
If none: _None found._

#### 🟡 Warnings
> Should fix — not strictly blocking but will degrade quality. Same format.
If none: _None found._

#### 🔵 Suggestions
> Nice to have — minor readability / perf nudges.
If none: _None found._

#### Standards Compliance

| Category | Status | Notes |
|---|---|---|
| TypeScript strictness (no `any`, `type` not `interface`) | | |
| Arrow functions / no `function` keyword | | |
| Naming conventions | | |
| File structure (imports → types → logic → render) | | |
| Styling (NativeWind className, no stray inline styles) | | |
| Components (one per file, parent/child split, reuse) | | |
| State (TanStack Query for server, Zustand for shared, RHF for forms) | | |
| Loading / empty / error states handled | | |
| Lists use FlatList/FlashList | | |
| Navigation (Expo Router typed routes, auth gate) | | |
| API layering (routes → controller → service → repository) | | |
| Migrations idempotent + RLS in same file | | |
| Security (no app secrets, SecureStore, server-side authz, input/deep-link validation) | | |
| No unused code / near-zero comments | | |

Use ✅ clean, ⚠️ minor issues, ❌ violations.

#### Overall Verdict
**🟢 Good to go** / **🟡 Merge with fixes** / **🔴 Needs work** — one or two sentences.

---

## Step 3 — Offer to fix

After the report, ask: _"Would you like me to fix any of the blockers or warnings now?"_ If yes, fix one file at a time and confirm each before moving on.
