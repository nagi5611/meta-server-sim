-- Cloudflare D1 metaverse-sim: lobby admin flags (run via wrangler d1 execute)
ALTER TABLE students ADD COLUMN banned INTEGER DEFAULT 0;
ALTER TABLE students ADD COLUMN lobby_role TEXT DEFAULT 'user';
ALTER TABLE students ADD COLUMN email TEXT DEFAULT '';
ALTER TABLE teachers ADD COLUMN banned INTEGER DEFAULT 0;
ALTER TABLE teachers ADD COLUMN lobby_role TEXT DEFAULT 'admin';
ALTER TABLE teachers ADD COLUMN email TEXT DEFAULT '';