CREATE TABLE IF NOT EXISTS prospection (
  id SERIAL PRIMARY KEY,
  serre_id INTEGER NOT NULL REFERENCES serres(id) ON DELETE CASCADE,
  user_id INTEGER REFERENCES users(id),
  statut TEXT NOT NULL DEFAULT 'nouveau'
    CHECK (statut IN ('nouveau','a_contacter','appele','interesse','pas_interesse','injoignable','client')),
  match_valide TEXT DEFAULT 'incertain'
    CHECK (match_valide IN ('confirme','mauvais_match','incertain')),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(serre_id)
);

CREATE INDEX IF NOT EXISTS idx_prospection_serre_id ON prospection(serre_id);
CREATE INDEX IF NOT EXISTS idx_prospection_statut ON prospection(statut);

CREATE TABLE IF NOT EXISTS prospection_notes (
  id SERIAL PRIMARY KEY,
  serre_id INTEGER NOT NULL REFERENCES serres(id) ON DELETE CASCADE,
  user_id INTEGER REFERENCES users(id),
  note TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_prospection_notes_serre_id ON prospection_notes(serre_id);
