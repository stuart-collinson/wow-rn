# Database Standards

Rules for the Supabase Postgres schema, migrations, and RLS policies. Code-side query patterns live in `tanstack-query`; this gate is about **DDL** — schema, migrations, policies, functions, indexes — plus the skeleton every app starts with.

## Migrations

The schema lives **in code** as SQL migration files under `supabase/migrations/` at the repo root, one file per change, named `YYYYMMDDhhmmss_<description>.sql`. They are managed with the Supabase CLI and applied to the hosted project with `supabase db push` — the dashboard SQL editor is for inspection and one-off debugging, never for schema changes that aren't captured as a migration. The dashboard **table editor** is used for one thing: `app_config` values.

- **Append-only.** Once a migration is merged, never edit it. If it was wrong, write a new migration that corrects it.
- **One logical change per migration.** Adding a table, adding a column, changing a constraint — each is its own file.
- **Every migration is idempotent. No exceptions.** We do not write down-migrations, and Supabase is not rolled back when someone locally reverts a commit. A migration that ran, was reverted in git, and is re-applied must succeed on a database where its effects already exist. Use the patterns below — `CREATE … IF NOT EXISTS`, `DROP … IF EXISTS`, `CREATE OR REPLACE`, `ON CONFLICT DO NOTHING`, and `DO` blocks for objects without native `IF [NOT] EXISTS` support.
- **Prove it re-applies.** `supabase db reset` builds the local database from empty, so it proves the chain applies but never that it re-applies. `pnpm db:check` resets, then runs every migration this branch adds a second time on top: `supabase db reset && for f in $(git diff --name-only --diff-filter=A origin/main -- supabase/migrations); do psql postgresql://postgres:postgres@127.0.0.1:54322/postgres -v ON_ERROR_STOP=1 -f "$f" || exit 1; done`. Any error fails it; CI runs it with full git history. Only new migrations re-run, because an old one may rightly clash with what later migrations changed.
- **RLS policies are part of the schema** — a new table's migration enables RLS and defines its policies in the same file.
- **Every table migration grants access explicitly.** Supabase no longer exposes new tables to the API by default (on every project from 30 October 2026): `GRANT SELECT, INSERT, UPDATE, DELETE ON t TO authenticated` for what users touch, `GRANT SELECT ON t TO anon` only where signed-out users read (`app_config`), and `service_role` only what an Edge Function touches. The grant lets a role reach the table; RLS then decides which rows.

### Workflow — Supabase CLI

Each app has **one hosted Supabase project** on the free plan; the **local stack (Docker)** is the development environment. There is no hosted staging project. All commands run from the **repo root**, wrapped as the `db:*` scripts in `package.json`.

```bash
# One-time, per machine
supabase login
supabase link --project-ref <project-ref>       # connect this repo to the app's hosted project

# The change loop
supabase start                                  # local stack (pnpm db:start)
supabase migration new <description>            # supabase/migrations/<timestamp>_<description>.sql — write idempotent SQL
supabase db reset                               # rebuilds the local database from every migration (pnpm db:reset)
pnpm db:check                                   # reset, then re-runs this branch's new migrations — the idempotency check
supabase gen types typescript --local > src/types/database.types.ts   # pnpm db:types
supabase db push                                # pending migrations → the hosted project (pnpm db:push)
```

- **`supabase db push` only applies what's new** — migrations the remote has already recorded are skipped. Treat a push like a deploy: it goes straight to the one hosted project real users are on.
- **`supabase db diff`** can generate a migration from changes made against the local DB, but the output still has to be reviewed and made idempotent — it is a starting point, not a finished migration.
- **Generated types are committed.** `src/types/database.types.ts` is the typed view of the schema the row mappers build domain types from — regenerate and commit it in the same change as the migration so the types never lag the schema. Never edit it by hand.

```sql
-- PASS — small additive change, RLS in the same migration, user_id defaults to the caller
CREATE TABLE IF NOT EXISTS workout (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  name        text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE workout ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON workout TO authenticated;

DROP POLICY IF EXISTS "users manage own workouts" ON workout;
CREATE POLICY "users manage own workouts"
  ON workout FOR ALL TO authenticated
  USING ((SELECT auth.uid()) = user_id)
  WITH CHECK ((SELECT auth.uid()) = user_id);

CREATE INDEX IF NOT EXISTS workout_user_id_idx ON workout(user_id);

DROP TRIGGER IF EXISTS workout_set_updated_at ON workout;
CREATE TRIGGER workout_set_updated_at BEFORE UPDATE ON workout
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
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
| Data backfill / seed | `UPDATE … WHERE <target still unset>` / `INSERT … ON CONFLICT DO NOTHING` |

For objects without native `IF NOT EXISTS` support — most notably **named constraints** — guard with a `DO` block that checks the system catalog:

```sql
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

