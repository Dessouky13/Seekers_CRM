-- AI Agent runs: persistent log of every agent invocation + output
CREATE TABLE IF NOT EXISTS agent_runs (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id       text NOT NULL,
  scope          text NOT NULL CHECK (scope IN ('lead', 'client', 'task', 'pipeline', 'global')),
  context_id     uuid,
  context_label  text,
  input_summary  text,
  output         text NOT NULL,
  model          text NOT NULL,
  tokens_in      integer NOT NULL DEFAULT 0,
  tokens_out     integer NOT NULL DEFAULT 0,
  cost_usd       numeric(10, 5) NOT NULL DEFAULT 0,
  status         text NOT NULL DEFAULT 'success' CHECK (status IN ('success', 'error')),
  error          text,
  created_by     uuid REFERENCES profiles(id) ON DELETE SET NULL,
  created_at     timestamp WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_agent_runs_agent
  ON agent_runs (agent_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_agent_runs_context
  ON agent_runs (scope, context_id);
