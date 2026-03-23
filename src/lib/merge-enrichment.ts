import sql from "@/lib/db";

/**
 * Cascade merge logic for enrichment data from all API sources.
 * Priority: PJ > Google > API Gouv > INSEE > BODACC (for contact data)
 *
 * Used by both:
 * - /api/enrichir/batch (realtime mode)
 * - /api/batch/[id]/data (stored mode)
 */

export async function fetchAndMergeEnrichment(
  sirens: string[],
  batchId?: number
): Promise<Record<string, any>> {
  if (sirens.length === 0) return {};

  // If no batchId given, find the latest batch that has data for these sirens
  let effectiveBatchId = batchId;
  if (!effectiveBatchId) {
    const latestBatch = await sql`
      SELECT DISTINCT batch_id FROM data_api_gouv
      WHERE siren = ANY(${sirens})
      ORDER BY batch_id DESC LIMIT 1
    `;
    effectiveBatchId = latestBatch.length > 0 ? latestBatch[0].batch_id : null;
  }

  // Fetch from all data tables
  let gouvRows, inseeRows, googleRows, bodaccRows, pjRows;

  if (effectiveBatchId) {
    [gouvRows, inseeRows, googleRows, bodaccRows, pjRows] = await Promise.all([
      sql`SELECT * FROM data_api_gouv WHERE batch_id = ${effectiveBatchId} AND siren = ANY(${sirens})`,
      sql`SELECT * FROM data_insee WHERE batch_id = ${effectiveBatchId} AND siren = ANY(${sirens})`,
      sql`SELECT * FROM data_google_places WHERE batch_id = ${effectiveBatchId} AND siren = ANY(${sirens})`,
      sql`SELECT * FROM data_bodacc WHERE batch_id = ${effectiveBatchId} AND siren = ANY(${sirens})`,
      sql`SELECT * FROM data_pages_jaunes WHERE batch_id = ${effectiveBatchId} AND siren = ANY(${sirens})`,
    ]);
  } else {
    // No batch found, try without batch filter (take any data available)
    [gouvRows, inseeRows, googleRows, bodaccRows, pjRows] = await Promise.all([
      sql`SELECT * FROM data_api_gouv WHERE siren = ANY(${sirens})`,
      sql`SELECT * FROM data_insee WHERE siren = ANY(${sirens})`,
      sql`SELECT * FROM data_google_places WHERE siren = ANY(${sirens})`,
      sql`SELECT * FROM data_bodacc WHERE siren = ANY(${sirens})`,
      sql`SELECT * FROM data_pages_jaunes WHERE siren = ANY(${sirens})`,
    ]);
  }

  // Build maps
  const gouvMap = new Map<string, any>();
  for (const r of gouvRows) gouvMap.set(r.siren, r);

  const inseeMap = new Map<string, any>();
  for (const r of inseeRows) inseeMap.set(r.siren, r);

  const googleMap = new Map<string, any>();
  for (const r of googleRows) googleMap.set(r.siren, r);

  const bodaccMap = new Map<string, any>();
  for (const r of bodaccRows) bodaccMap.set(r.siren, r);

  const pjMap = new Map<string, any>();
  for (const r of pjRows) pjMap.set(r.siren, r);

  // Collect all unique sirens that have data
  const allSirens = new Set<string>();
  for (const m of [gouvMap, inseeMap, googleMap, bodaccMap, pjMap]) {
    for (const k of m.keys()) allSirens.add(k);
  }

  // Merge into a single object per siren
  const data: Record<string, any> = {};
  for (const siren of allSirens) {
    data[siren] = mergeSirenData(
      siren,
      gouvMap.get(siren) || {},
      inseeMap.get(siren) || {},
      googleMap.get(siren) || {},
      bodaccMap.get(siren) || {},
      pjMap.get(siren) || {},
      effectiveBatchId
    );
  }

  return data;
}

