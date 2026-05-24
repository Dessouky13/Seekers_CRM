-- Add per-user title + email signature fields
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS title     text;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS signature text;
