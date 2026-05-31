---
name: commit
description: Commit staged changes following the Conventional Commits specification
disable-model-invocation: true
allowed-tools: Bash(git *)
---

# Commit Staged Changes

Commit staged changes following the Conventional Commits specification.

## Instructions

1. Run `git diff --cached` to see what is staged.
2. If nothing is staged, tell the user and stop.
3. Determine the commit type from the changes:
   - **feat** — a new feature
   - **fix** — a bug fix
   - **docs** — documentation only
   - **style** — formatting / whitespace, no behaviour change
   - **refactor** — neither fixes a bug nor adds a feature
   - **perf** — a performance improvement
   - **test** — adding or correcting tests
   - **build** — build system or dependencies (incl. `pnpm`/Expo config)
   - **ci** — CI configuration
   - **chore** — anything that doesn't modify src or test files

4. Format: `type(optional scope): description`, with an optional body.
5. The description: imperative mood ("add" not "added"), no capital first letter, no trailing period, under 72 characters. Add a body only when the change is complex enough to need explanation.
6. Breaking changes: add `!` after the type/scope (`feat!:` or `feat(scope)!:`).
7. **Do NOT add AI attribution, Claude Code references, or co-author tags.** The message should read as normal human-written.
8. Commit with:

```bash
git commit -m "$(cat <<'EOF'
<your commit message here>
EOF
)"
```

9. Run `git status` to confirm the commit succeeded.
