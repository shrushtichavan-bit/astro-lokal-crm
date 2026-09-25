-- 007_lead_drop_reason.sql
--
-- Why a lead was dropped at Expert Creation (not_interested / failed /
-- dropped_off). Round drops use interview_rounds.drop_reason (005); an EC
-- drop happens before any expert_profiles row exists, and expert_id is
-- NOT NULL there, so the reason lives on the lead instead.

ALTER TABLE leads ADD COLUMN IF NOT EXISTS drop_reason TEXT;
