ALTER TABLE prospection_notes ADD COLUMN IF NOT EXISTS siren VARCHAR(20);
CREATE INDEX IF NOT EXISTS idx_prospection_notes_siren ON prospection_notes(siren);
