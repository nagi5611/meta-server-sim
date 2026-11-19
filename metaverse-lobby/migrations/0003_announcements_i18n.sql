-- Per-locale announcement text (Gemini auto-translate on admin save)
ALTER TABLE announcements ADD COLUMN source_locale TEXT NOT NULL DEFAULT 'ja';
ALTER TABLE announcements ADD COLUMN i18n_json TEXT;
