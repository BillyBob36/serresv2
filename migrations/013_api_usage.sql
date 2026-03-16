-- Suivi de consommation des API payantes (Google Places, Pappers)
-- Les compteurs sont par mois pour correspondre aux quotas gratuits mensuels.

CREATE TABLE IF NOT EXISTS api_usage (
  id SERIAL PRIMARY KEY,
  api_name TEXT NOT NULL,          -- 'google_places' ou 'pappers'
  mois TEXT NOT NULL,              -- format 'YYYY-MM' ex: '2026-03'
  appels INTEGER NOT NULL DEFAULT 0,
  limite_mensuelle INTEGER NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(api_name, mois)
);

-- Limites par defaut : Google Places Text Search = 5000/mois (tier gratuit Pro)
-- Pappers = selon abonnement (200 par defaut, ajustable)
INSERT INTO api_usage (api_name, mois, appels, limite_mensuelle)
VALUES
  ('google_places', TO_CHAR(NOW(), 'YYYY-MM'), 0, 4800),
  ('pappers', TO_CHAR(NOW(), 'YYYY-MM'), 0, 200)
ON CONFLICT (api_name, mois) DO NOTHING;
