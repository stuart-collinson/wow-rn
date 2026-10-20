# Database Standards

Rules for the Supabase Postgres schema, migrations, and RLS policies. Code-side query patterns live in `tanstack-query`; this gate is about **DDL** — schema, migrations, policies, functions, indexes — plus the skeleton every app starts with.

## Migrations

The schema lives **in code** as SQL migration files under `supabase/migrations/` at the repo root, one file per change, named `YYYYMMDDhhmmss_<description>.sql`. They are managed with the Supabase CLI and applied to the hosted project with `supabase db push` — the dashboard SQL editor is for inspection and one-off debugging, never for schema changes that aren't captured as a migration. (The dashboard **table editor** is the one sanctioned write path, and only for `app_config` values.)

- **Append-only.** Once a migration is merged, never edit it. If it was wrong, write a new migration that corrects it.
- **One logical change per migration.** Adding a table, adding a column, changing a constraint — each is its own file.
- **Every migration is idempotent. No exceptions.** We do not write down-migrations, and Supabase is not rolled back when someone locally reverts a commit. A migration that ran, was reverted in git, and is re-applied must succeed on a database where its effects already exist. Use the patterns below — `CREATE … IF NOT EXISTS`, `DROP … IF EXISTS`, `CREATE OR REPLACE`, `ON CONFLICT DO NOTHING`, and `DO` blocks for objects without native `IF [NOT] EXISTS` support.
- **Test it twice.** `supabase db reset` rebuilds the local database from every migration in order — run it after writing one to confirm the whole chain applies. Then run it a **second** time; the second run must be a no-op, not an error. That's the idempotency check, and CI runs it too.
- **RLS policies are part of the schema** — a new table's migration enables RLS and defines its policies in the same file.

### Workflow — Supabase CLI

Each app has **one hosted Supabase project** on the free plan; the **local stack (Docker)** is the development environment. There is no hosted staging project. All commands run from the **repo root**, wrapped as the `db:*` scripts in `package.json`.

```bash
# One-time, per machine
supabase login
supabase link --project-ref <project-ref>       # connect this repo to the app's hosted project

# The change loop
supabase start                                  # local stack (pnpm db:start)
supabase migration new <description>            # creates supabase/migrations/<timestamp>_<description>.sql
#   → write the idempotent SQL (see patterns below)
supabase db reset && supabase db reset          # proves the chain applies, then that it re-applies (pnpm db:reset)
supabase gen types typescript --local > src/types/database.types.ts   # pnpm db:types
supabase db push                                # apply pending migrations to the hosted project (pnpm db:push)
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

`updated_at` is maintained by the shared `set_updated_at()` trigger (skeleton below) — application code never sets it. A user-owned table also carries `user_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE`, so inserts never name the user and account deletion cascades.

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
- **CHECK constraints for enum-like columns** — `status text NOT NULL CHECK (status IN ('draft','active','archived'))`. Mirror the allowed set as a Zod enum in the matching `src/schemas/<domain>.schema.ts` with a one-line comment naming the constraint, so the two don't drift.
- **Foreign keys always declare `ON DELETE`** explicitly — `CASCADE`, `SET NULL`, or `RESTRICT`. Spell out the intent.
- **UNIQUE-index external idempotency keys** — a column holding an id from another system that a handler treats as a single-row key (a webhook event id, a push token) gets a UNIQUE constraint so a duplicate delivery fails loudly at INSERT instead of silently creating a second row.

## Row-Level Security (RLS)

RLS is the **primary authorisation mechanism** — there is no API in front of the database, so it is the only one. Don't disable it to make a query work; write the right policy.

- **Every table has RLS enabled.** No exceptions for tables that "feel internal". A table with no policies is readable by nobody, which is the safe default.
- **Policies are per action and per role** — separate `SELECT`, `INSERT`, `UPDATE`, `DELETE` where the rules differ, and name the role (`TO authenticated`, `TO anon, authenticated`). A row a user can read isn't necessarily one they can update.
- **Compare with `(SELECT auth.uid())`**, not bare `auth.uid()` — the subselect is evaluated once per query instead of once per row.
- **Policy names describe the rule** in plain language — `"users manage own workouts"`. The name shows up in errors and the dashboard.
- **The secret key bypasses RLS** — it exists only inside Edge Functions (`edge-functions`) for jobs that genuinely span users, never as a workaround for a missing policy.
- **Test under both anon and authenticated.** Anon should typically see nothing (except `app_config`); an authenticated user should see only their own rows.

When policy logic gets complex (multi-table joins), extract it into a Postgres function and reference that from the policy.

### Views over RLS-enforced tables

A view does **not** inherit the RLS of its underlying tables by default — it runs as the view *owner*, bypassing RLS. Any view over an RLS-protected table MUST declare `WITH (security_invoker = on)` and an explicit `GRANT SELECT … TO authenticated`. Miss either and the view either leaks every user's rows or errors instead of returning an empty result.

## Functions, Triggers & Jobs

- **RPC for atomic multi-table writes.** When one user action must change several tables, write a Postgres function and call it with `supabase.rpc('verb_noun', { … })` from the fetcher; the database guarantees all-or-nothing. Default to `SECURITY INVOKER` so RLS still applies inside the function.
- **`SECURITY DEFINER` only when the function must do what the caller can't** (touch `auth.users`, write a row for another user). Every such function sets `SET search_path = ''` and schema-qualifies every name, and grants `EXECUTE` to exactly the role that needs it with `REVOKE … FROM public, anon`.
- **Triggers are for invariants the database alone guarantees** — `updated_at`, the profile row that must exist for every auth user. Not for business logic; that lives in the app or an RPC.
- **Schedules and outbound calls stay in Postgres.** `pg_cron` runs cleanup and digests on a schedule; `pg_net` calls an Edge Function or webhook from SQL. Both are extensions enabled in a migration (`CREATE EXTENSION IF NOT EXISTS pg_cron`), and neither needs a server you run.

## Indexes

Postgres does not auto-index foreign keys, and most table-level performance issues are missing indexes.

- **Index every foreign key column** — including `user_id`, which every RLS policy filters on.
- **Index columns used in `WHERE`, `ORDER BY`, `GROUP BY`** in hot queries; keyset pagination (`tanstack-query`) wants `(user_id, created_at DESC)` on big tables.
- **Composite indexes put the most-selective column first.** A `(a, b)` index serves queries on `a` or `(a, b)`, not on `b` alone.
- **Don't pre-emptively index everything** — indexes cost write performance and storage; small tables (a few thousand rows) seq-scan faster anyway.

For `ILIKE '%term%'` substring search, use a GIN index with `gin_trgm_ops` (`CREATE EXTENSION IF NOT EXISTS pg_trgm`) and require a minimum search length of 3.

## The Skeleton Schema

Every app starts with these five migrations (`/new-app` copies them). They are the reference for every rule above.

```sql
-- 1) the shared touch trigger
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END $$;

