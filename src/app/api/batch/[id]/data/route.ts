import { NextRequest, NextResponse } from "next/server";
import sql from "@/lib/db";

// Force dynamic — never cache this route
export const dynamic = "force-dynamic";

// GET: get merged enrichment data for a batch, keyed by siren
// Used by the tableau in "BDD stockée" mode
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const batchId = parseInt(id, 10);
  if (!batchId) return NextResponse.json({ error: "ID invalide" }, { status: 400 });

  const url = new URL(request.url);
  const sirensParam = url.searchParams.get("sirens");

  // If specific sirens requested (for a page of the tableau)
  let sirenFilter = "";
  let sirens: string[] = [];
  if (sirensParam) {
    sirens = sirensParam.split(",").filter(Boolean);
    if (sirens.length === 0) return NextResponse.json({ data: {} });
  }

  // Fetch data from each API table for this batch
  const gouvRows = sirens.length > 0
    ? await sql`SELECT * FROM data_api_gouv WHERE batch_id = ${batchId} AND siren = ANY(${sirens})`
    : await sql`SELECT * FROM data_api_gouv WHERE batch_id = ${batchId}`;

  const inseeRows = sirens.length > 0
    ? await sql`SELECT * FROM data_insee WHERE batch_id = ${batchId} AND siren = ANY(${sirens})`
    : await sql`SELECT * FROM data_insee WHERE batch_id = ${batchId}`;

  const googleRows = sirens.length > 0
    ? await sql`SELECT * FROM data_google_places WHERE batch_id = ${batchId} AND siren = ANY(${sirens})`
    : await sql`SELECT * FROM data_google_places WHERE batch_id = ${batchId}`;

  const bodaccRows = sirens.length > 0
    ? await sql`SELECT * FROM data_bodacc WHERE batch_id = ${batchId} AND siren = ANY(${sirens})`
    : await sql`SELECT * FROM data_bodacc WHERE batch_id = ${batchId}`;

  const pjRows = sirens.length > 0
    ? await sql`SELECT * FROM data_pages_jaunes WHERE batch_id = ${batchId} AND siren = ANY(${sirens})`
    : await sql`SELECT * FROM data_pages_jaunes WHERE batch_id = ${batchId}`;

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

  // Collect all unique sirens
  const allSirens = new Set<string>();
  for (const m of [gouvMap, inseeMap, googleMap, bodaccMap, pjMap]) {
    for (const k of m.keys()) allSirens.add(k);
  }

  // Merge into a single object per siren (compatible with existing enrichissement_entreprise format)
  const data: Record<string, any> = {};
  for (const siren of allSirens) {
    const gouv = gouvMap.get(siren) || {};
    const insee = inseeMap.get(siren) || {};
    const google = googleMap.get(siren) || {};
    const bodacc = bodaccMap.get(siren) || {};
    const pj = pjMap.get(siren) || {};

    // --- CASCADES: chaque champ prend la meilleure source disponible ---
    // Priorité générale: PJ > Google > API Gouv > INSEE > BODACC
    // (PJ et Google ont les données de contact les plus fraîches)

    // Telephone: PJ (souvent multiple) > Google > rien
    const pjPhone = Array.isArray(pj.telephone) ? pj.telephone[0] : pj.telephone;
    const bestTelephone = pjPhone || google.telephone || null;

    // Email: Google (extrait du site web) > PJ > rien
    const bestEmail = google.email || pj.email || null;

    // Site web: Google > PJ > rien
    const bestSiteWeb = google.site_web || pj.site_web || null;

    // Horaires: Google (structurés) > PJ > rien
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

    // enrichi_at: date la plus récente parmi toutes les sources
    const dates = [gouv.enrichi_at, insee.enrichi_at, google.enrichi_at, bodacc.enrichi_at, pj.enrichi_at]
      .filter(Boolean)
      .map((d: string) => new Date(d).getTime());
    const enrichiAt = dates.length > 0 ? new Date(Math.max(...dates)).toISOString() : null;

    data[siren] = {
      siren,
      // --- Identité (API Gouv principal, PJ fallback) ---
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
      // --- Google Places spécifique ---
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
      // --- Pages Jaunes (données complémentaires) ---
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
      // --- Méta ---
      enrichi_at: enrichiAt,
      source: [
        gouv.id ? "gouv" : null,
        insee.id ? "insee" : null,
        google.id ? "google" : null,
        bodacc.id ? "bodacc" : null,
        pj.id ? "pj" : null,
      ].filter(Boolean).join("+"),
      batch_id: batchId,
    };
  }

  return NextResponse.json({ data });
}
