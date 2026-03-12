-- Migration 006 : Ajout de created_at sur entreprises_agri (manquant)
ALTER TABLE entreprises_agri
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW();
