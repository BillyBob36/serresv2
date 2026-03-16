-- Enrichissement V2 : ajout de tous les champs gratuits API Gouv + Google Places + BODACC

-- Identité entreprise (API Gouv)
ALTER TABLE enrichissement_entreprise ADD COLUMN IF NOT EXISTS etat_administratif TEXT;
ALTER TABLE enrichissement_entreprise ADD COLUMN IF NOT EXISTS date_fermeture TEXT;
ALTER TABLE enrichissement_entreprise ADD COLUMN IF NOT EXISTS nom_complet TEXT;
ALTER TABLE enrichissement_entreprise ADD COLUMN IF NOT EXISTS nom_raison_sociale TEXT;
ALTER TABLE enrichissement_entreprise ADD COLUMN IF NOT EXISTS sigle TEXT;
ALTER TABLE enrichissement_entreprise ADD COLUMN IF NOT EXISTS siret_siege TEXT;
ALTER TABLE enrichissement_entreprise ADD COLUMN IF NOT EXISTS code_postal_siege TEXT;
ALTER TABLE enrichissement_entreprise ADD COLUMN IF NOT EXISTS libelle_commune_siege TEXT;
ALTER TABLE enrichissement_entreprise ADD COLUMN IF NOT EXISTS latitude_siege TEXT;
ALTER TABLE enrichissement_entreprise ADD COLUMN IF NOT EXISTS longitude_siege TEXT;
ALTER TABLE enrichissement_entreprise ADD COLUMN IF NOT EXISTS categorie_entreprise TEXT;
ALTER TABLE enrichissement_entreprise ADD COLUMN IF NOT EXISTS caractere_employeur BOOLEAN;
ALTER TABLE enrichissement_entreprise ADD COLUMN IF NOT EXISTS nombre_etablissements INTEGER;
ALTER TABLE enrichissement_entreprise ADD COLUMN IF NOT EXISTS nombre_etablissements_ouverts INTEGER;
ALTER TABLE enrichissement_entreprise ADD COLUMN IF NOT EXISTS section_activite_principale TEXT;
ALTER TABLE enrichissement_entreprise ADD COLUMN IF NOT EXISTS activite_principale_naf25 TEXT;
ALTER TABLE enrichissement_entreprise ADD COLUMN IF NOT EXISTS annee_tranche_effectif TEXT;

-- Complements (API Gouv)
ALTER TABLE enrichissement_entreprise ADD COLUMN IF NOT EXISTS est_bio BOOLEAN;
ALTER TABLE enrichissement_entreprise ADD COLUMN IF NOT EXISTS est_entrepreneur_individuel BOOLEAN;
ALTER TABLE enrichissement_entreprise ADD COLUMN IF NOT EXISTS est_ess BOOLEAN;
ALTER TABLE enrichissement_entreprise ADD COLUMN IF NOT EXISTS est_rge BOOLEAN;
ALTER TABLE enrichissement_entreprise ADD COLUMN IF NOT EXISTS est_societe_mission BOOLEAN;
ALTER TABLE enrichissement_entreprise ADD COLUMN IF NOT EXISTS convention_collective_renseignee BOOLEAN;
ALTER TABLE enrichissement_entreprise ADD COLUMN IF NOT EXISTS liste_idcc JSONB;
ALTER TABLE enrichissement_entreprise ADD COLUMN IF NOT EXISTS complements JSONB;

-- Dirigeants complets (API Gouv — avec nationalite, date naissance, personnes morales)
ALTER TABLE enrichissement_entreprise ADD COLUMN IF NOT EXISTS dirigeants_complet JSONB;

-- Finances historique multi-annees (API Gouv)
ALTER TABLE enrichissement_entreprise ADD COLUMN IF NOT EXISTS finances_historique JSONB;

-- Google Places champs supplementaires (inclus dans le tier Enterprise deja paye)
ALTER TABLE enrichissement_entreprise ADD COLUMN IF NOT EXISTS google_business_status TEXT;
ALTER TABLE enrichissement_entreprise ADD COLUMN IF NOT EXISTS google_formatted_address TEXT;
ALTER TABLE enrichissement_entreprise ADD COLUMN IF NOT EXISTS google_maps_uri TEXT;
ALTER TABLE enrichissement_entreprise ADD COLUMN IF NOT EXISTS google_types JSONB;
ALTER TABLE enrichissement_entreprise ADD COLUMN IF NOT EXISTS google_primary_type TEXT;

-- BODACC (gratuit, illimite)
ALTER TABLE enrichissement_entreprise ADD COLUMN IF NOT EXISTS bodacc_procedures JSONB;
ALTER TABLE enrichissement_entreprise ADD COLUMN IF NOT EXISTS bodacc_depots_comptes JSONB;
ALTER TABLE enrichissement_entreprise ADD COLUMN IF NOT EXISTS bodacc_derniere_modification JSONB;
