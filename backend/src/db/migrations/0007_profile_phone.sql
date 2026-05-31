-- Phone shown in email signature (and reusable for WhatsApp links later)
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS phone text;
