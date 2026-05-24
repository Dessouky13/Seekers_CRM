-- Outreach automation: sequences, steps, enrollments, sends
CREATE TABLE IF NOT EXISTS outreach_sequences (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name                     text NOT NULL,
  description              text,
  category                 text,
  is_active                boolean NOT NULL DEFAULT true,
  auto_enroll_on_category  boolean NOT NULL DEFAULT false,
  created_by               uuid REFERENCES profiles(id) ON DELETE SET NULL,
  created_at               timestamp WITH TIME ZONE NOT NULL DEFAULT NOW(),
  updated_at               timestamp WITH TIME ZONE NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_sequences_active   ON outreach_sequences (is_active);
CREATE INDEX IF NOT EXISTS idx_sequences_category ON outreach_sequences (category);

CREATE TABLE IF NOT EXISTS outreach_steps (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sequence_id       uuid NOT NULL REFERENCES outreach_sequences(id) ON DELETE CASCADE,
  position          integer NOT NULL,
  day_offset        integer NOT NULL,
  channel           text NOT NULL DEFAULT 'email' CHECK (channel IN ('email', 'linkedin', 'note')),
  subject_template  text,
  body_template     text,
  agent_id          text,
  created_at        timestamp WITH TIME ZONE NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_steps_sequence ON outreach_steps (sequence_id, position);

CREATE TABLE IF NOT EXISTS outreach_enrollments (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id                  uuid NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  sequence_id              uuid NOT NULL REFERENCES outreach_sequences(id) ON DELETE CASCADE,
  current_step             integer NOT NULL DEFAULT 0,
  status                   text NOT NULL DEFAULT 'active'
                             CHECK (status IN ('active', 'paused', 'completed', 'failed', 'replied')),
  enrolled_at              timestamp WITH TIME ZONE NOT NULL DEFAULT NOW(),
  next_send_at             timestamp WITH TIME ZONE,
  last_step_completed_at   timestamp WITH TIME ZONE,
  completed_at             timestamp WITH TIME ZONE,
  paused_reason            text,
  enrolled_by              uuid REFERENCES profiles(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_enrollments_lead    ON outreach_enrollments (lead_id);
CREATE INDEX IF NOT EXISTS idx_enrollments_status  ON outreach_enrollments (status, next_send_at);
CREATE INDEX IF NOT EXISTS idx_enrollments_unique  ON outreach_enrollments (lead_id, sequence_id);

CREATE TABLE IF NOT EXISTS outreach_sends (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  enrollment_id  uuid NOT NULL REFERENCES outreach_enrollments(id) ON DELETE CASCADE,
  step_id        uuid REFERENCES outreach_steps(id) ON DELETE SET NULL,
  channel        text NOT NULL DEFAULT 'email',
  subject        text,
  body           text,
  sent_at        timestamp WITH TIME ZONE NOT NULL DEFAULT NOW(),
  status         text NOT NULL DEFAULT 'sent' CHECK (status IN ('sent', 'failed')),
  message_id     text,
  error          text
);
CREATE INDEX IF NOT EXISTS idx_sends_enrollment ON outreach_sends (enrollment_id, sent_at);