export function mergeSirenData(
  siren: string,
  gouv: any,
  insee: any,
  google: any,
  bodacc: any,
  pj: any,
  batchId?: number | null
): any {
  // --- CASCADES: chaque champ prend la meilleure source disponible ---

  // Telephone: PJ (souvent multiple) > Google > rien
  const pjPhone = Array.isArray(pj.telephone) ? pj.telephone[0] : pj.telephone;
  const bestTelephone = pjPhone || google.telephone || null;

  // Email: Google (extrait du site web) > PJ > rien
  const bestEmail = google.email || pj.email || null;

  // Site web: Google > PJ > rien
  const bestSiteWeb = google.site_web || pj.site_web || null;

  // Horaires: Google (structures) > PJ > rien
  const bestHoraires = google.horaires || pj.horaires || null;

  // Note/Avis: Google prioritaire (plus fiable), PJ en fallback
  const bestNote = google.note_google || pj.note_pj || null;
  const bestAvisCount = google.avis_count || pj.nb_avis || null;
  const noteSource = google.note_google ? "google" : pj.note_pj ? "pj" : null;

  // Adresse: API Gouv (officielle) > Google > PJ > rien
  const bestAdresse = gouv.adresse_siege || google.google_formatted_address || pj.adresse || null;

  // SIRET: API Gouv > PJ > rien
  const bestSiret = gouv.siret_siege || pj.siret || null;

  // Forme juridique: API Gouv (officielle) > PJ > rien
  const bestFormeJuridique = gouv.forme_juridique || pj.forme_juridique || null;

  // Date creation: API Gouv > PJ > rien
  const bestDateCreation = gouv.date_creation || pj.date_creation || null;

  // Code postal / ville: API Gouv > PJ > rien
  const bestCodePostal = gouv.code_postal_siege || pj.code_postal || null;
  const bestVille = gouv.libelle_commune_siege || pj.ville || null;

  // enrichi_at: date la plus recente parmi toutes les sources
  const dates = [gouv.enrichi_at, insee.enrichi_at, google.enrichi_at, bodacc.enrichi_at, pj.enrichi_at]
    .filter(Boolean)
    .map((d: string) => new Date(d).getTime());
  const enrichiAt = dates.length > 0 ? new Date(Math.max(...dates)).toISOString() : null;

  return {
    siren,
    // --- Identite (API Gouv principal, PJ fallback) ---
    nom_complet: gouv.nom_complet || pj.raison_social || null,
    nom_raison_sociale: gouv.nom_raison_sociale || null,
    sigle: gouv.sigle || null,
    etat_administratif: gouv.etat_administratif || null,
    date_creation: bestDateCreation,
    date_fermeture: gouv.date_fermeture || null,
    forme_juridique: bestFormeJuridique,
    categorie_entreprise: gouv.categorie_entreprise || null,
    tranche_effectifs: gouv.tranche_effectifs || null,
    annee_tranche_effectif: gouv.annee_tranche_effectif || null,
    caractere_employeur: gouv.caractere_employeur || false,
    nombre_etablissements: gouv.nombre_etablissements || null,
    nombre_etablissements_ouverts: gouv.nombre_etablissements_ouverts || null,
    code_naf: gouv.code_naf || pj.naf || null,
    libelle_naf: gouv.libelle_naf || null,
    section_activite_principale: gouv.section_activite_principale || null,
    activite_principale_naf25: gouv.activite_principale_naf25 || insee.activite_principale_naf25 || null,
    adresse_siege: bestAdresse,
    siret_siege: bestSiret,
    code_postal_siege: bestCodePostal,
    libelle_commune_siege: bestVille,
    latitude_siege: gouv.latitude_siege || null,
    longitude_siege: gouv.longitude_siege || null,
    dirigeants: gouv.dirigeants || null,
    dirigeants_complet: gouv.dirigeants_complet || null,
    chiffre_affaires: gouv.chiffre_affaires || null,
    resultat_net: gouv.resultat_net || null,
    finances_historique: gouv.finances_historique || null,
    est_bio: gouv.est_bio || false,
    est_entrepreneur_individuel: gouv.est_entrepreneur_individuel || false,
    est_ess: gouv.est_ess || false,
    est_rge: gouv.est_rge || false,
    est_societe_mission: gouv.est_societe_mission || false,
    convention_collective_renseignee: gouv.convention_collective_renseignee || false,
    liste_idcc: gouv.liste_idcc || null,
    complements: gouv.complements || null,
    // --- INSEE ---
    insee_periodes_historique: insee.periodes_historique || null,
    insee_date_dernier_traitement: insee.date_dernier_traitement || null,
    insee_nombre_periodes: insee.nombre_periodes || null,
    // --- Contact (cascade PJ > Google > API Gouv) ---
    telephone: bestTelephone,
    site_web: bestSiteWeb,
    email: bestEmail,
    horaires: bestHoraires,
    note_google: bestNote,
    note_source: noteSource,
    avis_count: bestAvisCount,
    // --- Google Places specifique ---
    google_place_id: google.google_place_id || null,
    google_business_status: google.google_business_status || null,
    google_formatted_address: google.google_formatted_address || null,
    google_maps_uri: google.google_maps_uri || null,
    google_types: google.google_types || null,
    google_primary_type: google.google_primary_type || null,
    // --- BODACC ---
    bodacc_procedures: bodacc.procedures || null,
    bodacc_depots_comptes: bodacc.depots_comptes || null,
    bodacc_derniere_modification: bodacc.derniere_modification || null,
    // --- Pages Jaunes (donnees complementaires) ---
    pj_telephone: pj.telephone || null,
    pj_site_web: pj.site_web || null,
    pj_adresse: pj.adresse || null,
    pj_activite: pj.activite || null,
    pj_multi_activite: pj.multi_activite || null,
    pj_description: pj.description || null,
    pj_url: pj.url_pj || null,
    pj_raison_social: pj.raison_social || null,
    pj_note: pj.note_pj || null,
    pj_nb_avis: pj.nb_avis || null,
    pj_match_confidence: pj.match_confidence || null,
    pj_source_personne: pj.source_personne || null,
    // --- Meta ---
    enrichi_at: enrichiAt,
    source: [
      gouv.id ? "gouv" : null,
      insee.id ? "insee" : null,
      google.id ? "google" : null,
      bodacc.id ? "bodacc" : null,
      pj.id ? "pj" : null,
    ].filter(Boolean).join("+"),
    batch_id: batchId || null,
  };
}
