/**
 * Script batch enrichissement par API
 *
 * Usage : npx tsx scripts/batch-enrich.ts <batch_id> <api_name>
 * api_name: api_gouv | insee | google_places | bodacc | pages_jaunes
 */

import postgres from "postgres";
import * as dotenv from "dotenv";
import { resolve } from "path";

dotenv.config({ path: resolve(__dirname, "../.env.local") });

const sql = postgres(
  process.env.DATABASE_URL ||
    "postgresql://serres:SerresV2_2024!@65.21.146.193:5433/serresv2",
  { max: 5, connect_timeout: 10 }
);

const GOOGLE_PLACES_API_KEY = process.env.GOOGLE_PLACES_API_KEY || "";
const INSEE_SIRENE_API_KEY = process.env.INSEE_SIRENE_API_KEY || "";
const INSEE_SIRENE_BASE = "https://api.insee.fr/api-sirene/3.11";
const APIFY_API_TOKEN = process.env.APIFY_API_TOKEN || "";
const APIFY_PJ_ACTOR_ID = process.env.APIFY_PJ_ACTOR_ID || "McauDKXmReVaVEwk9";

const NATURES_JURIDIQUES: Record<string, string> = {
  "1000": "Entrepreneur individuel", "5410": "SARL", "5499": "SARL (autre)",
  "5498": "SARL unipersonnelle (EURL)", "5505": "SA a conseil d'administration",
  "5710": "SAS", "5720": "SASU", "6210": "GIE", "6220": "Cooperative",
  "6316": "CUMA", "6533": "GAEC", "6534": "GFA", "6521": "SCI",
  "9210": "Association declaree", "9220": "Association reconnue utilite publique",
};

const TRANCHES_EFFECTIFS: Record<string, string> = {
  "00": "0 salarie", "01": "1-2 salaries", "02": "3-5 salaries",
  "03": "6-9 salaries", "11": "10-19 salaries", "12": "20-49 salaries",
  "21": "50-99 salaries", "22": "100-199 salaries", "31": "200-249 salaries",
  "32": "250-499 salaries", "41": "500-999 salaries", "42": "1000-1999 salaries",
  "51": "2000-4999 salaries", "52": "5000-9999 salaries", "53": "10000+ salaries",
};

// ============================================================
// Helpers
// ============================================================

async function getAllProspectSirens(): Promise<string[]> {
  const rows = await sql`
    SELECT DISTINCT s.siren
    FROM serres s
    WHERE s.siren IS NOT NULL AND s.siren != ''
    ORDER BY s.siren
  `;
  return rows.map((r) => r.siren);
}

async function updateBatchApiStatus(
  batchId: number,
  apiName: string,
  update: { statut?: string; nb_total?: number; nb_enrichis?: number; nb_erreurs?: number; started_at?: string; completed_at?: string }
) {
  const sets: string[] = [];
  if (update.statut) sets.push(`statut = '${update.statut}'`);
  if (update.nb_total !== undefined) sets.push(`nb_total = ${update.nb_total}`);
  if (update.nb_enrichis !== undefined) sets.push(`nb_enrichis = ${update.nb_enrichis}`);
  if (update.nb_erreurs !== undefined) sets.push(`nb_erreurs = ${update.nb_erreurs}`);
  if (update.started_at) sets.push(`started_at = NOW()`);
  if (update.completed_at) sets.push(`completed_at = NOW()`);
  if (sets.length === 0) return;
  await sql.unsafe(`UPDATE enrichissement_batch_api SET ${sets.join(", ")} WHERE batch_id = ${batchId} AND api_name = '${apiName}'`);
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

/** Normalise une string pour comparaison fuzzy */
function normalize(s: string): string {
  return (s || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9\s]/g, "").trim();
}

/** Retourne les SIRENs deja enrichis dans une table batch */
async function getAlreadyEnriched(table: string, batchId: number): Promise<Set<string>> {
  const rows = await sql.unsafe(`SELECT siren FROM ${table} WHERE batch_id = ${batchId}`);
  return new Set(rows.map((r: any) => r.siren));
}

