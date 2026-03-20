-- =============================================
-- Batch enrichissement : tables par API + gestion batch
-- =============================================

-- Table de gestion des batchs
CREATE TABLE IF NOT EXISTS enrichissement_batch (
  id SERIAL PRIMARY KEY,
  nom TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  created_by INTEGER REFERENCES users(id)
);

-- Statut par API dans un batch
CREATE TABLE IF NOT EXISTS enrichissement_batch_api (
  id SERIAL PRIMARY KEY,
  batch_id INTEGER REFERENCES enrichissement_batch(id) ON DELETE CASCADE,
  api_name TEXT NOT NULL,
  statut TEXT DEFAULT 'pending',
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  nb_total INTEGER DEFAULT 0,
  nb_enrichis INTEGER DEFAULT 0,
  nb_erreurs INTEGER DEFAULT 0,
  UNIQUE(batch_id, api_name)
);

-- =============================================
-- Tables de donnees par API
-- =============================================

-- API Gouv (Recherche Entreprises)
CREATE TABLE IF NOT EXISTS data_api_gouv (
  id SERIAL PRIMARY KEY,
  batch_id INTEGER REFERENCES enrichissement_batch(id) ON DELETE CASCADE,
  siren TEXT NOT NULL,
  nom_complet TEXT,
  nom_raison_sociale TEXT,
  sigle TEXT,
  etat_administratif TEXT,
  date_creation TEXT,
  date_fermeture TEXT,
  forme_juridique TEXT,
  categorie_entreprise TEXT,
  tranche_effectifs TEXT,
  annee_tranche_effectif TEXT,
  caractere_employeur BOOLEAN,
  nombre_etablissements INTEGER,
  nombre_etablissements_ouverts INTEGER,
  code_naf TEXT,
  libelle_naf TEXT,
  section_activite_principale TEXT,
  activite_principale_naf25 TEXT,
  adresse_siege TEXT,
  siret_siege TEXT,
  code_postal_siege TEXT,
  libelle_commune_siege TEXT,
  latitude_siege TEXT,
  longitude_siege TEXT,
  dirigeants JSONB,
  dirigeants_complet JSONB,
  chiffre_affaires BIGINT,
  resultat_net BIGINT,
  finances_historique JSONB,
  est_bio BOOLEAN,
  est_entrepreneur_individuel BOOLEAN,
  est_ess BOOLEAN,
  est_rge BOOLEAN,
  est_societe_mission BOOLEAN,
  convention_collective_renseignee BOOLEAN,
  liste_idcc JSONB,
  complements JSONB,
  enrichi_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(batch_id, siren)
);

-- INSEE Sirene
CREATE TABLE IF NOT EXISTS data_insee (
  id SERIAL PRIMARY KEY,
  batch_id INTEGER REFERENCES enrichissement_batch(id) ON DELETE CASCADE,
  siren TEXT NOT NULL,
  date_dernier_traitement TEXT,
  nombre_periodes INTEGER,
  activite_principale_naf25 TEXT,
  periodes_historique JSONB,
  enrichi_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(batch_id, siren)
);

-- Google Places
CREATE TABLE IF NOT EXISTS data_google_places (
  id SERIAL PRIMARY KEY,
  batch_id INTEGER REFERENCES enrichissement_batch(id) ON DELETE CASCADE,
  siren TEXT NOT NULL,
  telephone TEXT,
  site_web TEXT,
  email TEXT,
  note_google NUMERIC(2,1),
  horaires TEXT,
  avis_count INTEGER,
  google_place_id TEXT,
  google_business_status TEXT,
  google_formatted_address TEXT,
  google_maps_uri TEXT,
  google_types JSONB,
  google_primary_type TEXT,
  enrichi_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(batch_id, siren)
);

-- BODACC
CREATE TABLE IF NOT EXISTS data_bodacc (
  id SERIAL PRIMARY KEY,
  batch_id INTEGER REFERENCES enrichissement_batch(id) ON DELETE CASCADE,
  siren TEXT NOT NULL,
  procedures JSONB,
  depots_comptes JSONB,
  derniere_modification JSONB,
  enrichi_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(batch_id, siren)
);

-- Pages Jaunes (via Apify)
CREATE TABLE IF NOT EXISTS data_pages_jaunes (
  id SERIAL PRIMARY KEY,
  batch_id INTEGER REFERENCES enrichissement_batch(id) ON DELETE CASCADE,
  siren TEXT NOT NULL,
  pj_id TEXT,
  raison_social TEXT,
  description TEXT,
  adresse TEXT,
  code_postal TEXT,
  ville TEXT,
  telephone TEXT[],
  siret TEXT,
  naf TEXT,
  forme_juridique TEXT,
  date_creation TEXT,
  activite TEXT,
  multi_activite TEXT[],
  site_web TEXT,
  url_pj TEXT,
  raw_data JSONB,
  enrichi_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(batch_id, siren)
);

-- Index pour performance
CREATE INDEX IF NOT EXISTS idx_batch_api_batch ON enrichissement_batch_api(batch_id);
CREATE INDEX IF NOT EXISTS idx_data_api_gouv_batch ON data_api_gouv(batch_id, siren);
CREATE INDEX IF NOT EXISTS idx_data_insee_batch ON data_insee(batch_id, siren);
CREATE INDEX IF NOT EXISTS idx_data_google_batch ON data_google_places(batch_id, siren);
CREATE INDEX IF NOT EXISTS idx_data_bodacc_batch ON data_bodacc(batch_id, siren);
CREATE INDEX IF NOT EXISTS idx_data_pj_batch ON data_pages_jaunes(batch_id, siren);
