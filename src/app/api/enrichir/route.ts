import { NextRequest, NextResponse } from "next/server";
import sql from "@/lib/db";

const GOOGLE_PLACES_API_KEY = process.env.GOOGLE_PLACES_API_KEY || "";
const INSEE_SIRENE_API_KEY = process.env.INSEE_SIRENE_API_KEY || "";
const INSEE_SIRENE_BASE = "https://api.insee.fr/api-sirene/3.11";

// =============================================
// Table de correspondance des natures juridiques INSEE
// =============================================
const NATURES_JURIDIQUES: Record<string, string> = {
  "1000": "Entrepreneur individuel",
  "5410": "SARL",
  "5499": "SARL (autre)",
  "5498": "SARL unipersonnelle (EURL)",
  "5505": "SA a conseil d'administration",
  "5510": "SA a directoire",
  "5599": "SA (autre)",
  "5710": "SAS",
  "5720": "SASU",
  "5800": "Societe europeenne",
  "6100": "Caisse d'epargne",
  "6210": "GIE",
  "6220": "Cooperative",
  "6316": "CUMA",
  "6411": "Societe civile",
  "6521": "SCI",
  "6532": "SCA",
  "6533": "GAEC",
  "6534": "GFA",
  "6540": "Societe civile (autre)",
  "6599": "Societe civile (autre)",
  "7111": "Etat",
  "7210": "Commune",
  "7225": "EPCI",
  "7490": "Autre collectivite territoriale",
  "8110": "Regime general secu",
  "9210": "Association declaree",
  "9220": "Association reconnue utilite publique",
  "9221": "Association de droit local",
  "9240": "Congregation",
  "9260": "Association de droit local (Alsace-Moselle)",
  "9300": "Fondation",
  "9900": "Autre personne morale de droit prive",
};

// Table de correspondance des tranches d'effectifs INSEE
const TRANCHES_EFFECTIFS: Record<string, string> = {
  "00": "0 salarie",
  "01": "1-2 salaries",
  "02": "3-5 salaries",
  "03": "6-9 salaries",
  "11": "10-19 salaries",
  "12": "20-49 salaries",
  "21": "50-99 salaries",
  "22": "100-199 salaries",
  "31": "200-249 salaries",
  "32": "250-499 salaries",
  "41": "500-999 salaries",
  "42": "1000-1999 salaries",
  "51": "2000-4999 salaries",
  "52": "5000-9999 salaries",
  "53": "10000+ salaries",
};

// =============================================
// Helpers suivi consommation API payantes
// =============================================

