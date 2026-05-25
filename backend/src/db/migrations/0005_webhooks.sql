-- Webhook outbound: subscriptions + delivery log
CREATE TABLE IF NOT EXISTS webhook_subscriptions (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL,
  event       text NOT NULL,
  url         text NOT NULL,
  secret      text,
  is_active   boolean NOT NULL DEFAULT true,
  created_by  uuid REFERENCES profiles(id) ON DELETE SET NULL,
  created_at  timestamp WITH TIME ZONE NOT NULL DEFAULT NOW(),
  updated_at  timestamp WITH TIME ZONE NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_webhook_subs_event_active ON webhook_subscriptions (event, is_active);

CREATE TABLE IF NOT EXISTS webhook_deliveries (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  subscription_id uuid REFERENCES webhook_subscriptions(id) ON DELETE CASCADE,
  event           text NOT NULL,
  url             text NOT NULL,
  payload         text NOT NULL,
  status_code     integer,
  response_body   text,
  error           text,
  delivered_at    timestamp WITH TIME ZONE NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_sub ON webhook_deliveries (subscription_id, delivered_at);
