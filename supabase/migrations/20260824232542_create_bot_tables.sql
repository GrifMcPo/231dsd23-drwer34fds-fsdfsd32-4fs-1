/*
# Create Telegram Bot Tables

1. New Tables
- `bot_logs` — логи команд, которые пользователи писали боту
- `bot_bans` — баны пользователей
- `bot_users` — пользователи, которые писали боту (для idlist)
- `bot_keys` — ключи доступа к админ-сайту
- `bot_settings` — настройки бота (тех-работы и т.д.)
2. Security
- Enable RLS on all tables.
- Allow anon + authenticated CRUD because the site reads/writes via anon key.
*/

CREATE TABLE IF NOT EXISTS bot_logs (
  id serial PRIMARY KEY,
  user_id bigint NOT NULL,
  username text,
  command text NOT NULL,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS bot_bans (
  id serial PRIMARY KEY,
  user_id bigint NOT NULL UNIQUE,
  reason text NOT NULL,
  ban_duration text NOT NULL,
  banned_at timestamptz DEFAULT now(),
  unban_at timestamptz NOT NULL,
  active boolean DEFAULT true
);

CREATE TABLE IF NOT EXISTS bot_users (
  id serial PRIMARY KEY,
  user_id bigint NOT NULL UNIQUE,
  username text,
  first_name text,
  last_seen timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS bot_keys (
  id serial PRIMARY KEY,
  key text NOT NULL UNIQUE,
  created_at timestamptz DEFAULT now(),
  expires_at timestamptz NOT NULL,
  active boolean DEFAULT true
);

CREATE TABLE IF NOT EXISTS bot_settings (
  id int PRIMARY KEY DEFAULT 1,
  tech_works boolean DEFAULT false,
  tech_works_until timestamptz,
  updated_at timestamptz DEFAULT now()
);

INSERT INTO bot_settings (id) VALUES (1) ON CONFLICT DO NOTHING;

ALTER TABLE bot_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE bot_bans ENABLE ROW LEVEL SECURITY;
ALTER TABLE bot_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE bot_keys ENABLE ROW LEVEL SECURITY;
ALTER TABLE bot_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anon_crud_bot_logs" ON bot_logs;
CREATE POLICY "anon_crud_bot_logs" ON bot_logs FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "anon_insert_bot_logs" ON bot_logs FOR INSERT TO anon, authenticated WITH CHECK (true);
CREATE POLICY "anon_update_bot_logs" ON bot_logs FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
CREATE POLICY "anon_delete_bot_logs" ON bot_logs FOR DELETE TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "anon_crud_bot_bans" ON bot_bans;
CREATE POLICY "anon_crud_bot_bans" ON bot_bans FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "anon_insert_bot_bans" ON bot_bans FOR INSERT TO anon, authenticated WITH CHECK (true);
CREATE POLICY "anon_update_bot_bans" ON bot_bans FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
CREATE POLICY "anon_delete_bot_bans" ON bot_bans FOR DELETE TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "anon_crud_bot_users" ON bot_users;
CREATE POLICY "anon_crud_bot_users" ON bot_users FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "anon_insert_bot_users" ON bot_users FOR INSERT TO anon, authenticated WITH CHECK (true);
CREATE POLICY "anon_update_bot_users" ON bot_users FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
CREATE POLICY "anon_delete_bot_users" ON bot_users FOR DELETE TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "anon_crud_bot_keys" ON bot_keys;
CREATE POLICY "anon_crud_bot_keys" ON bot_keys FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "anon_insert_bot_keys" ON bot_keys FOR INSERT TO anon, authenticated WITH CHECK (true);
CREATE POLICY "anon_update_bot_keys" ON bot_keys FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
CREATE POLICY "anon_delete_bot_keys" ON bot_keys FOR DELETE TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "anon_crud_bot_settings" ON bot_settings;
CREATE POLICY "anon_crud_bot_settings" ON bot_settings FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "anon_insert_bot_settings" ON bot_settings FOR INSERT TO anon, authenticated WITH CHECK (true);
CREATE POLICY "anon_update_bot_settings" ON bot_settings FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
CREATE POLICY "anon_delete_bot_settings" ON bot_settings FOR DELETE TO anon, authenticated USING (true);

CREATE INDEX IF NOT EXISTS idx_bot_logs_user_id ON bot_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_bot_logs_created_at ON bot_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_bot_bans_user_id ON bot_bans(user_id);
CREATE INDEX IF NOT EXISTS idx_bot_bans_active ON bot_bans(active);
CREATE INDEX IF NOT EXISTS idx_bot_keys_key ON bot_keys(key);