// ============================================================
// API Gouv enrichissement
// ============================================================
async function enrichApiGouv(batchId: number, sirens: string[]) {
  const already = await getAlreadyEnriched("data_api_gouv", batchId);
  const todo = sirens.filter((s) => !already.has(s));
  const skipped = sirens.length - todo.length;
  console.log(`[API_GOUV] Demarrage batch ${batchId}: ${todo.length} a faire (${skipped} deja enrichis sur ${sirens.length})`);
  await updateBatchApiStatus(batchId, "api_gouv", { statut: "running", nb_total: sirens.length, nb_enrichis: skipped, started_at: "now" });

  let enrichis = skipped;
  let erreurs = 0;

  for (let i = 0; i < todo.length; i++) {
    const siren = todo[i];
    try {
      const resp = await fetch(
        `https://recherche-entreprises.api.gouv.fr/search?q=${siren}`,
        { signal: AbortSignal.timeout(15000) }
      );

      if (resp.status === 429) {
        console.warn(`[API_GOUV] 429 rate limit, pause 5s...`);
        await sleep(5000);
        i--; // retry
        continue;
      }

      if (!resp.ok) {
        erreurs++;
        continue;
      }

      const json = await resp.json();
      const entreprise = json.results?.[0];
      if (!entreprise || entreprise.siren !== siren) {
        erreurs++;
        continue;
      }

      const codeNJ = entreprise.nature_juridique;
      const formeJuridique = NATURES_JURIDIQUES[codeNJ] || (codeNJ ? `Code ${codeNJ}` : null);
      const codeTE = entreprise.tranche_effectif_salarie || entreprise.siege?.tranche_effectif_salarie;
      const trancheEffectifs = TRANCHES_EFFECTIFS[codeTE] || (codeTE ? `Code ${codeTE}` : null);

      let chiffreAffaires: number | null = null;
      let resultatNet: number | null = null;
      let financesHistorique: any = null;
      if (entreprise.finances) {
        const annees = Object.keys(entreprise.finances).sort().reverse();
        if (annees.length > 0) {
          const dernier = entreprise.finances[annees[0]];
          chiffreAffaires = dernier.ca ?? null;
          resultatNet = dernier.resultat_net ?? null;
        }
        financesHistorique = entreprise.finances;
      }

      const dirigeantsComplet = entreprise.dirigeants || null;
      const dirigeants = entreprise.dirigeants
        ?.filter((d: any) => d.type_dirigeant === "personne physique")
        ?.map((d: any) => ({ nom: d.nom || "", prenom: d.prenoms || "", qualite: d.qualite || "" })) || null;

      const siege = entreprise.siege || {};
      const adresse = siege.geo_adresse || siege.adresse || null;
      const complements = entreprise.complements || null;

      await sql`
        INSERT INTO data_api_gouv (
          batch_id, siren, nom_complet, nom_raison_sociale, sigle,
          etat_administratif, date_creation, date_fermeture, forme_juridique,
          categorie_entreprise, tranche_effectifs, annee_tranche_effectif,
          caractere_employeur, nombre_etablissements, nombre_etablissements_ouverts,
          code_naf, libelle_naf, section_activite_principale, activite_principale_naf25,
          adresse_siege, siret_siege, code_postal_siege, libelle_commune_siege,
          latitude_siege, longitude_siege,
          dirigeants, dirigeants_complet, chiffre_affaires, resultat_net, finances_historique,
          est_bio, est_entrepreneur_individuel, est_ess, est_rge, est_societe_mission,
          convention_collective_renseignee, liste_idcc, complements
        ) VALUES (
          ${batchId}, ${siren}, ${entreprise.nom_complet || null}, ${entreprise.nom_raison_sociale || null}, ${entreprise.sigle || null},
          ${entreprise.etat_administratif || null}, ${entreprise.date_creation || null}, ${entreprise.date_fermeture || null}, ${formeJuridique},
          ${entreprise.categorie_entreprise || null}, ${trancheEffectifs}, ${entreprise.annee_tranche_effectif_salarie || null},
          ${siege.caractere_employeur === "O"}, ${entreprise.nombre_etablissements || null}, ${entreprise.nombre_etablissements_ouverts || null},
          ${entreprise.activite_principale || null}, ${null}, ${entreprise.section_activite_principale || null}, ${entreprise.activite_principale_naf25 || null},
          ${adresse}, ${siege.siret || null}, ${siege.code_postal || null}, ${siege.libelle_commune || null},
          ${siege.latitude || null}, ${siege.longitude || null},
          ${dirigeants ? sql.json(dirigeants) : null}, ${dirigeantsComplet ? sql.json(dirigeantsComplet) : null},
          ${chiffreAffaires}, ${resultatNet}, ${financesHistorique ? sql.json(financesHistorique) : null},
          ${complements?.est_bio || false}, ${complements?.est_entrepreneur_individuel || false},
          ${complements?.est_ess || false}, ${complements?.est_rge || false}, ${complements?.est_societe_mission || false},
          ${complements?.convention_collective_renseignee || false},
          ${complements?.liste_idcc ? sql.json(complements.liste_idcc) : null},
          ${complements ? sql.json(complements) : null}
        ) ON CONFLICT (batch_id, siren) DO UPDATE SET
          nom_complet = EXCLUDED.nom_complet, etat_administratif = EXCLUDED.etat_administratif,
          dirigeants = EXCLUDED.dirigeants, dirigeants_complet = EXCLUDED.dirigeants_complet,
          chiffre_affaires = EXCLUDED.chiffre_affaires, resultat_net = EXCLUDED.resultat_net,
          enrichi_at = NOW()
      `;

      enrichis++;
      if ((i + 1) % 50 === 0) {
        console.log(`[API_GOUV] Progression: ${i + 1}/${todo.length} (${enrichis} OK, ${erreurs} erreurs)`);
        await updateBatchApiStatus(batchId, "api_gouv", { nb_enrichis: enrichis, nb_erreurs: erreurs });
      }

      // Rate limiting: ~5 req/s max
      if ((i + 1) % 5 === 0) await sleep(200);

    } catch (err) {
      erreurs++;
      console.error(`[API_GOUV] Erreur siren=${siren}:`, err);
    }
  }

  await updateBatchApiStatus(batchId, "api_gouv", { statut: "done", nb_enrichis: enrichis, nb_erreurs: erreurs, completed_at: "now" });
  console.log(`[API_GOUV] Termine: ${enrichis}/${sirens.length} enrichis, ${erreurs} erreurs`);
}

