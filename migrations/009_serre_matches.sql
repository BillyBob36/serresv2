CREATE TABLE IF NOT EXISTS serre_matches (
  id SERIAL PRIMARY KEY,
  serre_id INTEGER NOT NULL REFERENCES serres(id) ON DELETE CASCADE,
  rang SMALLINT NOT NULL CHECK (rang BETWEEN 1 AND 3),
  siren TEXT NOT NULL,
  siret TEXT,
  nom_entreprise TEXT,
  dirigeant_nom TEXT,
  dirigeant_prenom TEXT,
  commune_entreprise TEXT,
  distance_km NUMERIC(6,2),
  confiance TEXT,
  UNIQUE (serre_id, rang)
);

CREATE INDEX IF NOT EXISTS idx_serre_matches_serre_id ON serre_matches(serre_id);
