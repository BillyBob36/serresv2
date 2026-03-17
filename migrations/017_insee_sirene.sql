-- Migration 017: Add INSEE Sirene columns
ALTER TABLE enrichissement_entreprise ADD COLUMN IF NOT EXISTS insee_periodes_historique jsonb;
ALTER TABLE enrichissement_entreprise ADD COLUMN IF NOT EXISTS insee_date_dernier_traitement text;
ALTER TABLE enrichissement_entreprise ADD COLUMN IF NOT EXISTS insee_nombre_periodes integer;