// ============================================================
// INSEE enrichissement
// ============================================================
async function enrichInsee(batchId: number, sirens: string[]) {
  if (!INSEE_SIRENE_API_KEY) {
    console.error("[INSEE] Cle API manquante (INSEE_SIRENE_API_KEY), abandon");
    await updateBatchApiStatus(batchId, "insee", { statut: "error", nb_total: sirens.length, nb_erreurs: sirens.length });
    return;
  }

  const already = await getAlreadyEnriched("data_insee", batchId);
  const todo = sirens.filter((s) => !already.has(s));
  const skipped = sirens.length - todo.length;
  console.log(`[INSEE] Demarrage batch ${batchId}: ${todo.length} a faire (${skipped} deja enrichis sur ${sirens.length})`);
  console.log(`[INSEE] API Key presente: ${INSEE_SIRENE_API_KEY.substring(0, 8)}...`);
  await updateBatchApiStatus(batchId, "insee", { statut: "running", nb_total: sirens.length, nb_enrichis: skipped, started_at: "now" });

  let enrichis = skipped;
  let erreurs = 0;
  let consecutiveErrors = 0;

  for (let i = 0; i < todo.length; i++) {
    const siren = todo[i];
    try {
      const resp = await fetch(`${INSEE_SIRENE_BASE}/siren/${siren}`, {
        headers: { "X-INSEE-Api-Key-Integration": INSEE_SIRENE_API_KEY, "Accept": "application/json" },
        signal: AbortSignal.timeout(15000),
      });

      if (resp.status === 429) {
        console.warn("[INSEE] 429 rate limit, pause 120s...");
        await sleep(120000);
        i--; // retry
        consecutiveErrors = 0;
        continue;
      }

      if (resp.status === 403 || resp.status === 401) {
        console.error(`[INSEE] ${resp.status} auth error, verifier la cle API. Abandon.`);
        await updateBatchApiStatus(batchId, "insee", { statut: "error", nb_enrichis: enrichis, nb_erreurs: erreurs + (todo.length - i) });
        return;
      }

      if (!resp.ok) {
        if (i < 3 || (i + 1) % 100 === 0) console.warn(`[INSEE] siren=${siren} HTTP ${resp.status}`);
        erreurs++;
        consecutiveErrors++;
        // Sleep even on error to avoid hammering
        await sleep(2000);
        if (consecutiveErrors > 50) {
          console.error("[INSEE] 50 erreurs consecutives, arret");
          break;
        }
        continue;
      }
      consecutiveErrors = 0;

      const json = await resp.json();
      const ul = json.uniteLegale;
      if (!ul) { erreurs++; continue; }

      const periodesHistorique = ul.periodesUniteLegale?.map((p: any) => ({
        date_debut: p.dateDebut, date_fin: p.dateFin,
        etat: p.etatAdministratifUniteLegale, denomination: p.denominationUniteLegale,
        categorie_juridique: p.categorieJuridiqueUniteLegale,
        activite_principale: p.activitePrincipaleUniteLegale,
      })) || null;

      await sql`
        INSERT INTO data_insee (batch_id, siren, date_dernier_traitement, nombre_periodes, activite_principale_naf25, periodes_historique)
        VALUES (
          ${batchId}, ${siren}, ${ul.dateDernierTraitementUniteLegale || null},
          ${ul.nombrePeriodesUniteLegale || null}, ${ul.activitePrincipaleNAF25UniteLegale || null},
          ${periodesHistorique ? sql.json(periodesHistorique) : null}
        ) ON CONFLICT (batch_id, siren) DO UPDATE SET
          date_dernier_traitement = EXCLUDED.date_dernier_traitement,
          periodes_historique = EXCLUDED.periodes_historique, enrichi_at = NOW()
      `;

      enrichis++;
      consecutiveErrors = 0;
      if ((i + 1) % 50 === 0) {
        console.log(`[INSEE] Progression: ${i + 1}/${todo.length} (${enrichis} OK)`);
        await updateBatchApiStatus(batchId, "insee", { nb_enrichis: enrichis, nb_erreurs: erreurs });
      }

      // INSEE rate limit: ~30 req/min → 2s par requete + pause toutes les 25
      if ((i + 1) % 25 === 0) await sleep(60000);
      else await sleep(2000);

    } catch (err) {
      erreurs++;
      consecutiveErrors++;
      console.error(`[INSEE] Erreur siren=${siren}:`, err);
      await sleep(2000);
      if (consecutiveErrors > 50) {
        console.error("[INSEE] 50 erreurs consecutives (catch), arret");
        break;
      }
    }
  }

  await updateBatchApiStatus(batchId, "insee", { statut: "done", nb_enrichis: enrichis, nb_erreurs: erreurs, completed_at: "now" });
  console.log(`[INSEE] Termine: ${enrichis}/${sirens.length}`);
}

