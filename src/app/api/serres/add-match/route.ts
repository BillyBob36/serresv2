import { NextRequest, NextResponse } from "next/server";
import sql from "@/lib/db";

export async function POST(request: NextRequest) {
  const body = await request.json();
  const { serre_id, lat, lon } = body;

  if (!serre_id || !lat || !lon) {
    return NextResponse.json({ error: "serre_id, lat et lon requis" }, { status: 400 });
  }

  // Recuperer les SIREN deja associes a cette serre
  const existingMatches = await sql`
    SELECT siren FROM serre_matches WHERE serre_id = ${serre_id}
  `;
  const existingSirens = existingMatches.map((r: any) => r.siren);

  // Recuperer le rang max actuel
  const maxRangResult = await sql`
    SELECT COALESCE(MAX(rang), 0) as max_rang FROM serre_matches WHERE serre_id = ${serre_id}
  `;
  const nextRang = Number(maxRangResult[0].max_rang) + 1;

  if (nextRang > 10) {
    return NextResponse.json({ error: "Maximum 10 prospects par serre" }, { status: 400 });
  }

  // Chercher l'entreprise agricole la plus proche non deja associee
  // Utilise Haversine en SQL pour calculer la distance
  let candidates;
  if (existingSirens.length > 0) {
    candidates = await sql`
      SELECT siren, siret_siege, nom, dirigeant_nom, dirigeant_prenom, commune,
              (6371 * acos(LEAST(1.0,
                cos(radians(${lat})) * cos(radians(latitude)) *
                cos(radians(longitude) - radians(${lon})) +
                sin(radians(${lat})) * sin(radians(latitude))
              ))) as distance_km
       FROM entreprises_agri
       WHERE latitude IS NOT NULL AND longitude IS NOT NULL
         AND siren IS NOT NULL
         AND siren != ALL(${existingSirens})
       ORDER BY distance_km ASC
       LIMIT 1
    `;
  } else {
    candidates = await sql`
      SELECT siren, siret_siege, nom, dirigeant_nom, dirigeant_prenom, commune,
              (6371 * acos(LEAST(1.0,
                cos(radians(${lat})) * cos(radians(latitude)) *
                cos(radians(longitude) - radians(${lon})) +
                sin(radians(${lat})) * sin(radians(latitude))
              ))) as distance_km
       FROM entreprises_agri
       WHERE latitude IS NOT NULL AND longitude IS NOT NULL
         AND siren IS NOT NULL
       ORDER BY distance_km ASC
       LIMIT 1
    `;
  }

  if (candidates.length === 0) {
    return NextResponse.json({ error: "Aucune entreprise agricole supplementaire trouvee a proximite" }, { status: 404 });
  }

  const best = candidates[0];
  const distanceKm = Math.round(Number(best.distance_km) * 100) / 100;

  // Determiner la confiance
  let confiance = "basse";
  if (distanceKm < 2) confiance = "haute";
  else if (distanceKm < 5) confiance = "moyenne";

  // Inserer dans serre_matches
  await sql`
    INSERT INTO serre_matches (serre_id, rang, siren, siret, nom_entreprise, dirigeant_nom, dirigeant_prenom, commune_entreprise, distance_km, confiance)
    VALUES (${serre_id}, ${nextRang}, ${best.siren}, ${best.siret_siege}, ${best.nom}, ${best.dirigeant_nom}, ${best.dirigeant_prenom}, ${best.commune}, ${distanceKm}, ${confiance})
    ON CONFLICT (serre_id, rang) DO UPDATE SET
      siren = EXCLUDED.siren,
      siret = EXCLUDED.siret,
      nom_entreprise = EXCLUDED.nom_entreprise,
      dirigeant_nom = EXCLUDED.dirigeant_nom,
      dirigeant_prenom = EXCLUDED.dirigeant_prenom,
      commune_entreprise = EXCLUDED.commune_entreprise,
      distance_km = EXCLUDED.distance_km,
      confiance = EXCLUDED.confiance
  `;

  return NextResponse.json({
    ok: true,
    match: {
      serre_id,
      rang: nextRang,
      siren: best.siren,
      nom_entreprise: best.nom,
      distance_km: distanceKm,
      confiance,
    },
  });
}
