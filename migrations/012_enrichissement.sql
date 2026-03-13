CREATE TABLE IF NOT EXISTS enrichissement_entreprise (
  id SERIAL PRIMARY KEY,
  siren TEXT NOT NULL,
  -- Pappers
  forme_juridique TEXT,
  date_creation TEXT,
  tranche_effectifs TEXT,
  chiffre_affaires BIGINT,
  resultat_net BIGINT,
  adresse_siege TEXT,
  code_naf TEXT,
  libelle_naf TEXT,
  dirigeants JSONB,
  -- Google Places
  telephone TEXT,
  site_web TEXT,
  email TEXT,
  note_google NUMERIC(2,1),
  horaires TEXT,
  avis_count INTEGER,
  google_place_id TEXT,
  -- Meta
  enrichi_par INTEGER REFERENCES users(id),
  enrichi_at TIMESTAMPTZ DEFAULT NOW(),
  source TEXT,
  UNIQUE(siren)
);

CREATE INDEX IF NOT EXISTS idx_enrichissement_siren ON enrichissement_entreprise(siren);
