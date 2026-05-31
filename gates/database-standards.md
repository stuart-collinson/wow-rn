# Database Standards

Rules for the Supabase Postgres schema, migrations, and RLS policies. Code-side query patterns live in `backend-patterns`; this gate is about **DDL** — schema, migrations, policies, indexes.

## Migrations

The schema lives **in code** as SQL migration files under `supabase/migrations/` at the repo root, one file per change, named `YYYYMMDDhhmmss_<description>.sql`. They are managed with the Supabase CLI and applied to the hosted project with `supabase db push` — the dashboard SQL editor is for inspection and one-off debugging, never for schema changes that aren't captured as a migration.

- **Append-only.** Once a migration is merged, never edit it. If it was wrong, write a new migration that corrects it.
- **One logical change per migration.** Adding a table, adding a column, changing a constraint — each is its own file.
- **Every migration is idempotent. No exceptions.** We do not write down-migrations, and Supabase is not rolled back when someone locally reverts a commit. A migration that ran against a branch, was reverted in git, and is re-applied must succeed on a database where its effects already exist. Use the patterns below — `CREATE … IF NOT EXISTS`, `DROP … IF EXISTS`, `CREATE OR REPLACE`, `ON CONFLICT DO NOTHING`, and `DO` blocks for objects without native `IF [NOT] EXISTS` support. The migration runner should never need a manual recovery step.
- **Test it twice.** `supabase db reset` rebuilds the local database from every migration in order — run it after writing one to confirm the whole chain applies cleanly. Then apply the new migration a **second** time against an already-migrated database; the second run must be a no-op, not an error. That's the idempotency check.
- **RLS policies are part of the schema** — a new table's migration enables RLS and defines its policies in the same file.

### Workflow — Supabase CLI

All commands run from the **repo root** (where the `supabase/` directory lives). Wrap the common ones as root `package.json` scripts so they're one `pnpm` command.

```bash
# One-time, per machine / per environment
supabase login                                  # auth the CLI
supabase link --project-ref <project-ref>       # connect this repo to the hosted project

# The change loop
supabase migration new <description>            # creates supabase/migrations/<timestamp>_<description>.sql
#   → write the idempotent SQL (see patterns below)
supabase db reset                               # rebuild local DB from all migrations — proves the chain applies
supabase db push                                # apply pending migrations to the LINKED hosted project

# After any schema change — regenerate types so the app/API stay in sync
supabase gen types typescript --linked --schema public > packages/shared/src/database.types.ts
```

- **`supabase db push` only applies what's new** — migrations the remote has already recorded are skipped. This is why idempotency is about *re-applying the same file*, not about push running it twice.
- **`supabase db diff`** can generate a migration from changes made against the local DB, but the output still has to be reviewed and made idempotent — it is a starting point, not a finished migration.
- **One project ref per environment.** Re-`link` to switch between a dev/staging project and production; never point `db push` at production casually. Treat a production push like a deploy.
- **Generated types are committed.** `database.types.ts` is the typed view of the schema the repositories build their domain types from — regenerate and commit it in the same change as the migration so the types never lag the schema.

```sql
-- PASS — small additive change, RLS in the same migration
CREATE TABLE IF NOT EXISTS workout (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name        text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE workout ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "users manage own workouts" ON workout;
CREATE POLICY "users manage own workouts"
  ON workout FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
```

### Idempotency patterns

Postgres covers most DDL with `IF [NOT] EXISTS`; the gaps need a small amount of guarding. Use these forms as the default — never the unguarded version "because the migration only runs once". It will run twice eventually.

| Object | Idempotent form |
|---|---|
| Table | `CREATE TABLE IF NOT EXISTS …` |
| Column | `ALTER TABLE t ADD COLUMN IF NOT EXISTS c …` / `DROP COLUMN IF EXISTS c` |
| Index | `CREATE INDEX IF NOT EXISTS …` / `DROP INDEX IF EXISTS …` |
| View / function / trigger fn | `CREATE OR REPLACE VIEW` / `CREATE OR REPLACE FUNCTION` |
| Trigger | `DROP TRIGGER IF EXISTS … ON t;` then `CREATE TRIGGER …` |
| Policy | `DROP POLICY IF EXISTS "name" ON t;` then `CREATE POLICY "name" …` |
| Enum value | `ALTER TYPE e ADD VALUE IF NOT EXISTS 'x'` |
| Extension | `CREATE EXTENSION IF NOT EXISTS …` |
| Data backfill | `UPDATE … WHERE <target still unset>` / `INSERT … ON CONFLICT DO NOTHING` |

For objects without native `IF NOT EXISTS` support — most notably **named constraints** — guard with a `DO` block that checks the system catalog:

```sql
-- PASS — named CHECK constraint, idempotent
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'workout_status_check' AND conrelid = 'public.workout'::regclass
  ) THEN
    ALTER TABLE workout ADD CONSTRAINT workout_status_check
      CHECK (status IN ('draft', 'active', 'archived'));
  END IF;
END $$;
```

Backfills are idempotent when the predicate excludes already-migrated rows. The additive-NOT-NULL pattern (add nullable → backfill → set NOT NULL) is safe to re-run when each step is guarded: `ADD COLUMN IF NOT EXISTS`, backfill `WHERE col IS NULL`, and `SET NOT NULL` (a no-op when already set).