async function getCurrentMonth(): Promise<string> {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

async function getApiUsage(apiName: string): Promise<{ appels: number; limite: number }> {
  const mois = await getCurrentMonth();
  const rows = await sql`
    SELECT appels, limite_mensuelle FROM api_usage
    WHERE api_name = ${apiName} AND mois = ${mois}
  `;
  if (rows.length === 0) {
    const limite = apiName === "google_places" ? 4800 : 200;
    await sql`
      INSERT INTO api_usage (api_name, mois, appels, limite_mensuelle)
      VALUES (${apiName}, ${mois}, 0, ${limite})
      ON CONFLICT (api_name, mois) DO NOTHING
    `;
    return { appels: 0, limite };
  }
  return { appels: rows[0].appels, limite: rows[0].limite_mensuelle };
}

async function incrementApiUsage(apiName: string): Promise<void> {
  const mois = await getCurrentMonth();
  await sql`
    UPDATE api_usage SET appels = appels + 1, updated_at = NOW()
    WHERE api_name = ${apiName} AND mois = ${mois}
  `;
}

function formatUsageMessage(apiName: string, appels: number, limite: number): string {
  const labels: Record<string, string> = { google_places: "Google Places" };
  const label = labels[apiName] || apiName;
  return `Quota ${label} atteint : ${appels}/${limite} appels ce mois-ci. Reessayez le mois prochain ou augmentez la limite dans la table api_usage.`;
}

// =============================================
// SOURCES DE DONNEES (par ordre de priorite)
//
// 1. API Gouv (GRATUIT, ILLIMITE) → identite complete, NAF, effectifs,
//    adresse, dirigeants complets, date creation, CA, resultat net,
//    complements (bio, ESS, RGE...), finances historique
// 2. BODACC (GRATUIT, ILLIMITE) → procedures collectives, depots
//    comptes, modifications
// 3. Google Places (PAYANT, credits gratuits/jour) → telephone, site web,
//    note Google, horaires, avis, businessStatus, adresse Google,
//    lien Maps, types
// =============================================

export async function POST(request: NextRequest) {
  const body = await request.json();
  const { siren, nom_entreprise, lat, lon, force } = body;

  if (!siren) {
    return NextResponse.json({ error: "siren requis" }, { status: 400 });
  }

  // Verifier si deja enrichi en BDD (sauf si force=true)
  if (!force) {
    const existing = await sql`
      SELECT * FROM enrichissement_entreprise WHERE siren = ${siren}
    `;
    if (existing.length > 0) {
      return NextResponse.json({ data: existing[0], cached: true });
    }
  } else {
    console.log(`[FORCE] Re-enrichissement force pour siren=${siren}`);
  }

  // Recuperer user_id depuis le cookie
  let userId: number | null = null;
  const session = request.cookies.get("serres_session")?.value;
  if (session) {
    try {
      const decoded = JSON.parse(Buffer.from(session, "base64").toString());
      userId = decoded.id;
    } catch {}
  }

  let gouvData: any = {};
  let inseeData: any = {};
  let googleData: any = {};
  let bodaccData: any = {};
  const sources: string[] = [];

  let gouvError = "";
  let inseeError = "";
  let googleError = "";
  let bodaccError = "";

  // ======================================================
  // ETAPE 1 : API Gouvernement (GRATUIT, ILLIMITE)
  // https://recherche-entreprises.api.gouv.fr
  // Recuperation de TOUS les champs disponibles
  // ======================================================
  try {
    const resp = await fetch(
      `https://recherche-entreprises.api.gouv.fr/search?q=${siren}`,
      { signal: AbortSignal.timeout(10000) }
    );
    if (resp.ok) {
      const json = await resp.json();
      const entreprise = json.results?.[0];

      if (entreprise && entreprise.siren === siren) {
        // Forme juridique : code INSEE -> libelle
        const codeNJ = entreprise.nature_juridique;
        const formeJuridique = NATURES_JURIDIQUES[codeNJ] || (codeNJ ? `Code ${codeNJ}` : null);

        // Tranche effectifs : code INSEE -> libelle
        const codeTE = entreprise.tranche_effectif_salarie || entreprise.siege?.tranche_effectif_salarie;
        const trancheEffectifs = TRANCHES_EFFECTIFS[codeTE] || (codeTE ? `Code ${codeTE}` : null);

        // Finances : prendre l'annee la plus recente + historique complet
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

        // Dirigeants complets (toutes les personnes, physiques ET morales)
        const dirigeantsComplet = entreprise.dirigeants || null;

        // Dirigeants simplifies (personnes physiques uniquement, pour compat)
        const dirigeants = entreprise.dirigeants
          ?.filter((d: any) => d.type_dirigeant === "personne physique")
          ?.map((d: any) => ({
            nom: d.nom || "",
            prenom: d.prenoms || "",
            qualite: d.qualite || "",
          })) || null;

        // Adresse
        const siege = entreprise.siege || {};
        const adresse = siege.geo_adresse || siege.adresse || null;

        // Complements
        const complements = entreprise.complements || null;

        gouvData = {
          // Champs existants
          forme_juridique: formeJuridique,
          date_creation: entreprise.date_creation || null,
          tranche_effectifs: trancheEffectifs,
          chiffre_affaires: chiffreAffaires,
          resultat_net: resultatNet,
          adresse_siege: adresse,
          code_naf: entreprise.activite_principale || null,
          libelle_naf: null,
          dirigeants,
          // Nouveaux champs identite
          etat_administratif: entreprise.etat_administratif || null,
          date_fermeture: entreprise.date_fermeture || null,
          nom_complet: entreprise.nom_complet || null,
          nom_raison_sociale: entreprise.nom_raison_sociale || null,
          sigle: entreprise.sigle || null,
          categorie_entreprise: entreprise.categorie_entreprise || null,
          caractere_employeur: siege.caractere_employeur === "O",
          nombre_etablissements: entreprise.nombre_etablissements || null,
          nombre_etablissements_ouverts: entreprise.nombre_etablissements_ouverts || null,
          section_activite_principale: entreprise.section_activite_principale || null,
          activite_principale_naf25: entreprise.activite_principale_naf25 || null,
          annee_tranche_effectif: entreprise.annee_tranche_effectif_salarie || null,
          // Siege
          siret_siege: siege.siret || null,
          code_postal_siege: siege.code_postal || null,
          libelle_commune_siege: siege.libelle_commune || null,
          latitude_siege: siege.latitude || null,
          longitude_siege: siege.longitude || null,
          // Complements
          est_bio: complements?.est_bio || false,
          est_entrepreneur_individuel: complements?.est_entrepreneur_individuel || false,
          est_ess: complements?.est_ess || false,
          est_rge: complements?.est_rge || false,
          est_societe_mission: complements?.est_societe_mission || false,
          convention_collective_renseignee: complements?.convention_collective_renseignee || false,
          liste_idcc: complements?.liste_idcc || null,
          complements,
          // Dirigeants complets
          dirigeants_complet: dirigeantsComplet,
          // Finances historique
          finances_historique: financesHistorique,
        };
        sources.push("gouv");
        console.log(`[GOUV] OK siren=${siren}: ${entreprise.nom_complet}, etat=${entreprise.etat_administratif}, CA=${chiffreAffaires}`);
      } else {
        gouvError = "SIREN non trouve dans API gouv";
        console.log(`[GOUV] Aucun resultat exact pour siren=${siren}`);
      }
    } else {
      gouvError = `HTTP ${resp.status}`;
      console.error(`[GOUV] Erreur ${resp.status} pour siren=${siren}`);
    }
  } catch (err) {
    gouvError = String(err);
    console.error("[GOUV] Erreur:", err);
  }

  // ======================================================
  // ETAPE 1b : API INSEE Sirene (GRATUIT avec cle API)
  // Donnees officielles detaillees + historique des periodes
  // https://api.insee.fr/api-sirene/3.11
  // ======================================================
  if (INSEE_SIRENE_API_KEY) {
    try {
      const inseeResp = await fetch(
        `${INSEE_SIRENE_BASE}/siren/${siren}`,
        {
          headers: { "X-INSEE-Api-Key-Integration": INSEE_SIRENE_API_KEY, "Accept": "application/json" },
          signal: AbortSignal.timeout(10000),
        }
      );
      if (inseeResp.ok) {
        const inseeJson = await inseeResp.json();
        const ul = inseeJson.uniteLegale;
        if (ul) {
          const periode = ul.periodesUniteLegale?.[0];

          // Historique complet des periodes
          const periodesHistorique = ul.periodesUniteLegale?.map((p: any) => ({
            date_debut: p.dateDebut,
            date_fin: p.dateFin,
            etat: p.etatAdministratifUniteLegale,
            denomination: p.denominationUniteLegale,
            categorie_juridique: p.categorieJuridiqueUniteLegale,
            activite_principale: p.activitePrincipaleUniteLegale,
            nomenclature: p.nomenclatureActivitePrincipaleUniteLegale,
            nic_siege: p.nicSiegeUniteLegale,
            ess: p.economieSocialeSolidaireUniteLegale,
            societe_mission: p.societeMissionUniteLegale,
            caractere_employeur: p.caractereEmployeurUniteLegale,
          })) || null;

          inseeData = {
            date_dernier_traitement: ul.dateDernierTraitementUniteLegale || null,
            nombre_periodes: ul.nombrePeriodesUniteLegale || null,
            activite_principale_naf25_insee: ul.activitePrincipaleNAF25UniteLegale || null,
            periodes_historique: periodesHistorique,
            // Completer les champs manquants de gouvData
            ...((!gouvData.tranche_effectifs && ul.trancheEffectifsUniteLegale && ul.trancheEffectifsUniteLegale !== "NN")
              ? { tranche_effectifs_insee: TRANCHES_EFFECTIFS[ul.trancheEffectifsUniteLegale] || ul.trancheEffectifsUniteLegale } : {}),
            ...((!gouvData.categorie_entreprise && ul.categorieEntreprise)
              ? { categorie_entreprise_insee: ul.categorieEntreprise } : {}),
          };

          sources.push("insee");
          console.log(`[INSEE] OK siren=${siren}: ${ul.denominationUniteLegale || periode?.denominationUniteLegale}, ${periodesHistorique?.length || 0} periodes, NAF25=${ul.activitePrincipaleNAF25UniteLegale || "-"}`);
        } else {
          inseeError = "Pas d'unite legale dans la reponse";
          console.warn(`[INSEE] Reponse sans uniteLegale pour siren=${siren}`);
        }
      } else if (inseeResp.status === 404) {
        inseeError = "SIREN non trouve";
        console.log(`[INSEE] 404 pour siren=${siren}`);
      } else if (inseeResp.status === 429) {
        inseeError = "Quota INSEE depasse";
        console.warn(`[INSEE] 429 rate limit pour siren=${siren}`);
      } else {
        inseeError = `HTTP ${inseeResp.status}`;
        console.error(`[INSEE] ${inseeResp.status} pour siren=${siren}`);
      }
    } catch (err) {
      inseeError = String(err);
      console.error("[INSEE] Erreur:", err);
    }
  } else {
    console.log(`[INSEE] SAUTE: cle API INSEE_SIRENE_API_KEY non configuree`);
  }

  // ======================================================
  // ETAPE 2 : BODACC (GRATUIT, ILLIMITE)
  // Procedures collectives, depots de comptes, modifications
  // ======================================================
  try {
    const sirenFormatted = siren.replace(/\s/g, "");
    const bodaccResp = await fetch(
      `https://bodacc-datadila.opendatasoft.com/api/explore/v2.1/catalog/datasets/annonces-commerciales/records?where=registre%3D%22${sirenFormatted}%22&order_by=dateparution%20desc&limit=20`,
      { signal: AbortSignal.timeout(10000) }
    );
    if (bodaccResp.ok) {
      const bodaccJson = await bodaccResp.json();
      const annonces = bodaccJson.results || [];

      if (annonces.length > 0) {
        const procedures = annonces
          .filter((a: any) => a.familleavis === "collective" || a.jugement)
          .map((a: any) => ({
            date: a.dateparution,
            type: a.familleavis_lib || a.typeavis_lib,
            tribunal: a.tribunal,
            jugement: a.jugement ? JSON.parse(a.jugement) : null,
          }));

        const depots = annonces
          .filter((a: any) => a.familleavis === "dpc")
          .map((a: any) => {
            let depot = null;
            try { depot = a.depot ? JSON.parse(a.depot) : null; } catch {}
            return {
              date: a.dateparution,
              type: a.familleavis_lib,
              date_cloture: depot?.dateCloture || null,
              type_depot: depot?.typeDepot || null,
            };
          });

        const modifications = annonces
          .filter((a: any) => a.familleavis === "modification" || a.modificationsgenerales)
          .slice(0, 5)
          .map((a: any) => ({
            date: a.dateparution,
            type: a.familleavis_lib || a.typeavis_lib,
            details: a.modificationsgenerales || null,
          }));

        bodaccData = {
          bodacc_procedures: procedures.length > 0 ? procedures : null,
          bodacc_depots_comptes: depots.length > 0 ? depots : null,
          bodacc_derniere_modification: modifications.length > 0 ? modifications : null,
        };

        if (procedures.length > 0 || depots.length > 0 || modifications.length > 0) {
          sources.push("bodacc");
        }
        console.log(`[BODACC] OK siren=${siren}: ${annonces.length} annonces, ${procedures.length} proc., ${depots.length} depots`);
      } else {
        console.log(`[BODACC] Aucune annonce pour siren=${siren}`);
      }
    } else {
      bodaccError = `HTTP ${bodaccResp.status}`;
      console.error(`[BODACC] Erreur ${bodaccResp.status} pour siren=${siren}`);
    }
  } catch (err) {
    bodaccError = String(err);
    console.error("[BODACC] Erreur:", err);
  }

  console.log(`[CONTROLE] Apres API gratuites: CA=${gouvData.chiffre_affaires || "VIDE"}, RN=${gouvData.resultat_net || "VIDE"}, Dirigeants=${gouvData.dirigeants_complet?.length || 0}`);

  // ======================================================
  // ETAPE 3 : Google Places (PAYANT, 4800/mois gratuit)
  // Telephone, site web, note Google, horaires, avis
  // + businessStatus, formattedAddress, googleMapsUri, types
  // (inclus sans surcout dans le tier Enterprise)
  // ======================================================
  const nomPourGoogle = gouvData.nom_complet || nom_entreprise;
  if (GOOGLE_PLACES_API_KEY && nomPourGoogle) {
    const googleUsage = await getApiUsage("google_places");
    if (googleUsage.appels >= googleUsage.limite) {
      googleError = formatUsageMessage("google_places", googleUsage.appels, googleUsage.limite);
      console.warn(`[QUOTA] Google Places : ${googleUsage.appels}/${googleUsage.limite}`);
    } else {
      try {
        // A2: Ajouter la commune au textQuery pour desambiguiser
        const communeSiege = gouvData.libelle_commune_siege || "";
        const textQuery = communeSiege ? `${nomPourGoogle} ${communeSiege}` : nomPourGoogle;
        const searchBody: any = { textQuery };

        // A1: Utiliser les coordonnees du siege (API Gouv) au lieu du centroide serre
        const searchLat = gouvData.latitude_siege || lat;
        const searchLon = gouvData.longitude_siege || lon;
        if (searchLat && searchLon) {
          searchBody.locationBias = { circle: { center: { latitude: searchLat, longitude: searchLon }, radius: 5000.0 } };
        }

        const findResp = await fetch(
          "https://places.googleapis.com/v1/places:searchText",
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "X-Goog-Api-Key": GOOGLE_PLACES_API_KEY,
              "X-Goog-FieldMask": [
                "places.id",
                "places.displayName",
                "places.nationalPhoneNumber",
                "places.internationalPhoneNumber",
                "places.websiteUri",
                "places.rating",
                "places.userRatingCount",
                "places.regularOpeningHours",
                "places.businessStatus",
                "places.formattedAddress",
                "places.googleMapsUri",
                "places.types",
                "places.primaryType",
                "places.primaryTypeDisplayName",
              ].join(","),
            },
            body: JSON.stringify(searchBody),
            signal: AbortSignal.timeout(10000),
          }
        );

        if (findResp.ok) {
          await incrementApiUsage("google_places");
          const findJson = await findResp.json();
          const place = findJson.places?.[0];

          if (place) {
            // A3: Valider que le resultat Google correspond bien a l'entreprise
            const placeName = (place.displayName?.text || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
            const expectedName = (nomPourGoogle || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
            const placeTokens = placeName.split(/\s+/).filter((t: string) => t.length > 2);
            const expectedTokens = expectedName.split(/\s+/).filter((t: string) => t.length > 2);
            const commonTokens = placeTokens.filter((t: string) => expectedTokens.some((e: string) => e.includes(t) || t.includes(e)));
            const similarity = expectedTokens.length > 0 ? commonTokens.length / expectedTokens.length : 0;

            if (similarity >= 0.3 || expectedTokens.length === 0) {
              googleData = {
                telephone: place.internationalPhoneNumber || place.nationalPhoneNumber || null,
                site_web: place.websiteUri || null,
                note_google: place.rating || null,
                avis_count: place.userRatingCount || null,
                horaires: place.regularOpeningHours?.weekdayDescriptions?.join(" | ") || null,
                google_place_id: place.id || null,
                google_business_status: place.businessStatus || null,
                google_formatted_address: place.formattedAddress || null,
                google_maps_uri: place.googleMapsUri || null,
                google_types: place.types || null,
                google_primary_type: place.primaryTypeDisplayName?.text || place.primaryType || null,
              };
              sources.push("google");
              console.log(`[GOOGLE] OK pour "${nomPourGoogle}": ${place.displayName?.text} (sim=${similarity.toFixed(2)}), status=${place.businessStatus}`);
            } else {
              googleError = `Resultat Google rejete: "${place.displayName?.text}" ne correspond pas a "${nomPourGoogle}" (sim=${similarity.toFixed(2)})`;
              console.warn(`[GOOGLE] REJETE pour "${nomPourGoogle}": place="${place.displayName?.text}", sim=${similarity.toFixed(2)}`);
            }
          } else {
            googleError = "Aucun resultat trouve";
          }
        } else {
          const errBody = await findResp.text().catch(() => "");
          if (findResp.status === 429) {
            googleError = "Quota Google Places depasse cote Google. Reessayez demain.";
          } else {
            googleError = `HTTP ${findResp.status}: ${errBody.slice(0, 200)}`;
          }
          console.error(`[GOOGLE] ${findResp.status} pour "${nomPourGoogle}"`);
        }
      } catch (err) {
        googleError = String(err);
        console.error("[GOOGLE] Erreur:", err);
      }
    }
  } else if (!GOOGLE_PLACES_API_KEY) {
    googleError = "Cle API manquante";
    console.warn(`[GOOGLE] SAUTE: cle API Google Places manquante`);
  } else {
    googleError = "Pas de nom entreprise";
    console.warn(`[GOOGLE] SAUTE: pas de nom entreprise (nom_entreprise="${nom_entreprise}", gouvData.nom_complet="${gouvData.nom_complet}")`);
  }

  console.log(`[CONTROLE] Apres Google: Tel=${googleData.telephone || "VIDE"}, Web=${googleData.site_web || "VIDE"}, Note=${googleData.note_google || "VIDE"}`);

  // ======================================================
  // Resultat : fusionner les sources (gouv prioritaire)
  // ======================================================
  if (sources.length === 0) {
    const details = [
      `Gouv: ${gouvError || "echec"}`,
      `INSEE: ${inseeError || "echec"}`,
      `BODACC: ${bodaccError || "aucune donnee"}`,
      `Google: ${googleError || "echec"}`,
    ].join(" | ");
    const isQuotaError = googleError.includes("Quota");
    console.error(`Enrichissement echoue siren=${siren}: ${details}`);
    return NextResponse.json(
      { error: isQuotaError ? details : `Enrichissement echoue. ${details}`, data: null, quota_exceeded: isQuotaError },
      { status: isQuotaError ? 429 : 422 }
    );
  }

  // Log de synthese enrichissement
  const synthese = {
    dirigeants: !!(gouvData.dirigeants_complet?.length || gouvData.dirigeants?.length),
    telephone: !!googleData.telephone,
    site_web: !!googleData.site_web,
    chiffre_affaires: !!gouvData.chiffre_affaires,
    resultat_net: !!gouvData.resultat_net,
    adresse: !!gouvData.adresse_siege,
    forme_juridique: !!gouvData.forme_juridique,
    bodacc: !!(bodaccData.bodacc_procedures || bodaccData.bodacc_depots_comptes),
    insee_historique: !!inseeData.periodes_historique,
    google_places: !!googleData.google_place_id,
  };
  const champsRemplis = Object.values(synthese).filter(Boolean).length;
  const champsTotal = Object.keys(synthese).length;
  console.log(`[SYNTHESE] siren=${siren}: ${champsRemplis}/${champsTotal} champs remplis — ${JSON.stringify(synthese)}`);
  if (inseeError) console.warn(`[SYNTHESE] INSEE: ${inseeError}`);
  if (googleError) console.warn(`[SYNTHESE] Google: ${googleError}`);

  // Fusion : gouvData (base) → INSEE (historique) → BODACC (juridique) → Google (contact)
  const record: any = {
    siren,
    // Champs existants
    forme_juridique: gouvData.forme_juridique || null,
    date_creation: gouvData.date_creation || null,
    tranche_effectifs: gouvData.tranche_effectifs || null,
    chiffre_affaires: gouvData.chiffre_affaires || null,
    resultat_net: gouvData.resultat_net || null,
    adresse_siege: gouvData.adresse_siege || null,
    code_naf: gouvData.code_naf || null,
    libelle_naf: gouvData.libelle_naf || null,
    dirigeants: gouvData.dirigeants || null,
    telephone: googleData.telephone || null,
    site_web: googleData.site_web || null,
    email: null,
    note_google: googleData.note_google || null,
    horaires: googleData.horaires || null,
    avis_count: googleData.avis_count || null,
    google_place_id: googleData.google_place_id || null,
    enrichi_par: userId,
    source: sources.join("+"),
    // Nouveaux champs identite (API Gouv)
    etat_administratif: gouvData.etat_administratif || null,
    date_fermeture: gouvData.date_fermeture || null,
    nom_complet: gouvData.nom_complet || null,
    nom_raison_sociale: gouvData.nom_raison_sociale || null,
    sigle: gouvData.sigle || null,
    siret_siege: gouvData.siret_siege || null,
    code_postal_siege: gouvData.code_postal_siege || null,
    libelle_commune_siege: gouvData.libelle_commune_siege || null,
    latitude_siege: gouvData.latitude_siege || null,
    longitude_siege: gouvData.longitude_siege || null,
    categorie_entreprise: gouvData.categorie_entreprise || null,
    caractere_employeur: gouvData.caractere_employeur || false,
    nombre_etablissements: gouvData.nombre_etablissements || null,
    nombre_etablissements_ouverts: gouvData.nombre_etablissements_ouverts || null,
    section_activite_principale: gouvData.section_activite_principale || null,
    activite_principale_naf25: gouvData.activite_principale_naf25 || null,
    annee_tranche_effectif: gouvData.annee_tranche_effectif || null,
    // Complements
    est_bio: gouvData.est_bio || false,
    est_entrepreneur_individuel: gouvData.est_entrepreneur_individuel || false,
    est_ess: gouvData.est_ess || false,
    est_rge: gouvData.est_rge || false,
    est_societe_mission: gouvData.est_societe_mission || false,
    convention_collective_renseignee: gouvData.convention_collective_renseignee || false,
    liste_idcc: gouvData.liste_idcc || null,
    complements: gouvData.complements || null,
    // Dirigeants complets
    dirigeants_complet: gouvData.dirigeants_complet || null,
    // Finances historique
    finances_historique: gouvData.finances_historique || null,
    // Google Places extra
    google_business_status: googleData.google_business_status || null,
    google_formatted_address: googleData.google_formatted_address || null,
    google_maps_uri: googleData.google_maps_uri || null,
    google_types: googleData.google_types || null,
    google_primary_type: googleData.google_primary_type || null,
    // INSEE Sirene
    insee_periodes_historique: inseeData.periodes_historique || null,
    insee_date_dernier_traitement: inseeData.date_dernier_traitement || null,
    insee_nombre_periodes: inseeData.nombre_periodes || null,
    // BODACC
    bodacc_procedures: bodaccData.bodacc_procedures || null,
    bodacc_depots_comptes: bodaccData.bodacc_depots_comptes || null,
    bodacc_derniere_modification: bodaccData.bodacc_derniere_modification || null,
  };

  await sql`
    INSERT INTO enrichissement_entreprise (
      siren, forme_juridique, date_creation, tranche_effectifs,
      chiffre_affaires, resultat_net, adresse_siege, code_naf, libelle_naf,
      dirigeants, telephone, site_web, email, note_google, horaires, avis_count,
      google_place_id, enrichi_par, source,
      etat_administratif, date_fermeture, nom_complet, nom_raison_sociale, sigle,
      siret_siege, code_postal_siege, libelle_commune_siege, latitude_siege, longitude_siege,
      categorie_entreprise, caractere_employeur, nombre_etablissements, nombre_etablissements_ouverts,
      section_activite_principale, activite_principale_naf25, annee_tranche_effectif,
      est_bio, est_entrepreneur_individuel, est_ess, est_rge, est_societe_mission,
      convention_collective_renseignee, liste_idcc, complements,
      dirigeants_complet, finances_historique,
      google_business_status, google_formatted_address, google_maps_uri, google_types, google_primary_type,
      insee_periodes_historique, insee_date_dernier_traitement, insee_nombre_periodes,
      bodacc_procedures, bodacc_depots_comptes, bodacc_derniere_modification
    ) VALUES (
      ${record.siren}, ${record.forme_juridique}, ${record.date_creation}, ${record.tranche_effectifs},
      ${record.chiffre_affaires}, ${record.resultat_net}, ${record.adresse_siege}, ${record.code_naf}, ${record.libelle_naf},
      ${record.dirigeants ? sql.json(record.dirigeants) : null},
      ${record.telephone}, ${record.site_web}, ${record.email}, ${record.note_google}, ${record.horaires}, ${record.avis_count},
      ${record.google_place_id}, ${record.enrichi_par}, ${record.source},
      ${record.etat_administratif}, ${record.date_fermeture}, ${record.nom_complet}, ${record.nom_raison_sociale}, ${record.sigle},
      ${record.siret_siege}, ${record.code_postal_siege}, ${record.libelle_commune_siege}, ${record.latitude_siege}, ${record.longitude_siege},
      ${record.categorie_entreprise}, ${record.caractere_employeur}, ${record.nombre_etablissements}, ${record.nombre_etablissements_ouverts},
      ${record.section_activite_principale}, ${record.activite_principale_naf25}, ${record.annee_tranche_effectif},
      ${record.est_bio}, ${record.est_entrepreneur_individuel}, ${record.est_ess}, ${record.est_rge}, ${record.est_societe_mission},
      ${record.convention_collective_renseignee},
      ${record.liste_idcc ? sql.json(record.liste_idcc) : null},
      ${record.complements ? sql.json(record.complements) : null},
      ${record.dirigeants_complet ? sql.json(record.dirigeants_complet) : null},
      ${record.finances_historique ? sql.json(record.finances_historique) : null},
      ${record.google_business_status}, ${record.google_formatted_address}, ${record.google_maps_uri},
      ${record.google_types ? sql.json(record.google_types) : null},
      ${record.google_primary_type},
      ${record.insee_periodes_historique ? sql.json(record.insee_periodes_historique) : null},
      ${record.insee_date_dernier_traitement}, ${record.insee_nombre_periodes},
      ${record.bodacc_procedures ? sql.json(record.bodacc_procedures) : null},
      ${record.bodacc_depots_comptes ? sql.json(record.bodacc_depots_comptes) : null},
      ${record.bodacc_derniere_modification ? sql.json(record.bodacc_derniere_modification) : null}
    )
    ON CONFLICT (siren) DO UPDATE SET
      forme_juridique = EXCLUDED.forme_juridique,
      date_creation = EXCLUDED.date_creation,
      tranche_effectifs = EXCLUDED.tranche_effectifs,
      chiffre_affaires = EXCLUDED.chiffre_affaires,
      resultat_net = EXCLUDED.resultat_net,
      adresse_siege = EXCLUDED.adresse_siege,
      code_naf = EXCLUDED.code_naf,
      libelle_naf = EXCLUDED.libelle_naf,
      dirigeants = EXCLUDED.dirigeants,
      telephone = EXCLUDED.telephone,
      site_web = EXCLUDED.site_web,
      note_google = EXCLUDED.note_google,
      horaires = EXCLUDED.horaires,
      avis_count = EXCLUDED.avis_count,
      google_place_id = EXCLUDED.google_place_id,
      enrichi_par = EXCLUDED.enrichi_par,
      enrichi_at = NOW(),
      source = EXCLUDED.source,
      etat_administratif = EXCLUDED.etat_administratif,
      date_fermeture = EXCLUDED.date_fermeture,
      nom_complet = EXCLUDED.nom_complet,
      nom_raison_sociale = EXCLUDED.nom_raison_sociale,
      sigle = EXCLUDED.sigle,
      siret_siege = EXCLUDED.siret_siege,
      code_postal_siege = EXCLUDED.code_postal_siege,
      libelle_commune_siege = EXCLUDED.libelle_commune_siege,
      latitude_siege = EXCLUDED.latitude_siege,
      longitude_siege = EXCLUDED.longitude_siege,
      categorie_entreprise = EXCLUDED.categorie_entreprise,
      caractere_employeur = EXCLUDED.caractere_employeur,
      nombre_etablissements = EXCLUDED.nombre_etablissements,
      nombre_etablissements_ouverts = EXCLUDED.nombre_etablissements_ouverts,
      section_activite_principale = EXCLUDED.section_activite_principale,
      activite_principale_naf25 = EXCLUDED.activite_principale_naf25,
      annee_tranche_effectif = EXCLUDED.annee_tranche_effectif,
      est_bio = EXCLUDED.est_bio,
      est_entrepreneur_individuel = EXCLUDED.est_entrepreneur_individuel,
      est_ess = EXCLUDED.est_ess,
      est_rge = EXCLUDED.est_rge,
      est_societe_mission = EXCLUDED.est_societe_mission,
      convention_collective_renseignee = EXCLUDED.convention_collective_renseignee,
      liste_idcc = EXCLUDED.liste_idcc,
      complements = EXCLUDED.complements,
      dirigeants_complet = EXCLUDED.dirigeants_complet,
      finances_historique = EXCLUDED.finances_historique,
      google_business_status = EXCLUDED.google_business_status,
      google_formatted_address = EXCLUDED.google_formatted_address,
      google_maps_uri = EXCLUDED.google_maps_uri,
      google_types = EXCLUDED.google_types,
      google_primary_type = EXCLUDED.google_primary_type,
      insee_periodes_historique = EXCLUDED.insee_periodes_historique,
      insee_date_dernier_traitement = EXCLUDED.insee_date_dernier_traitement,
      insee_nombre_periodes = EXCLUDED.insee_nombre_periodes,
      bodacc_procedures = EXCLUDED.bodacc_procedures,
      bodacc_depots_comptes = EXCLUDED.bodacc_depots_comptes,
      bodacc_derniere_modification = EXCLUDED.bodacc_derniere_modification
  `;

  const saved = await sql`
    SELECT * FROM enrichissement_entreprise WHERE siren = ${siren}
  `;

  return NextResponse.json({
    data: saved[0] || record,
    cached: false,
    enrichissement: {
      synthese,
      champs_remplis: champsRemplis,
      champs_total: champsTotal,
      sources,
      erreurs: {
        ...(gouvError ? { gouv: gouvError } : {}),
        ...(inseeError ? { insee: inseeError } : {}),
        ...(googleError ? { google: googleError } : {}),
        ...(bodaccError ? { bodacc: bodaccError } : {}),
      },
    },
  });
}

// ======================================================
// GET : consulter l'etat des quotas API
// ======================================================

export async function GET() {
  const mois = await getCurrentMonth();
  const rows = await sql`
    SELECT api_name, appels, limite_mensuelle, updated_at
    FROM api_usage WHERE mois = ${mois}
    ORDER BY api_name
  `;

  const usage: Record<string, { appels: number; limite: number; restant: number; depasse: boolean }> = {};
  for (const row of rows) {
    usage[row.api_name] = {
      appels: row.appels,
      limite: row.limite_mensuelle,
      restant: Math.max(0, row.limite_mensuelle - row.appels),
      depasse: row.appels >= row.limite_mensuelle,
    };
  }

  return NextResponse.json({
    mois,
    usage,
    note: "L'API gouv et BODACC sont gratuites et illimitees. Seul Google Places est suivi ici (quota mensuel).",
  });
}
