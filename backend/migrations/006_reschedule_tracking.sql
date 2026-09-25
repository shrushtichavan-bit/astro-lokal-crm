-- 006_reschedule_tracking.sql
--
-- reschedule_history is an array of entries shaped like:
--   { "count": 1, "rescheduled_to": "2026-09-20T17:00:00Z",
--     "rescheduled_by": "saili.jadhav@astrolokal.com", "logged_at": "2026-09-18T10:00:00Z" }

ALTER TABLE interview_rounds ADD COLUMN IF NOT EXISTS reschedule_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE interview_rounds ADD COLUMN IF NOT EXISTS reschedule_history JSONB DEFAULT '[]';
