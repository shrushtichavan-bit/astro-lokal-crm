-- Change 4: expand outcome values on call_attempts and calling_status

ALTER TABLE call_attempts
  DROP CONSTRAINT IF EXISTS call_attempts_outcome_check;
ALTER TABLE call_attempts
  ADD CONSTRAINT call_attempts_outcome_check
  CHECK (outcome IN ('connected','rnr','reconnect','junk','not_interested','failed','dropped_off'));

ALTER TABLE calling_status
  DROP CONSTRAINT IF EXISTS calling_status_status_check;
ALTER TABLE calling_status
  ADD CONSTRAINT calling_status_status_check
  CHECK (status IN ('connected','junk','not_interested','reconnect','rnr','failed','dropped_off'));

-- Change 8: per-attempt remarks storage
ALTER TABLE call_attempts ADD COLUMN IF NOT EXISTS remarks TEXT;