// ============================================================
// BODACC enrichissement
// ============================================================
async function enrichBodacc(batchId: number, sirens: string[]) {
  const already = await getAlreadyEnriched("data_bodacc", batchId);
  const todo = sirens.filter((s) => !already.has(s));
  const skipped = sirens.length - todo.length;
  console.log(`[BODACC] Demarrage batch ${batchId}: ${todo.length} a faire (${skipped} deja enrichis sur ${sirens.length})`);
  await updateBatchApiStatus(batchId, "bodacc", { statut: "running", nb_total: sirens.length, nb_enrichis: skipped, started_at: "now" });

  let enrichis = skipped;
  let erreurs = 0;

  for (let i = 0; i < todo.length; i++) {
    const siren = todo[i].replace(/\s/g, "");
    try {
      const resp = await fetch(
        `https://bodacc-datadila.opendatasoft.com/api/explore/v2.1/catalog/datasets/annonces-commerciales/records?where=registre%3D%22${siren}%22&order_by=dateparution%20desc&limit=20`,
        { signal: AbortSignal.timeout(15000) }
      );

      if (!resp.ok) { erreurs++; continue; }
      const json = await resp.json();
      const annonces = json.results || [];

      const procedures = annonces
        .filter((a: any) => a.familleavis === "collective" || a.jugement)
        .map((a: any) => ({ date: a.dateparution, type: a.familleavis_lib || a.typeavis_lib, tribunal: a.tribunal, jugement: a.jugement ? JSON.parse(a.jugement) : null }));

      const depots = annonces
        .filter((a: any) => a.familleavis === "dpc")
        .map((a: any) => {
          let depot = null;
          try { depot = a.depot ? JSON.parse(a.depot) : null; } catch {}
          return { date: a.dateparution, type: a.familleavis_lib, date_cloture: depot?.dateCloture || null, type_depot: depot?.typeDepot || null };
        });

      const modifications = annonces
        .filter((a: any) => a.familleavis === "modification" || a.modificationsgenerales)
        .slice(0, 5)
        .map((a: any) => ({ date: a.dateparution, type: a.familleavis_lib || a.typeavis_lib, details: a.modificationsgenerales || null }));

      if (procedures.length > 0 || depots.length > 0 || modifications.length > 0) {
        await sql`
          INSERT INTO data_bodacc (batch_id, siren, procedures, depots_comptes, derniere_modification)
          VALUES (
            ${batchId}, ${siren},
            ${procedures.length > 0 ? sql.json(procedures) : null},
            ${depots.length > 0 ? sql.json(depots) : null},
            ${modifications.length > 0 ? sql.json(modifications) : null}
          ) ON CONFLICT (batch_id, siren) DO UPDATE SET
            procedures = EXCLUDED.procedures, depots_comptes = EXCLUDED.depots_comptes,
            derniere_modification = EXCLUDED.derniere_modification, enrichi_at = NOW()
        `;
        enrichis++;
      }

      if ((i + 1) % 100 === 0) {
        console.log(`[BODACC] Progression: ${i + 1}/${todo.length} (${enrichis} OK)`);
        await updateBatchApiStatus(batchId, "bodacc", { nb_enrichis: enrichis, nb_erreurs: erreurs });
      }

      if ((i + 1) % 10 === 0) await sleep(500);

    } catch (err) {
      erreurs++;
      console.error(`[BODACC] Erreur siren=${siren}:`, err);
    }
  }

  await updateBatchApiStatus(batchId, "bodacc", { statut: "done", nb_enrichis: enrichis, nb_erreurs: erreurs, completed_at: "now" });
  console.log(`[BODACC] Termine: ${enrichis}/${sirens.length}`);  
}

