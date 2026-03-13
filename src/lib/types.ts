export interface SerreMatch {
  rang: number;
  siren: string;
  siret: string | null;
  nom_entreprise: string | null;
  dirigeant_nom: string | null;
  dirigeant_prenom: string | null;
  commune_entreprise: string | null;
  distance_km: number | null;
  confiance: string | null;
}

export interface Serre {
  id: number;
  id_parcel: string;
  code_cultu: string;
  code_group: string | null;
  surface_ha: number;
  surface_osm_m2: number | null;
  centroid_lat: number;
  centroid_lon: number;
  osm_centroid_lat: number | null;
  osm_centroid_lon: number | null;
  commune: string | null;
  code_postal: string | null;
  departement: string | null;
  annee_rpg: number;
  siren: string | null;
  siret: string | null;
  nom_entreprise: string | null;
  dirigeant_nom: string | null;
  dirigeant_prenom: string | null;
  adresse_entreprise: string | null;
  distance_km: number | null;
  match_confiance: string | null;
  // Données BDNB (colonnes rétractables)
  bdnb_id: string | null;
  bdnb_nature: string | null;
  bdnb_surface_m2: number | null;
  bdnb_hauteur_moy: number | null;
  bdnb_hauteur_max: number | null;
  bdnb_etat: string | null;
  bdnb_parcelle: string | null;
  bdnb_prop_siren: string | null;
  bdnb_prop_nom: string | null;
  bdnb_prop_forme: string | null;
  bdnb_adresse: string | null;
  bdnb_distance_m: number | null;
  top_matches: SerreMatch[];
}

export interface SerresFilters {
  departement?: string;
  code_cultu?: string;
  surface_min?: number;
  surface_max?: number;
  avec_entreprise?: boolean;
  search?: string;
  page?: number;
  per_page?: number;
  sort_by?: string;
  sort_order?: "asc" | "desc";
}

export interface SerresResponse {
  data: Serre[];
  total: number;
  page: number;
  per_page: number;
  total_pages: number;
}

export interface Stats {
  total_serres: number;
  total_matchees: number;
  departements: number;
  surface_totale_ha: number;
}

export const CODE_CULTU_LABELS: Record<string, string> = {
  CSS: "Culture sous serre hors sol",
  FLA: "Fleurs et aromatiques",
  PEP: "Pépinières",
};
