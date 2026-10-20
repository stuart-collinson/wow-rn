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