// ============================================================
// Google Places enrichissement
// ============================================================
async function enrichGooglePlaces(batchId: number, sirens: string[]) {
  if (!GOOGLE_PLACES_API_KEY) {
    console.error("[GOOGLE] Cle API manquante, abandon");
    await updateBatchApiStatus(batchId, "google_places", { statut: "error", nb_total: sirens.length });
    return;
  }

  const already = await getAlreadyEnriched("data_google_places", batchId);
  const todo = sirens.filter((s) => !already.has(s));
  const skipped = sirens.length - todo.length;
  console.log(`[GOOGLE] Demarrage batch ${batchId}: ${todo.length} a faire (${skipped} deja enrichis sur ${sirens.length})`);
  await updateBatchApiStatus(batchId, "google_places", { statut: "running", nb_total: sirens.length, nb_enrichis: skipped, started_at: "now" });

  let enrichis = skipped;
  let erreurs = 0;

  // Get company names from data_api_gouv (same batch) or enrichissement_entreprise
  const gouvRows = await sql`
    SELECT siren, nom_complet, libelle_commune_siege, latitude_siege, longitude_siege
    FROM data_api_gouv WHERE batch_id = ${batchId}
  `;
  const gouvMap = new Map<string, any>();
  for (const r of gouvRows) gouvMap.set(r.siren, r);

  // Fallback from enrichissement_entreprise
  const enrichRows = await sql`
    SELECT siren, nom_complet, libelle_commune_siege, latitude_siege, longitude_siege
    FROM enrichissement_entreprise
  `;
  const enrichMap = new Map<string, any>();
  for (const r of enrichRows) enrichMap.set(r.siren, r);

  // Fallback from serres (nom_entreprise)
  const serreRows = await sql`
    SELECT DISTINCT siren, nom_entreprise, centroid_lat, centroid_lon
    FROM serres WHERE siren IS NOT NULL
  `;
  const serreMap = new Map<string, any>();
  for (const r of serreRows) serreMap.set(r.siren, r);

  for (let i = 0; i < todo.length; i++) {
    const siren = todo[i];
    const gouv = gouvMap.get(siren);
    const enrich = enrichMap.get(siren);
    const serre = serreMap.get(siren);

    const nomPourGoogle = gouv?.nom_complet || enrich?.nom_complet || serre?.nom_entreprise;
    if (!nomPourGoogle) { erreurs++; continue; }

    const commune = gouv?.libelle_commune_siege || enrich?.libelle_commune_siege || "";
    const textQuery = commune ? `${nomPourGoogle} ${commune}` : nomPourGoogle;
    const lat = gouv?.latitude_siege || enrich?.latitude_siege || serre?.centroid_lat;
    const lon = gouv?.longitude_siege || enrich?.longitude_siege || serre?.centroid_lon;

    try {
      const searchBody: any = { textQuery };
      if (lat && lon) {
        searchBody.locationBias = { circle: { center: { latitude: Number(lat), longitude: Number(lon) }, radius: 5000.0 } };
      }

      const findResp = await fetch("https://places.googleapis.com/v1/places:searchText", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Goog-Api-Key": GOOGLE_PLACES_API_KEY,
          "X-Goog-FieldMask": "places.id,places.displayName,places.nationalPhoneNumber,places.internationalPhoneNumber,places.websiteUri,places.rating,places.userRatingCount,places.regularOpeningHours,places.businessStatus,places.formattedAddress,places.googleMapsUri,places.types,places.primaryType,places.primaryTypeDisplayName",
        },
        body: JSON.stringify(searchBody),
        signal: AbortSignal.timeout(15000),
      });

      if (findResp.status === 429) {
        console.warn("[GOOGLE] 429 rate limit, arret pour ce mois");
        break;
      }

      if (!findResp.ok) { erreurs++; continue; }

      const findJson = await findResp.json();
      const place = findJson.places?.[0];
      if (!place) { erreurs++; continue; }

      // Validation similarity
      const placeName = (place.displayName?.text || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
      const expectedName = (nomPourGoogle || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
      const placeTokens = placeName.split(/\s+/).filter((t: string) => t.length > 2);
      const expectedTokens = expectedName.split(/\s+/).filter((t: string) => t.length > 2);
      const commonTokens = placeTokens.filter((t: string) => expectedTokens.some((e: string) => e.includes(t) || t.includes(e)));
      const similarity = expectedTokens.length > 0 ? commonTokens.length / expectedTokens.length : 0;

      if (similarity < 0.3 && expectedTokens.length > 0) { erreurs++; continue; }

      await sql`
        INSERT INTO data_google_places (
          batch_id, siren, telephone, site_web, note_google, horaires, avis_count,
          google_place_id, google_business_status, google_formatted_address,
          google_maps_uri, google_types, google_primary_type
        ) VALUES (
          ${batchId}, ${siren},
          ${place.internationalPhoneNumber || place.nationalPhoneNumber || null},
          ${place.websiteUri || null}, ${place.rating || null},
          ${place.regularOpeningHours?.weekdayDescriptions?.join(" | ") || null},
          ${place.userRatingCount || null}, ${place.id || null},
          ${place.businessStatus || null}, ${place.formattedAddress || null},
          ${place.googleMapsUri || null},
          ${place.types ? sql.json(place.types) : null},
          ${place.primaryTypeDisplayName?.text || place.primaryType || null}
        ) ON CONFLICT (batch_id, siren) DO UPDATE SET
          telephone = EXCLUDED.telephone, site_web = EXCLUDED.site_web,
          note_google = EXCLUDED.note_google, enrichi_at = NOW()
      `;

      enrichis++;
      if ((i + 1) % 50 === 0) {
        console.log(`[GOOGLE] Progression: ${i + 1}/${todo.length} (${enrichis} OK)`);
        await updateBatchApiStatus(batchId, "google_places", { nb_enrichis: enrichis, nb_erreurs: erreurs });
      }

      // Respect 5000/month free tier → pace requests
      await sleep(1000);

    } catch (err) {
      erreurs++;
      console.error(`[GOOGLE] Erreur siren=${siren}:`, err);
    }
  }

  await updateBatchApiStatus(batchId, "google_places", { statut: "done", nb_enrichis: enrichis, nb_erreurs: erreurs, completed_at: "now" });
  console.log(`[GOOGLE] Termine: ${enrichis}/${sirens.length}`);
}