-- 2) profile — one row per auth user, created by trigger, never by the app
CREATE TABLE IF NOT EXISTS profile (
  id           uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  display_name text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE profile ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "users read own profile" ON profile;
CREATE POLICY "users read own profile" ON profile FOR SELECT TO authenticated USING ((SELECT auth.uid()) = id);
DROP POLICY IF EXISTS "users update own profile" ON profile;
CREATE POLICY "users update own profile" ON profile FOR UPDATE TO authenticated
  USING ((SELECT auth.uid()) = id) WITH CHECK ((SELECT auth.uid()) = id);
DROP TRIGGER IF EXISTS profile_set_updated_at ON profile;
CREATE TRIGGER profile_set_updated_at BEFORE UPDATE ON profile FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  INSERT INTO public.profile (id, display_name)
  VALUES (NEW.id, NEW.raw_user_meta_data ->> 'full_name')
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- 3) app_config — remote switches, read by everyone, written only in the dashboard table editor
CREATE TABLE IF NOT EXISTS app_config (
  key        text PRIMARY KEY,
  value      jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE app_config ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "anyone can read app config" ON app_config;
CREATE POLICY "anyone can read app config" ON app_config FOR SELECT TO anon, authenticated USING (true);
INSERT INTO app_config (key, value)
VALUES ('ads_enabled', 'false'::jsonb), ('min_supported_version', '"1.0.0"'::jsonb)
ON CONFLICT (key) DO NOTHING;

-- 4) delete_my_account — the in-app deletion button; the cascade removes every user-owned row
CREATE OR REPLACE FUNCTION public.delete_my_account()
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = '' AS $$
  DELETE FROM auth.users WHERE id = auth.uid();
$$;
REVOKE EXECUTE ON FUNCTION public.delete_my_account() FROM public, anon;
GRANT EXECUTE ON FUNCTION public.delete_my_account() TO authenticated;

-- 5) device_push_token — one row per device, owned by its user
CREATE TABLE IF NOT EXISTS device_push_token (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  token      text NOT NULL UNIQUE,
  platform   text NOT NULL CHECK (platform IN ('ios', 'android')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE device_push_token ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "users manage own push tokens" ON device_push_token;
CREATE POLICY "users manage own push tokens" ON device_push_token FOR ALL TO authenticated
  USING ((SELECT auth.uid()) = user_id) WITH CHECK ((SELECT auth.uid()) = user_id);
CREATE INDEX IF NOT EXISTS device_push_token_user_id_idx ON device_push_token(user_id);
DROP TRIGGER IF EXISTS device_push_token_set_updated_at ON device_push_token;
CREATE TRIGGER device_push_token_set_updated_at BEFORE UPDATE ON device_push_token
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
```

## Don'ts

- Don't write a non-idempotent migration "because it only runs once" — there are no down-migrations, so a revert + re-apply will fail on an unguarded `CREATE` / `ADD COLUMN` / `CREATE POLICY` / seed `INSERT`.
- Don't edit a merged migration — write a new one.
- Don't disable RLS to debug a query — use the SQL editor as a privileged role, or write a temporary policy. RLS-off in code is how data leaks.
- Don't put business logic in triggers — `set_updated_at` and `handle_new_user` are invariants, not features.
- Don't store structured data as a JSON blob when columns would do — `app_config` is the deliberate exception, because its values are hand-edited switches.
- Don't use sequential IDs for anything user-facing — they leak record counts and make scraping easy.