Backfills are idempotent when the predicate excludes already-migrated rows. The additive-NOT-NULL pattern (add nullable → backfill → set NOT NULL) is safe to re-run when each step is guarded.

## Schema Conventions

### Naming

- **Table names: singular nouns** — `workout`, `profile`, `workout_set`. Not `workouts`.
- **Columns: `snake_case`** — `created_at`, `user_id`, `is_active`.
- **Foreign keys: `<table>_id`** — a column referencing `workout(id)` is `workout_id`.
- **Junction tables: `<a>_<b>` alphabetical** — `tag_workout`, not `workout_tag`.
- **Constraints/indexes: suffix with the kind** — `workout_user_id_idx`, `workout_name_unique`, `workout_status_check`.
- **Functions: `verb_noun`** — `delete_my_account`, `handle_new_user`, `set_updated_at`.

### Required fields on every table

```sql
id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
created_at  timestamptz NOT NULL DEFAULT now(),
updated_at  timestamptz NOT NULL DEFAULT now()
```

`updated_at` is maintained by the shared `set_updated_at()` trigger (skeleton below) — application code never sets it. The skeleton's exceptions are deliberate: `profile.id` is the auth user's id, `app_config` is keyed by `key`, `entitlement` by `(user_id, entitlement)`. A user-owned table also carries `user_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE`, so inserts never name the user and account deletion cascades.

### Types

`uuid` ids (sequential ids leak record counts), `text` not `varchar(N)`, `timestamptz` not `timestamp`, `numeric` for money, `boolean` not 0/1, and `jsonb` only for genuinely variable blobs — columns when columns would do.

### Constraints

- **NOT NULL by default.** Allow NULL only when the value is genuinely optional in the domain.
- **CHECK constraints for enum-like columns** — `status text NOT NULL CHECK (status IN ('draft','active','archived'))`. Mirror the allowed set as a Zod enum in the matching `src/schemas/` file with a one-line comment naming the constraint, so the two don't drift.
- **Foreign keys always declare `ON DELETE`** explicitly — `CASCADE`, `SET NULL`, or `RESTRICT`. Spell out the intent.
- **UNIQUE-index external idempotency keys** — a column holding an id from another system that a handler treats as a single-row key (a webhook event id, a push token) gets a UNIQUE constraint so a duplicate delivery fails loudly at INSERT instead of silently creating a second row.

## Row-Level Security (RLS)

RLS is the **primary authorisation mechanism** — there is no API in front of the database, so it is the only one. Don't disable it to make a query work; write the right policy.

- **Every table has RLS enabled.** No exceptions for tables that "feel internal". A table with no policies is readable by nobody, which is the safe default.
- **Policies are per action and per role** — separate `SELECT`, `INSERT`, `UPDATE`, `DELETE` where the rules differ, and name the role (`TO authenticated`, `TO anon, authenticated`). A row a user can read isn't necessarily one they can update.
- **Compare with `(SELECT auth.uid())`**, not bare `auth.uid()` — the subselect is evaluated once per query instead of once per row.
- **Policy names describe the rule** in plain language — `"users manage own workouts"`. The name shows up in errors and the dashboard.
- **A user never writes what grants them something.** Plan, role, credits and the like live in their own table with a SELECT-own policy and no write policies; only a webhook or a `SECURITY DEFINER` function writes it. `FOR ALL` own-row policies are for data the user fully owns.
- **A child row checks its parent's owner.** Foreign-key checks bypass RLS, so a policy that only checks the child's `user_id` lets a user attach rows to someone else's parent. A child table's `WITH CHECK` adds `EXISTS (SELECT 1 FROM workout WHERE id = workout_id AND user_id = (SELECT auth.uid()))`.
- **The secret key bypasses RLS** — it exists only inside Edge Functions (`edge-functions`) for jobs that genuinely span users, never as a workaround for a missing policy.
- **Test under both anon and authenticated.** Anon should typically see nothing (except `app_config`); an authenticated user should see only their own rows.

When policy logic gets complex (multi-table joins), extract it into a Postgres function and reference that from the policy.

### Views over RLS-enforced tables

A view runs as its *owner* and bypasses RLS by default. Any view over an RLS-protected table MUST declare `WITH (security_invoker = on)` and an explicit `GRANT SELECT … TO authenticated`; miss either and it leaks every user's rows or errors.