// ============================================================
// Pages Jaunes enrichissement (via Apify) — par département
// ============================================================

// Helper: run one Apify PJ search and return items
async function runApifyPjSearch(searchUrl: string, label: string): Promise<any[]> {
  try {
    const startResp = await fetch(
      `https://api.apify.com/v2/acts/${APIFY_PJ_ACTOR_ID}/runs?token=${APIFY_API_TOKEN}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: searchUrl, maxItems: 500 }),
      }
    );
    if (!startResp.ok) {
      console.warn(`[PJ] Apify start error ${startResp.status} for: ${label}`);
      return [];
    }
    const runData = await startResp.json();
    const runId = runData.data?.id;
    if (!runId) return [];

    let runStatus = "RUNNING";
    let datasetId = "";
    let pollCount = 0;
    while (runStatus === "RUNNING" || runStatus === "READY") {
      await sleep(10000);
      const statusResp = await fetch(`https://api.apify.com/v2/actor-runs/${runId}?token=${APIFY_API_TOKEN}`);
      const statusData = await statusResp.json();
      runStatus = statusData.data?.status;
      datasetId = statusData.data?.defaultDatasetId;
      pollCount++;
      if (pollCount > 30) { console.warn(`[PJ] Run ${runId} timeout`); return []; }
    }
    if (runStatus !== "SUCCEEDED" || !datasetId) return [];

    const itemsResp = await fetch(
      `https://api.apify.com/v2/datasets/${datasetId}/items?token=${APIFY_API_TOKEN}&limit=1000&format=json`
    );
    const items = await itemsResp.json();
    return Array.isArray(items) ? items : [];
  } catch (err) {
    console.error(`[PJ] Apify error for ${label}:`, err);
    return [];
  }
}

