import { NextRequest, NextResponse } from "next/server";
import sql from "@/lib/db";

const PAPPERS_API_KEY = process.env.PAPPERS_API_KEY || "";
const GOOGLE_PLACES_API_KEY = process.env.GOOGLE_PLACES_API_KEY || "";

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
  const label = apiName === "google_places" ? "Google Places" : "Pappers";
  return `Quota ${label} atteint : ${appels}/${limite} appels ce mois-ci. Les donnees gratuites ont ete depassees. Reessayez le mois prochain ou augmentez la limite dans la table api_usage.`;
}

// =============================================
// SOURCES DE DONNEES (par ordre de priorite)
//
// 1. API Gouv (GRATUIT, ILLIMITE) → forme juridique, NAF, effectifs,
//    adresse, dirigeants, date creation, CA, resultat net
// 2. Pappers (PAYANT) → CA + resultat net UNIQUEMENT si l'API Gouv
//    ne les a pas retournes
// 3. Google Places (PAYANT, 4800/mois gratuit) → telephone, site web,
//    note Google, horaires, avis
// =============================================

export async function POST(request: NextRequest) {
  const body = await request.json();
  const { siren, nom_entreprise, lat, lon } = body;

  if (!siren) {
    return NextResponse.json({ error: "siren requis" }, { status: 400 });
  }

  // Verifier si deja enrichi en BDD
  const existing = await sql`
    SELECT * FROM enrichissement_entreprise WHERE siren = ${siren}
  `;

  if (existing.length > 0) {
    return NextResponse.json({ data: existing[0], cached: true });
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
  let pappersData: any = {};
  let googleData: any = {};
  const sources: string[] = [];

  let gouvError = "";
  let pappersError = "";
  let googleError = "";

  // ======================================================
  // ETAPE 1 : API Gouvernement (GRATUIT, ILLIMITE)
  // https://recherche-entreprises.api.gouv.fr
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

        // Finances : prendre l'annee la plus recente
        let chiffreAffaires: number | null = null;
        let resultatNet: number | null = null;
        if (entreprise.finances) {
          const annees = Object.keys(entreprise.finances).sort().reverse();
          if (annees.length > 0) {
            const dernier = entreprise.finances[annees[0]];
            chiffreAffaires = dernier.ca ?? null;
            resultatNet = dernier.resultat_net ?? null;
          }
        }

        // Dirigeants
        const dirigeants = entreprise.dirigeants
          ?.filter((d: any) => d.type_dirigeant === "personne physique")
          ?.map((d: any) => ({
            nom: d.nom || "",
            prenom: d.prenoms || "",
            qualite: d.qualite || "",
          })) || null;

        // Adresse
        const adresse = entreprise.siege?.geo_adresse || entreprise.siege?.adresse || null;

        gouvData = {
          forme_juridique: formeJuridique,
          date_creation: entreprise.date_creation || null,
          tranche_effectifs: trancheEffectifs,
          chiffre_affaires: chiffreAffaires,
          resultat_net: resultatNet,
          adresse_siege: adresse,
          code_naf: entreprise.activite_principale || null,
          libelle_naf: null, // l'API gouv ne retourne pas le libelle NAF
          dirigeants,
        };
        sources.push("gouv");
        console.log(`[GOUV] OK siren=${siren}: ${entreprise.nom_complet}, CA=${chiffreAffaires}, forme=${formeJuridique}`);
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
  // ETAPE 2 : Pappers (PAYANT) — UNIQUEMENT pour le CA
  // On n'appelle Pappers que si l'API gouv n'a pas retourne
  // le chiffre d'affaires
  // ======================================================
  const besoinCA = !gouvData.chiffre_affaires && !gouvData.resultat_net;

  if (besoinCA && PAPPERS_API_KEY) {
    const pappersUsage = await getApiUsage("pappers");
    if (pappersUsage.appels >= pappersUsage.limite) {
      pappersError = formatUsageMessage("pappers", pappersUsage.appels, pappersUsage.limite);
      console.warn(`[QUOTA] Pappers : ${pappersUsage.appels}/${pappersUsage.limite}`);
    } else {
      try {
        const resp = await fetch(
          `https://api.pappers.fr/v2/entreprise?siren=${siren}&api_token=${PAPPERS_API_KEY}`,
          { signal: AbortSignal.timeout(15000) }
        );
        if (resp.ok) {
          await incrementApiUsage("pappers");
          const json = await resp.json();
          pappersData = {
            chiffre_affaires: json.derniers_comptes?.chiffre_affaires || json.finances?.dernier_chiffre_affaires || null,
            resultat_net: json.derniers_comptes?.resultat || json.finances?.dernier_resultat || null,
          };
          if (pappersData.chiffre_affaires || pappersData.resultat_net) {
            sources.push("pappers");
          }
          console.log(`[PAPPERS] CA fallback siren=${siren}: CA=${pappersData.chiffre_affaires}`);
        } else {
          const errBody = await resp.text().catch(() => "");
          pappersError = `HTTP ${resp.status}: ${errBody.slice(0, 200)}`;
          console.error(`[PAPPERS] ${resp.status} pour siren=${siren}`);
        }
      } catch (err) {
        pappersError = String(err);
        console.error("[PAPPERS] Erreur:", err);
      }
    }
  } else if (besoinCA && !PAPPERS_API_KEY) {
    pappersError = "Cle API manquante (CA non disponible via API gouv)";
  } else if (!besoinCA) {
    console.log(`[PAPPERS] Non appele — CA deja obtenu via API gouv (${gouvData.chiffre_affaires})`);
  }

  // ======================================================
  // ETAPE 3 : Google Places (PAYANT, 4800/mois gratuit)
  // Telephone, site web, note Google, horaires, avis
  // ======================================================
  if (GOOGLE_PLACES_API_KEY && nom_entreprise) {
    const googleUsage = await getApiUsage("google_places");
    if (googleUsage.appels >= googleUsage.limite) {
      googleError = formatUsageMessage("google_places", googleUsage.appels, googleUsage.limite);
      console.warn(`[QUOTA] Google Places : ${googleUsage.appels}/${googleUsage.limite}`);
    } else {
      try {
        const searchBody: any = { textQuery: nom_entreprise };
        if (lat && lon) {
          searchBody.locationBias = { circle: { center: { latitude: lat, longitude: lon }, radius: 5000.0 } };
        }

        const findResp = await fetch(
          "https://places.googleapis.com/v1/places:searchText",
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "X-Goog-Api-Key": GOOGLE_PLACES_API_KEY,
              "X-Goog-FieldMask": "places.id,places.displayName,places.nationalPhoneNumber,places.internationalPhoneNumber,places.websiteUri,places.rating,places.userRatingCount,places.regularOpeningHours",
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
            googleData = {
              telephone: place.internationalPhoneNumber || place.nationalPhoneNumber || null,
              site_web: place.websiteUri || null,
              note_google: place.rating || null,
              avis_count: place.userRatingCount || null,
              horaires: place.regularOpeningHours?.weekdayDescriptions?.join(" | ") || null,
              google_place_id: place.id || null,
            };
            sources.push("google");
            console.log(`[GOOGLE] OK pour "${nom_entreprise}": ${place.displayName?.text || place.id}`);
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
          console.error(`[GOOGLE] ${findResp.status} pour "${nom_entreprise}"`);
        }
      } catch (err) {
        googleError = String(err);
        console.error("[GOOGLE] Erreur:", err);
      }
    }
  } else if (!GOOGLE_PLACES_API_KEY) {
    googleError = "Cle API manquante";
  } else {
    googleError = "Pas de nom entreprise";
  }

  // ======================================================
  // Resultat : fusionner les sources (gouv prioritaire)
  // ======================================================
  if (sources.length === 0) {
    const details = [
      `Gouv: ${gouvError || "echec"}`,
      `Pappers: ${pappersError || "non appele"}`,
      `Google: ${googleError || "echec"}`,
    ].join(" | ");
    const isQuotaError = pappersError.includes("Quota") || googleError.includes("Quota");
    console.error(`Enrichissement echoue siren=${siren}: ${details}`);
    return NextResponse.json(
      { error: isQuotaError ? details : `Enrichissement echoue. ${details}`, data: null, quota_exceeded: isQuotaError },
      { status: isQuotaError ? 429 : 422 }
    );
  }

  // Fusion : gouvData est la base, Pappers complete le CA, Google ajoute contact
  const record = {
    siren,
    forme_juridique: gouvData.forme_juridique || null,
    date_creation: gouvData.date_creation || null,
    tranche_effectifs: gouvData.tranche_effectifs || null,
    chiffre_affaires: gouvData.chiffre_affaires || pappersData.chiffre_affaires || null,
    resultat_net: gouvData.resultat_net || pappersData.resultat_net || null,
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
    source: sources.join("+"),  // ex: "gouv+google", "gouv+pappers+google"
  };

  await sql`
    INSERT INTO enrichissement_entreprise (
      siren, forme_juridique, date_creation, tranche_effectifs,
      chiffre_affaires, resultat_net, adresse_siege, code_naf, libelle_naf,
      dirigeants, telephone, site_web, email, note_google, horaires, avis_count,
      google_place_id, enrichi_par, source
    ) VALUES (
      ${record.siren},
      ${record.forme_juridique},
      ${record.date_creation},
      ${record.tranche_effectifs},
      ${record.chiffre_affaires},
      ${record.resultat_net},
      ${record.adresse_siege},
      ${record.code_naf},
      ${record.libelle_naf},
      ${record.dirigeants ? JSON.stringify(record.dirigeants) : null},
      ${record.telephone},
      ${record.site_web},
      ${record.email},
      ${record.note_google},
      ${record.horaires},
      ${record.avis_count},
      ${record.google_place_id},
      ${record.enrichi_par},
      ${record.source}
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
      source = EXCLUDED.source
  `;

  const saved = await sql`
    SELECT * FROM enrichissement_entreprise WHERE siren = ${siren}
  `;

  return NextResponse.json({ data: saved[0] || record, cached: false });
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
    note: "L'API gouv (recherche-entreprises.api.gouv.fr) est gratuite et illimitee, seuls Pappers et Google Places sont suivis ici.",
  });
}
