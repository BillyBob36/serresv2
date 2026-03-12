-- Migration 004 : Table pour les données BDNB des serres
-- Stocke les bâtiments-serres identifiés par la BDNB (source IGN BDTopo)

CREATE TABLE IF NOT EXISTS bdnb_serres (
  batiment_groupe_id TEXT PRIMARY KEY,
  code_departement TEXT NOT NULL,
  commune TEXT,
  code_commune_insee TEXT,

  -- Géométrie (converti de Lambert93 en WGS84 par le script)
  centroid_lat DOUBLE PRECISION,
  centroid_lon DOUBLE PRECISION,
  surface_m2 DOUBLE PRECISION,

  -- BDTopo
  nature TEXT,           -- "Serre", "Serre, Industriel..."
  usage_1 TEXT,          -- "Agricole"
  usage_2 TEXT,
  etat TEXT,             -- "En service"
  hauteur_moy REAL,
  hauteur_max REAL,
  altitude_sol REAL,

  -- Parcelle cadastrale
  parcelle_id TEXT,

  -- Propriétaire (MAJIC PM, si dispo)
  proprietaire_siren TEXT,
  proprietaire_denomination TEXT,
  proprietaire_forme_juridique TEXT,

  -- Adresse BAN (si dispo)
  adresse TEXT,

  -- Lien avec nos serres RPG (rempli par le matching)
  serre_rpg_id INTEGER REFERENCES serres(id),
  distance_rpg_m DOUBLE PRECISION,

  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_bdnb_serres_dept ON bdnb_serres(code_departement);
CREATE INDEX IF NOT EXISTS idx_bdnb_serres_coords ON bdnb_serres(centroid_lat, centroid_lon);
CREATE INDEX IF NOT EXISTS idx_bdnb_serres_siren ON bdnb_serres(proprietaire_siren) WHERE proprietaire_siren IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_bdnb_serres_rpg ON bdnb_serres(serre_rpg_id) WHERE serre_rpg_id IS NOT NULL;
