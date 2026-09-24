-- 005_notes_drop_reasons_form_responses.sql

ALTER TABLE expert_profiles ADD COLUMN IF NOT EXISTS notes TEXT;
ALTER TABLE expert_profiles ADD COLUMN IF NOT EXISTS drop_reason TEXT;
ALTER TABLE interview_rounds ADD COLUMN IF NOT EXISTS drop_reason TEXT;

CREATE TABLE IF NOT EXISTS form_responses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id UUID NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  response JSONB NOT NULL,
  submitted_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_form_responses_lead ON form_responses(lead_id);
CREATE INDEX IF NOT EXISTS idx_form_responses_submitted_at ON form_responses(submitted_at);