## Schema Conventions

### Naming

- **Table names: singular nouns** — `workout`, `user`, `workout_set`. Not `workouts`.
- **Columns: `snake_case`** — `created_at`, `user_id`, `is_active`.
- **Foreign keys: `<table>_id`** — a column referencing `workout(id)` is `workout_id`.
- **Junction tables: `<a>_<b>` alphabetical** — `tag_workout`, not `workout_tag`.
- **Constraints/indexes: suffix with the kind** — `workout_user_id_idx`, `workout_name_unique`, `workout_status_check`.

### Required fields on every table

```sql
id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
created_at  timestamptz NOT NULL DEFAULT now(),
updated_at  timestamptz NOT NULL DEFAULT now()
```

`updated_at` is maintained by a shared touch trigger that runs on update — application code never sets it. Define the trigger once in a shared migration and apply it per table.

### Types

| Use | Not |
|---|---|
| `uuid` for IDs | `serial` / `bigint` (sequential IDs leak record counts) |
| `text` for strings | `varchar(N)` (no perf difference) |
| `timestamptz` for times | `timestamp` (loses zone info) |
| `jsonb` for genuinely-variable blobs | `json`; and don't use jsonb when columns would do |
| `numeric` for money | `float` / `real` |
| `boolean` | `int` with 0/1 |

### Constraints

- **NOT NULL by default.** Allow NULL only when the value is genuinely optional in the domain.
- **CHECK constraints for enum-like columns** — `status text NOT NULL CHECK (status IN ('draft','active','archived'))`. Mirror the allowed set as a Zod enum in the matching `*.validation.ts` with a one-line comment naming the constraint, so the two don't drift.
- **Foreign keys always declare `ON DELETE`** explicitly — `CASCADE`, `SET NULL`, or `RESTRICT`. The default is `NO ACTION`; spell out the intent.
- **UNIQUE-index external idempotency keys** — when a column holds an id from another system that a handler treats as a single-row key (a webhook delivery id, a Stripe event id), enforce it with a UNIQUE index so a duplicate delivery fails loudly at INSERT instead of silently creating a second row.

## Row-Level Security (RLS)

RLS is the **primary authorisation mechanism**. Don't disable it to make a query work; write the right policy.

- **Every table containing user data has RLS enabled.** No exceptions for tables that "feel internal".
- **Service-role bypasses RLS** — use it intentionally for system jobs, never as a workaround for a missing policy.
- **Policies are per action** — separate `SELECT`, `INSERT`, `UPDATE`, `DELETE` where the rules differ. A row a user can read isn't necessarily one they can update.
- **Policy names describe the rule** in plain language — `"users can view own profile"`. The name shows up in errors and the Supabase dashboard.
- **Test under both anon and authenticated.** Anon should typically see nothing; an authenticated user should see only their own rows.

```sql
CREATE POLICY "users can view own profile"
  ON profile FOR SELECT
  USING (auth.uid() = user_id);
```

When policy logic gets complex (multi-table joins), extract it into a Postgres function and reference that from the policy.

### Views over RLS-enforced tables

A view does **not** inherit the RLS of its underlying tables by default — it runs as the view *owner*, bypassing RLS. Any view over an RLS-protected table MUST declare both `WITH (security_invoker = on)` (so it runs as the calling role) and an explicit `GRANT SELECT … TO authenticated`. Miss either and the view either leaks every user's rows or errors instead of returning an empty result.

## Indexes

Postgres does not auto-index foreign keys, and most table-level performance issues are missing indexes.

- **Index every foreign key column.**
- **Index columns used in `WHERE`, `ORDER BY`, `GROUP BY`** in hot queries.
- **Composite indexes put the most-selective column first.** A `(a, b)` index serves queries on `a` or `(a, b)`, not on `b` alone.
- **Don't pre-emptively index everything** — indexes cost write performance and storage. Add them when measurement shows the query needs them, and don't bother indexing small tables (a few thousand rows); the planner will seq-scan and be faster.

```sql
CREATE INDEX IF NOT EXISTS workout_user_id_idx ON workout(user_id);
CREATE INDEX IF NOT EXISTS workout_user_status_idx ON workout(user_id, status);
```

For `ILIKE '%term%'` substring search, use a GIN index with `gin_trgm_ops` (`CREATE EXTENSION IF NOT EXISTS pg_trgm`) and require a minimum search length of 3 — trigram indexes can't help with shorter patterns.

## Don'ts

- Don't write a non-idempotent migration "because it only runs once" — there are no down-migrations, so a revert + re-apply will fail on an unguarded `CREATE` / `ADD COLUMN` / `CREATE POLICY` / seed `INSERT`.
- Don't edit a merged migration — write a new one.
- Don't disable RLS to debug a query — use the SQL editor as a privileged role, or write a temporary policy. RLS-off in code is how data leaks.
- Don't put business logic in triggers — the application layer is the source of truth; triggers are for invariants the DB alone guarantees (`updated_at`, immutability).
- Don't store structured data as a JSON blob when columns would do — the schema is the contract.
- Don't use sequential IDs for anything user-facing — they leak record counts and make scraping easy.