## Functions, Triggers & Jobs

- **RPC for atomic multi-table writes.** One user action that changes several tables is a Postgres function called with `supabase.rpc('verb_noun', { … })` from the fetcher. Default to `SECURITY INVOKER` so RLS still applies inside it.
- **`SECURITY DEFINER` only when the function must do what the caller can't** (touch `auth.users`, write a row for another user). Every such function sets `SET search_path = ''` and schema-qualifies every name.
- **Every function starts with no callers.** Supabase grants `EXECUTE` on each new `public` function to `anon` and `authenticated`, so a migration runs `REVOKE EXECUTE … FROM public, anon, authenticated`, then grants exactly the role that needs it. A function meant only for Edge Functions is `SECURITY INVOKER` and granted to `service_role` alone; skip the revoke and any signed-in user can call it.
- **Triggers are for invariants the database alone guarantees** — `updated_at`, the profile row that must exist for every auth user. Not for business logic; that lives in the app or an RPC.
- **Schedules and outbound calls stay in Postgres.** `pg_cron` for schedules, `pg_net` to call an Edge Function or webhook from SQL — both enabled in a migration with `CREATE EXTENSION IF NOT EXISTS`.

## Indexes

Postgres does not auto-index foreign keys, and most table-level performance issues are missing indexes.

- **Index every foreign key column** — including `user_id`, which every RLS policy filters on.
- **Index columns used in `WHERE`, `ORDER BY`, `GROUP BY`** in hot queries; keyset pagination (`tanstack-query`) wants `(user_id, created_at DESC)` on big tables.
- **Composite indexes put the most-selective column first.** A `(a, b)` index serves queries on `a` or `(a, b)`, not on `b` alone.
- **Don't pre-emptively index everything** — indexes cost write performance and storage; small tables (a few thousand rows) seq-scan faster anyway.

Substring search (`ILIKE '%term%'`) wants a `pg_trgm` GIN index and a minimum search length of 3.

## The Skeleton Schema

Every app's first migrations are this skeleton, each table with the grants above. They are the worked example of every rule here, and the tables other gates rely on.

| Migration | Holds |
|---|---|
| `set_updated_at` | the shared touch trigger function (`plpgsql`, `SET search_path = ''`), applied to every table with `updated_at` |
| `profile` | one row per auth user: `id` references `auth.users` with cascade, `display_name` nullable (Apple sends a name only once); RLS read/update own; `handle_new_user()` (`SECURITY DEFINER`) inserts it from an `AFTER INSERT ON auth.users` trigger with `ON CONFLICT DO NOTHING` — the app never creates profiles |
| `app_config` | `key text PRIMARY KEY, value jsonb NOT NULL, updated_at` with the touch trigger; RLS `SELECT TO anon, authenticated USING (true)`, **no write policies**; seeds `ads_enabled = false` and `min_supported_version = "1.0.0"` with `ON CONFLICT (key) DO NOTHING` |
| `delete_my_account` | `SECURITY DEFINER` SQL function that runs `DELETE FROM auth.users WHERE id = auth.uid()`; `REVOKE EXECUTE … FROM public, anon, authenticated`, then `GRANT EXECUTE … TO authenticated`; the cascades remove every user-owned row. Storage has no cascade from `auth.users`, and Supabase blocks SQL deletes from `storage.objects`: an app with uploads removes the user's files through the Storage API before calling it (`store-and-monetisation` → Account deletion) |
| `device_push_token` *(push)* | `user_id DEFAULT auth.uid()` with cascade, `token text UNIQUE CHECK (token LIKE 'ExponentPushToken[%')`, `platform CHECK (platform IN ('ios', 'android'))`; RLS SELECT and DELETE own rows, no INSERT or UPDATE policy; index on `user_id`; touch trigger; `register_push_token(p_token, p_platform)` (`SECURITY DEFINER`, authenticated only) is the only writer — it upserts the row and moves the token to the caller, because a push token identifies the device and the last signer-in owns it |
| `entitlement` *(payments)* | `user_id` with cascade, `entitlement text`, `expires_at timestamptz` (null for lifetime), primary key `(user_id, entitlement)`; RLS SELECT own, no write policies; `sync_entitlements(p_user_id, p_entitlements jsonb)` replaces a user's rows (`SECURITY INVOKER`, `service_role` only); `has_entitlement(p_entitlement)` (`STABLE`, authenticated) is true while the caller has a row with `expires_at IS NULL OR expires_at > now()` (`store-and-monetisation`) |
