-- Prospection par couple (serre_id, siren) + nouveaux statuts

ALTER TABLE prospection ADD COLUMN IF NOT EXISTS siren TEXT;

UPDATE prospection p
SET siren = COALESCE(
  NULLIF(TRIM(s.siren), ''),
  (SELECT sm.siren FROM serre_matches sm WHERE sm.serre_id = p.serre_id ORDER BY sm.rang ASC LIMIT 1)
)
FROM serres s
WHERE p.serre_id = s.id AND (p.siren IS NULL OR p.siren = '');

UPDATE prospection SET siren = 'INCONNU' WHERE siren IS NULL OR TRIM(siren) = '';

ALTER TABLE prospection ALTER COLUMN siren SET NOT NULL;

ALTER TABLE prospection DROP CONSTRAINT IF EXISTS prospection_serre_id_key;

ALTER TABLE prospection ADD CONSTRAINT prospection_serre_siren_key UNIQUE (serre_id, siren);

CREATE INDEX IF NOT EXISTS idx_prospection_serre_siren ON prospection(serre_id, siren);

ALTER TABLE prospection DROP CONSTRAINT IF EXISTS prospection_statut_check;

ALTER TABLE prospection ADD CONSTRAINT prospection_statut_check CHECK (
  statut IN (
    'nouveau',
    'a_contacter',
    'appele',
    'interesse',
    'pas_interesse',
    'injoignable',
    'client',
    'mauvais_numero',
    'hors_cible'
  )
);
