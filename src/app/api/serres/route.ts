import { NextRequest, NextResponse } from "next/server";
import sql from "@/lib/db";
import type { SerresFilters, SerresResponse } from "@/lib/types";

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;

  const filters: SerresFilters = {
    departement: params.get("departement") || undefined,
    code_cultu: params.get("code_cultu") || undefined,
    surface_min: params.get("surface_min")
      ? Number(params.get("surface_min"))
      : undefined,
    surface_max: params.get("surface_max")
      ? Number(params.get("surface_max"))
      : undefined,
    avec_entreprise:
      params.get("avec_entreprise") === "true" ? true : undefined,
    search: params.get("search") || undefined,
    page: Number(params.get("page")) || 1,
    per_page: Math.min(Number(params.get("per_page")) || 50, 200),
    sort_by: params.get("sort_by") || "departement",
    sort_order:
      (params.get("sort_order") as "asc" | "desc") || "asc",
  };

  const offset = ((filters.page || 1) - 1) * (filters.per_page || 50);

  // Construction des conditions WHERE
  const conditions: string[] = [];
  const values: (string | number | boolean)[] = [];
  let paramIdx = 1;

  if (filters.departement) {
    conditions.push(`s.departement = $${paramIdx++}`);
    values.push(filters.departement);
  }
  if (filters.code_cultu) {
    conditions.push(`s.code_cultu = $${paramIdx++}`);
    values.push(filters.code_cultu);
  }
  if (filters.surface_min !== undefined) {
    conditions.push(`s.surface_ha >= $${paramIdx++}`);
    values.push(filters.surface_min);
  }
  if (filters.surface_max !== undefined) {
    conditions.push(`s.surface_ha <= $${paramIdx++}`);
    values.push(filters.surface_max);
  }
  if (filters.avec_entreprise) {
    conditions.push(`s.siren IS NOT NULL`);
  }
  if (filters.search) {
    conditions.push(
      `(s.commune ILIKE $${paramIdx} OR s.nom_entreprise ILIKE $${paramIdx} OR s.dirigeant_nom ILIKE $${paramIdx})`
    );
    values.push(`%${filters.search}%`);
    paramIdx++;
  }

  const statut = params.get("statut");
  if (statut) {
    conditions.push(`EXISTS (SELECT 1 FROM prospection p WHERE p.serre_id = s.id AND p.statut = $${paramIdx++})`);
    values.push(statut);
  }

  const whereClause =
    conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

  // Allowed sort columns to prevent SQL injection
  const allowedSorts = [
    "departement",
    "commune",
    "surface_ha",
    "code_cultu",
    "nom_entreprise",
    "distance_km",
  ];
  const sortCol = allowedSorts.includes(filters.sort_by || "")
    ? `s.${filters.sort_by}`
    : "s.departement";
  const sortDir = filters.sort_order === "desc" ? "DESC" : "ASC";

  // Use tagged template for safe queries
  const countResult = await sql.unsafe(
    `SELECT COUNT(*) as total FROM serres s ${whereClause}`,
    values
  );
  const total = Number(countResult[0].total);

  const data = await sql.unsafe(
    `SELECT s.id, s.id_parcel, s.code_cultu, s.code_group, s.surface_ha, s.surface_osm_m2,
            s.centroid_lat, s.centroid_lon, s.osm_centroid_lat, s.osm_centroid_lon,
            s.commune, s.code_postal, s.departement,
            s.annee_rpg, s.siren, s.siret, s.nom_entreprise, s.dirigeant_nom,
            s.dirigeant_prenom, s.adresse_entreprise, s.distance_km, s.match_confiance,
            b.batiment_groupe_id as bdnb_id,
            b.nature as bdnb_nature,
            b.surface_m2 as bdnb_surface_m2,
            b.hauteur_moy as bdnb_hauteur_moy,
            b.hauteur_max as bdnb_hauteur_max,
            b.etat as bdnb_etat,
            b.parcelle_id as bdnb_parcelle,
            b.proprietaire_siren as bdnb_prop_siren,
            b.proprietaire_denomination as bdnb_prop_nom,
            b.proprietaire_forme_juridique as bdnb_prop_forme,
            b.adresse as bdnb_adresse,
            b.distance_rpg_m as bdnb_distance_m,
            (SELECT COALESCE(json_agg(row_to_json(m) ORDER BY m.rang), '[]'::json)
             FROM serre_matches m WHERE m.serre_id = s.id) as top_matches
     FROM serres s
     LEFT JOIN LATERAL (
       SELECT * FROM bdnb_serres b2
       WHERE b2.serre_rpg_id = s.id
       ORDER BY b2.distance_rpg_m ASC NULLS LAST
       LIMIT 1
     ) b ON true
     ${whereClause}
     ORDER BY ${sortCol} ${sortDir} NULLS LAST
     LIMIT $${paramIdx++} OFFSET $${paramIdx++}`,
    [...values, filters.per_page || 50, offset]
  );

  const response: SerresResponse = {
    data: data as unknown as SerresResponse["data"],
    total,
    page: filters.page || 1,
    per_page: filters.per_page || 50,
    total_pages: Math.ceil(total / (filters.per_page || 50)),
  };

  return NextResponse.json(response);
}
