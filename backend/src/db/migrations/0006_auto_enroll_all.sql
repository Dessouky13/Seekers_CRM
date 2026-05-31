-- Sequence-level toggle: enroll EVERY new lead regardless of category.
ALTER TABLE outreach_sequences
  ADD COLUMN IF NOT EXISTS auto_enroll_all boolean NOT NULL DEFAULT false;
