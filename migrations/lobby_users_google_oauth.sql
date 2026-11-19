-- Cloudflare D1 metaverse-sim: Google OAuth subject on lobby users (wrangler d1 execute metaverse-sim)
ALTER TABLE students ADD COLUMN google_sub TEXT DEFAULT '';
ALTER TABLE teachers ADD COLUMN google_sub TEXT DEFAULT '';

CREATE UNIQUE INDEX IF NOT EXISTS idx_students_google_sub ON students (google_sub)
    WHERE google_sub IS NOT NULL AND google_sub != '';
CREATE UNIQUE INDEX IF NOT EXISTS idx_teachers_google_sub ON teachers (google_sub)
    WHERE google_sub IS NOT NULL AND google_sub != '';