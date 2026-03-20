import { NextRequest, NextResponse } from "next/server";
import sql from "@/lib/db";

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

    data[siren] = {
      siren,
      // API Gouv fields
      nom_complet: gouv.nom_complet || null,
      nom_raison_sociale: gouv.nom_raison_sociale || null,
      sigle: gouv.sigle || null,
      etat_administratif: gouv.etat_administratif || null,
      date_creation: gouv.date_creation || null,
      date_fermeture: gouv.date_fermeture || null,
      forme_juridique: gouv.forme_juridique || null,
      categorie_entreprise: gouv.categorie_entreprise || null,
      tranche_effectifs: gouv.tranche_effectifs || null,
      annee_tranche_effectif: gouv.annee_tranche_effectif || null,
      caractere_employeur: gouv.caractere_employeur || false,
      nombre_etablissements: gouv.nombre_etablissements || null,
      nombre_etablissements_ouverts: gouv.nombre_etablissements_ouverts || null,
      code_naf: gouv.code_naf || null,
      section_activite_principale: gouv.section_activite_principale || null,
      activite_principale_naf25: gouv.activite_principale_naf25 || null,
      adresse_siege: gouv.adresse_siege || null,
      siret_siege: gouv.siret_siege || null,
      code_postal_siege: gouv.code_postal_siege || null,
      libelle_commune_siege: gouv.libelle_commune_siege || null,
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
      // INSEE fields
      insee_periodes_historique: insee.periodes_historique || null,
      insee_date_dernier_traitement: insee.date_dernier_traitement || null,
      insee_nombre_periodes: insee.nombre_periodes || null,
      // Google Places fields
      telephone: google.telephone || pj.telephone?.[0] || null,
      site_web: google.site_web || pj.site_web || null,
      email: null,
      note_google: google.note_google || null,
      horaires: google.horaires || null,
      avis_count: google.avis_count || null,
      google_place_id: google.google_place_id || null,
      google_business_status: google.google_business_status || null,
      google_formatted_address: google.google_formatted_address || null,
      google_maps_uri: google.google_maps_uri || null,
      google_types: google.google_types || null,
      google_primary_type: google.google_primary_type || null,
      // BODACC fields
      bodacc_procedures: bodacc.procedures || null,
      bodacc_depots_comptes: bodacc.depots_comptes || null,
      bodacc_derniere_modification: bodacc.derniere_modification || null,
      // Pages Jaunes fields
      pj_telephone: pj.telephone || null,
      pj_site_web: pj.site_web || null,
      pj_adresse: pj.adresse || null,
      pj_activite: pj.activite || null,
      pj_url: pj.url_pj || null,
      pj_raison_social: pj.raison_social || null,
      // Sources
      source: [
        gouv.id ? "gouv" : null,
        insee.id ? "insee" : null,
        google.id ? "google" : null,
        bodacc.id ? "bodacc" : null,
        pj.id ? "pj" : null,
      ].filter(Boolean).join("+"),
      // Batch info
      batch_id: batchId,
    };
  }

  return NextResponse.json({ data });
}
