import { NextRequest, NextResponse } from "next/server";
import sql from "@/lib/db";
// Force dynamic — never cache API routes
export const dynamic = "force-dynamic";


export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;

  const conditions: string[] = [];
  const values: (string | number)[] = [];
  let idx = 1;

  if (params.get("departement")) {
    conditions.push(`departement = $${idx++}`);
    values.push(params.get("departement")!);
  }
  if (params.get("code_cultu")) {
    conditions.push(`code_cultu = $${idx++}`);
    values.push(params.get("code_cultu")!);
  }
  if (params.get("avec_entreprise") === "true") {
    conditions.push(`siren IS NOT NULL`);
  }

  const where =
    conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

  const rows = await sql.unsafe(
    `SELECT
      id_parcel, code_cultu, surface_ha, centroid_lat, centroid_lon,
      commune, code_postal, departement, annee_rpg,
      siren, siret, nom_entreprise, dirigeant_nom, dirigeant_prenom,
      adresse_entreprise, distance_km, match_confiance
    FROM serres
    ${where}
    ORDER BY departement, commune
    LIMIT 50000`,
    values
  );

  // Générer le CSV
  const headers = [
    "ID Parcelle",
    "Type Culture",
    "Surface (ha)",
    "Latitude",
    "Longitude",
    "Commune",
    "Code Postal",
    "Departement",
    "Annee RPG",
    "SIREN",
    "SIRET",
    "Entreprise",
    "Dirigeant Nom",
    "Dirigeant Prenom",
    "Adresse Entreprise",
    "Distance (km)",
    "Confiance Match",
  ];

  const csvLines = [headers.join(";")];

  for (const row of rows) {
    const line = [
      row.id_parcel,
      row.code_cultu,
      row.surface_ha,
      row.centroid_lat,
      row.centroid_lon,
      row.commune,
      row.code_postal,
      row.departement,
      row.annee_rpg,
      row.siren || "",
      row.siret || "",
      row.nom_entreprise || "",
      row.dirigeant_nom || "",
      row.dirigeant_prenom || "",
      row.adresse_entreprise || "",
      row.distance_km || "",
      row.match_confiance || "",
    ]
      .map((v) => `"${String(v ?? "").replace(/"/g, '""')}"`)
      .join(";");
    csvLines.push(line);
  }

  const csv = csvLines.join("\n");

  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="serres-france-${new Date().toISOString().split("T")[0]}.csv"`,
    },
  });
}
