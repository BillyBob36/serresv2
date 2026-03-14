import { NextRequest, NextResponse } from "next/server";
import sql from "@/lib/db";

const PAPPERS_API_KEY = process.env.PAPPERS_API_KEY || "";
const GOOGLE_PLACES_API_KEY = process.env.GOOGLE_PLACES_API_KEY || "";

export async function POST(request: NextRequest) {
  const body = await request.json();
  const { siren, nom_entreprise, lat, lon } = body;

  if (!siren) {
    return NextResponse.json({ error: "siren requis" }, { status: 400 });
  }

  // Vérifier si déjà enrichi en BDD
  const existing = await sql`
    SELECT * FROM enrichissement_entreprise WHERE siren = ${siren}
  `;

  if (existing.length > 0) {
    return NextResponse.json({ data: existing[0], cached: true });
  }

  // Récupérer user_id depuis le cookie
  let userId: number | null = null;
  const session = request.cookies.get("serres_session")?.value;
  if (session) {
    try {
      const decoded = JSON.parse(Buffer.from(session, "base64").toString());
      userId = decoded.id;
    } catch {}
  }

  let pappersData: any = {};
  let googleData: any = {};
  let source = "";

  let pappersError = "";
  let googleError = "";

  // --- Pappers ---
  if (PAPPERS_API_KEY) {
    try {
      const resp = await fetch(
        `https://api.pappers.fr/v2/entreprise?siren=${siren}&api_token=${PAPPERS_API_KEY}`,
        { signal: AbortSignal.timeout(15000) }
      );
      if (resp.ok) {
        const json = await resp.json();
        pappersData = {
          forme_juridique: json.forme_juridique || null,
          date_creation: json.date_creation || null,
          tranche_effectifs: json.tranche_effectifs || json.effectif || null,
          chiffre_affaires: json.derniers_comptes?.chiffre_affaires || json.finances?.dernier_chiffre_affaires || null,
          resultat_net: json.derniers_comptes?.resultat || json.finances?.dernier_resultat || null,
          adresse_siege: json.siege?.adresse_ligne_1
            ? `${json.siege.adresse_ligne_1}, ${json.siege.code_postal || ""} ${json.siege.ville || ""}`.trim()
            : null,
          code_naf: json.code_naf || null,
          libelle_naf: json.libelle_code_naf || null,
          dirigeants: json.representants
            ? json.representants.map((r: any) => ({
                nom: r.nom || r.nom_complet || "",
                prenom: r.prenom || "",
                qualite: r.qualite || r.fonction || "",
              }))
            : null,
        };
        source = "pappers";
      } else {
        const errBody = await resp.text().catch(() => "");
        pappersError = `HTTP ${resp.status}: ${errBody.slice(0, 200)}`;
        console.error(`Pappers ${resp.status} pour siren=${siren}: ${errBody.slice(0, 300)}`);
      }
    } catch (err) {
      pappersError = String(err);
      console.error("Pappers error:", err);
    }
  } else {
    pappersError = "Cle API manquante";
  }

  // --- Google Places (New API v1) ---
  if (GOOGLE_PLACES_API_KEY && nom_entreprise) {
    try {
      const searchBody: any = { textQuery: nom_entreprise };
      if (lat && lon) {
        searchBody.locationBias = { circle: { center: { latitude: lat, longitude: lon }, radius: 5000.0 } };
      }

      // Text Search (New)
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
          source = source ? "both" : "google";
          console.log(`Google Places OK pour "${nom_entreprise}": place=${place.displayName?.text || place.id}`);
        } else {
          googleError = "Aucun resultat trouve";
          console.log(`Google Places: aucun resultat pour "${nom_entreprise}"`);
        }
      } else {
        const errBody = await findResp.text().catch(() => "");
        googleError = `HTTP ${findResp.status}: ${errBody.slice(0, 200)}`;
        console.error(`Google Places ${findResp.status} pour "${nom_entreprise}": ${errBody.slice(0, 300)}`);
      }
    } catch (err) {
      googleError = String(err);
      console.error("Google Places error:", err);
    }
  } else if (!GOOGLE_PLACES_API_KEY) {
    googleError = "Cle API manquante";
  } else {
    googleError = "Pas de nom entreprise";
  }

  // Si aucune source n'a retourné de données, ne pas sauvegarder et retourner une erreur
  if (!source) {
    const details = [`Pappers: ${pappersError || "echec"}`, `Google: ${googleError || "echec"}`].join(" | ");
    console.error(`Enrichissement echoue siren=${siren}: ${details}`);
    return NextResponse.json({ error: `Enrichissement echoue. ${details}`, data: null }, { status: 422 });
  }

  // Insérer en BDD
  const record = {
    siren,
    ...pappersData,
    ...googleData,
    enrichi_par: userId,
    source,
  };

  await sql`
    INSERT INTO enrichissement_entreprise (
      siren, forme_juridique, date_creation, tranche_effectifs,
      chiffre_affaires, resultat_net, adresse_siege, code_naf, libelle_naf,
      dirigeants, telephone, site_web, email, note_google, horaires, avis_count,
      google_place_id, enrichi_par, source
    ) VALUES (
      ${record.siren},
      ${record.forme_juridique || null},
      ${record.date_creation || null},
      ${record.tranche_effectifs || null},
      ${record.chiffre_affaires || null},
      ${record.resultat_net || null},
      ${record.adresse_siege || null},
      ${record.code_naf || null},
      ${record.libelle_naf || null},
      ${record.dirigeants ? JSON.stringify(record.dirigeants) : null},
      ${record.telephone || null},
      ${record.site_web || null},
      ${record.email || null},
      ${record.note_google || null},
      ${record.horaires || null},
      ${record.avis_count || null},
      ${record.google_place_id || null},
      ${record.enrichi_par || null},
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

  // Re-read from DB to return clean data
  const saved = await sql`
    SELECT * FROM enrichissement_entreprise WHERE siren = ${siren}
  `;

  return NextResponse.json({ data: saved[0] || record, cached: false });
}