async function enrichPagesJaunes(batchId: number, sirens: string[]) {
  if (!APIFY_API_TOKEN) {
    console.error("[PJ] Token Apify manquant (APIFY_API_TOKEN), abandon");
    await updateBatchApiStatus(batchId, "pages_jaunes", { statut: "error", nb_total: sirens.length });
    return;
  }

  const already = await getAlreadyEnriched("data_pages_jaunes", batchId);
  const todoSirens = sirens.filter((s) => !already.has(s));
  const skipped = sirens.length - todoSirens.length;
  console.log(`[PJ] Demarrage batch ${batchId}: ${todoSirens.length} a faire (${skipped} deja enrichis sur ${sirens.length})`);
  await updateBatchApiStatus(batchId, "pages_jaunes", { statut: "running", nb_total: sirens.length, nb_enrichis: skipped, started_at: "now" });

  if (todoSirens.length === 0) {
    await updateBatchApiStatus(batchId, "pages_jaunes", { statut: "done", completed_at: "now" });
    console.log("[PJ] Rien a faire, tous deja enrichis");
    return;
  }

  // Build lookup maps
  const sirenSet = new Set(todoSirens);

  const gouvData = await sql`
    SELECT siren, nom_complet, libelle_commune_siege, code_postal_siege
    FROM data_api_gouv WHERE batch_id = ${batchId}
  `;

  // Map: normalized_name → siren
  const nameToSiren = new Map<string, string>();
  // Map: code_postal → [{ siren, name }]
  const cpToEntries = new Map<string, { siren: string; name: string }[]>();
  // Map: département → commune names (for PJ search locality)
  const depToCommunes = new Map<string, Set<string>>();
  // Set of unique départements
  const departements = new Set<string>();

  for (const r of gouvData) {
    if (!r.siren || !sirenSet.has(r.siren)) continue;
    const name = normalize(r.nom_complet || "");
    if (name.length > 3) nameToSiren.set(name, r.siren);
    if (r.code_postal_siege) {
      const cp = String(r.code_postal_siege).substring(0, 5);
      const dep = cp.substring(0, 2);
      departements.add(dep);
      if (!cpToEntries.has(cp)) cpToEntries.set(cp, []);
      cpToEntries.get(cp)!.push({ siren: r.siren, name });
      if (r.libelle_commune_siege) {
        if (!depToCommunes.has(dep)) depToCommunes.set(dep, new Set());
        depToCommunes.get(dep)!.add(r.libelle_commune_siege);
      }
    }
  }

  console.log(`[PJ] Index: ${nameToSiren.size} noms, ${cpToEntries.size} codes postaux, ${departements.size} departements`);

  // Keywords to search — broad terms that cover serre-related businesses
  const keywords = ["serre", "horticulture", "pepiniere"];

  let enrichis = skipped;
  let totalResults = 0;
  const matchedSirens = new Set<string>(already);
  const depList = [...departements].sort();

  // Helper: try to match a PJ item to a prospect
  function matchItem(item: any): string | null {
    // Strategy 1: SIRET → SIREN
    const itemSiret = (item.siret || "").replace(/\s/g, "");
    const itemSiren = itemSiret.substring(0, 9);
    if (itemSiren && sirenSet.has(itemSiren) && !matchedSirens.has(itemSiren)) return itemSiren;

    // Strategy 2: exact normalized name
    if (item.raison_social) {
      const pjName = normalize(item.raison_social);
      if (pjName.length > 3) {
        const exactMatch = nameToSiren.get(pjName);
        if (exactMatch && !matchedSirens.has(exactMatch)) return exactMatch;
      }
    }

    // Strategy 3: fuzzy name + postal code
    if (item.raison_social && item.postal_code) {
      const pjName = normalize(item.raison_social);
      const cp = String(item.postal_code).substring(0, 5);
      // Check same CP and neighboring CPs (±1)
      const cpsToCheck = [cp];
      const cpNum = parseInt(cp, 10);
      if (!isNaN(cpNum)) {
        cpsToCheck.push(String(cpNum - 1).padStart(5, "0"), String(cpNum + 1).padStart(5, "0"));
      }
      for (const checkCp of cpsToCheck) {
        const localEntries = cpToEntries.get(checkCp) || [];
        for (const entry of localEntries) {
          if (matchedSirens.has(entry.siren)) continue;
          const pjTokens = pjName.split(/\s+/).filter((t) => t.length > 2);
          const dbTokens = entry.name.split(/\s+/).filter((t) => t.length > 2);
          if (dbTokens.length === 0) continue;
          const common = pjTokens.filter((t) => dbTokens.some((d) => d.includes(t) || t.includes(d)));
          const score = common.length / Math.max(dbTokens.length, 1);
          if (score >= 0.4) return entry.siren;
        }
      }
    }
    return null;
  }

  // Helper: insert matched PJ item
  async function insertMatch(matchedSiren: string, item: any) {
    const itemSiret = (item.siret || "").replace(/\s/g, "");
    const siteWeb = item.external_links?.[0]?.site_externe || null;
    const telephone: string[] = Array.isArray(item.tel) ? item.tel.map(String) : (item.tel ? [String(item.tel)] : []);
    await sql`
      INSERT INTO data_pages_jaunes (
        batch_id, siren, pj_id, raison_social, description,
        adresse, code_postal, ville, telephone, siret, naf,
        forme_juridique, date_creation, activite, multi_activite,
        site_web, url_pj, raw_data
      ) VALUES (
        ${batchId}, ${matchedSiren}, ${item.id || null}, ${item.raison_social || null},
        ${item.description || null}, ${item.adresse || null}, ${item.postal_code || null},
        ${item.city || null}, ${telephone.length > 0 ? sql.array(telephone) : null},
        ${itemSiret || null}, ${item.NAF || null},
        ${item.forme_juridique || null}, ${item.creation_date || null},
        ${item.activite || null},
        ${Array.isArray(item.multi_activite) && item.multi_activite.length > 0 ? sql.json(item.multi_activite) : null},
        ${siteWeb}, ${item.url || null}, ${sql.json(item)}
      ) ON CONFLICT (batch_id, siren) DO UPDATE SET
        telephone = EXCLUDED.telephone, site_web = EXCLUDED.site_web,
        raw_data = EXCLUDED.raw_data, enrichi_at = NOW()
    `;
  }

  console.log(`[PJ] Strategie: ${keywords.length} mots-cles x ${depList.length} departements = ${keywords.length * depList.length} recherches`);

  let searchCount = 0;
  for (const dep of depList) {
    for (const kw of keywords) {
      searchCount++;
      const searchUrl = `https://www.pagesjaunes.fr/annuaire/chercherlespros?quoiqui=${kw}&ou=departement+${dep}`;
      const label = `${kw} dep=${dep}`;

      const items = await runApifyPjSearch(searchUrl, label);
      totalResults += items.length;

      let depMatches = 0;
      for (const item of items) {
        const matched = matchItem(item);
        if (!matched) continue;
        matchedSirens.add(matched);
        try {
          await insertMatch(matched, item);
          enrichis++;
          depMatches++;
        } catch (dbErr) {
          console.error(`[PJ] DB error siren=${matched}:`, dbErr);
        }
      }

      if (items.length > 0 || depMatches > 0) {
        console.log(`[PJ] [${searchCount}/${keywords.length * depList.length}] ${label}: ${items.length} resultats, ${depMatches} matches`);
      }

      await updateBatchApiStatus(batchId, "pages_jaunes", { nb_enrichis: enrichis });

      // Small delay between Apify runs to avoid overloading
      await sleep(2000);
    }

    // Log progress every 10 départements
    if (depList.indexOf(dep) % 10 === 9) {
      console.log(`[PJ] Progress: ${depList.indexOf(dep) + 1}/${depList.length} departements, ${enrichis - skipped} matches, ${totalResults} resultats PJ`);
    }
  }

  await updateBatchApiStatus(batchId, "pages_jaunes", { statut: "done", nb_enrichis: enrichis, nb_erreurs: 0, completed_at: "now" });
  console.log(`[PJ] Termine: ${enrichis - skipped} nouveaux matches (${enrichis} total) sur ${totalResults} resultats PJ`);
}

