-- Finish normalising tool names that were typed free-hand into notes.
-- Handles the spelling variants actually present in production:
--   "Voice flow" -> Voiceflow, "Open AI"/"GPT" -> OpenAI,
--   "Eleven labs" -> ElevenLabs, "google cloude" -> Google Cloud,
--   "Name cheap 1 year subscription" -> Namecheap, etc.
-- Idempotent — only touches rows with no tool linked yet.

INSERT INTO tools (name, vendor, kind) VALUES
  ('n8n',          'n8n',        'Automation'),
  ('CapCut',       'ByteDance',  'Content'),
  ('Namecheap',    'Namecheap',  'Infra'),
  ('Lovable',      'Lovable',    'AI'),
  ('ElevenLabs',   'ElevenLabs', 'AI'),
  ('Hamsa',        'Hamsa',      'AI'),
  ('Google Cloud', 'Google',     'Infra'),
  ('WhatsApp API', 'Meta',       'Messaging'),
  ('FAL',          'FAL',        'AI')
ON CONFLICT (name) DO NOTHING;

WITH patterns(pattern, tool_name) AS (VALUES
  ('voice flow%',   'Voiceflow'),
  ('voiceflow%',    'Voiceflow'),
  ('n8n%',          'n8n'),
  ('claude%',       'Claude'),
  ('capcut%',       'CapCut'),
  ('name cheap%',   'Namecheap'),
  ('namecheap%',    'Namecheap'),
  ('gpt%',          'OpenAI'),
  ('open ai%',      'OpenAI'),
  ('openai%',       'OpenAI'),
  ('lovable%',      'Lovable'),
  ('elevenlabs%',   'ElevenLabs'),
  ('eleven labs%',  'ElevenLabs'),
  ('hamsa%',        'Hamsa'),
  ('google cloud%', 'Google Cloud'),
  ('whatsapp%',     'WhatsApp API'),
  ('fal api%',      'FAL'),
  ('fal-%',         'FAL'),
  ('fal %',         'FAL')
)
UPDATE transactions t
SET tool_id = tl.id
FROM patterns p
JOIN tools tl ON tl.name = p.tool_name
WHERE t.tool_id IS NULL
  AND t.type = 'expense'
  AND t.notes IS NOT NULL
  AND lower(btrim(t.notes)) LIKE p.pattern;
