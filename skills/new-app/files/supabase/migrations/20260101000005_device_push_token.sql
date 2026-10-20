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