// ============================================================
// Main
// ============================================================
async function main() {
  const batchId = parseInt(process.argv[2], 10);
  const apiName = process.argv[3];

  if (!batchId || !apiName) {
    console.error("Usage: npx tsx scripts/batch-enrich.ts <batch_id> <api_name>");
    console.error("api_name: api_gouv | insee | google_places | bodacc | pages_jaunes");
    process.exit(1);
  }

  const batch = await sql`SELECT * FROM enrichissement_batch WHERE id = ${batchId}`;
  if (batch.length === 0) {
    console.error(`Batch ${batchId} non trouve`);
    process.exit(1);
  }

  console.log(`\n========================================`);
  console.log(`Enrichissement batch: ${batch[0].nom} (id=${batchId})`);
  console.log(`API: ${apiName}`);
  console.log(`========================================\n`);

  const sirens = await getAllProspectSirens();
  console.log(`${sirens.length} prospects a enrichir\n`);

  // Ensure batch_api record exists
  await sql`
    INSERT INTO enrichissement_batch_api (batch_id, api_name, statut, nb_total)
    VALUES (${batchId}, ${apiName}, 'pending', ${sirens.length})
    ON CONFLICT (batch_id, api_name) DO NOTHING
  `;

  switch (apiName) {
    case "api_gouv":
      await enrichApiGouv(batchId, sirens);
      break;
    case "insee":
      await enrichInsee(batchId, sirens);
      break;
    case "bodacc":
      await enrichBodacc(batchId, sirens);
      break;
    case "google_places":
      await enrichGooglePlaces(batchId, sirens);
      break;
    case "pages_jaunes":
      await enrichPagesJaunes(batchId, sirens);
      break;
    default:
      console.error(`API inconnue: ${apiName}`);
      process.exit(1);
  }

  await sql.end();
  console.log("\nDone.");
}

main().catch((err) => {
  console.error("FATAL:", err);
  process.exit(1);
});
