-- Minimal schema covering every table the worklist + pipeline-health queries
-- touch. Used to exercise those queries against a real Postgres in an isolated
-- schema (see verify-worklist.ts) rather than trusting that hand-written SQL
-- is correct because TypeScript compiled.
--
-- Doubles as the reference for bringing a stale local dev database up to date.

CREATE TABLE profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL, email text NOT NULL UNIQUE, password text NOT NULL,
  avatar text, role text NOT NULL DEFAULT 'member',
  title text, phone text, signature text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now());

CREATE TABLE clients (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL, company text NOT NULL, email text, phone text,
  status text NOT NULL DEFAULT 'prospect', industry text,
  total_revenue numeric(12,2) NOT NULL DEFAULT 0, notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now());

CREATE TABLE projects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  client_id uuid REFERENCES clients(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now());

CREATE TABLE tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL, description text,
  assignee_id uuid REFERENCES profiles(id) ON DELETE SET NULL,
  priority text NOT NULL DEFAULT 'medium',
  status text NOT NULL DEFAULT 'backlog',
  due_date date, completed_at timestamptz,
  project_id uuid REFERENCES projects(id) ON DELETE SET NULL,
  client_id uuid REFERENCES clients(id) ON DELETE SET NULL,
  created_by uuid REFERENCES profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now());

CREATE TABLE subtasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id uuid NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  title text NOT NULL, done boolean NOT NULL DEFAULT false,
  position integer NOT NULL DEFAULT 0);

CREATE TABLE leads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL, company text NOT NULL, email text, phone text,
  source text, category text,
  deal_value numeric(12,2) NOT NULL DEFAULT 0,
  stage text NOT NULL DEFAULT 'new_lead',
  assignee_id uuid REFERENCES profiles(id) ON DELETE SET NULL,
  last_activity date, notes text,
  domain text, email_status text, icp_score integer,
  tech_fingerprint jsonb, review_stats jsonb,
  complaint_tags text[], signals jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now());

CREATE TABLE lead_activities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id uuid NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  type text NOT NULL, description text NOT NULL,
  date date NOT NULL DEFAULT CURRENT_DATE,
  created_by uuid REFERENCES profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now());

CREATE TABLE events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id uuid REFERENCES leads(id) ON DELETE SET NULL,
  type text NOT NULL, payload jsonb, source text,
  created_at timestamptz NOT NULL DEFAULT now());

CREATE TABLE audits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id uuid REFERENCES leads(id) ON DELETE SET NULL,
  slug text NOT NULL UNIQUE, score integer,
  issues jsonb, quick_wins jsonb, pdf_url text, page_url text,
  views integer NOT NULL DEFAULT 0,
  hot_fired boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now());

CREATE TABLE outreach_sequences (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL, description text, category text,
  is_active boolean NOT NULL DEFAULT true,
  auto_enroll_on_category boolean NOT NULL DEFAULT false,
  auto_enroll_all boolean NOT NULL DEFAULT false,
  created_by uuid REFERENCES profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now());

CREATE TABLE outreach_steps (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sequence_id uuid NOT NULL REFERENCES outreach_sequences(id) ON DELETE CASCADE,
  position integer NOT NULL, day_offset integer NOT NULL,
  channel text NOT NULL DEFAULT 'email',
  subject_template text, body_template text, agent_id text,
  created_at timestamptz NOT NULL DEFAULT now());

CREATE TABLE outreach_enrollments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id uuid NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  sequence_id uuid NOT NULL REFERENCES outreach_sequences(id) ON DELETE CASCADE,
  current_step integer NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'active',
  enrolled_at timestamptz NOT NULL DEFAULT now(),
  next_send_at timestamptz, last_step_completed_at timestamptz,
  completed_at timestamptz, paused_reason text,
  enrolled_by uuid REFERENCES profiles(id) ON DELETE SET NULL);

CREATE TABLE outreach_sends (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  enrollment_id uuid NOT NULL REFERENCES outreach_enrollments(id) ON DELETE CASCADE,
  step_id uuid REFERENCES outreach_steps(id) ON DELETE SET NULL,
  channel text NOT NULL DEFAULT 'email',
  subject text, body text,
  sent_at timestamptz NOT NULL DEFAULT now(),
  status text NOT NULL DEFAULT 'sent',
  message_id text, error text);
