import { NextRequest, NextResponse } from "next/server";
import sql from "@/lib/db";

export const dynamic = "force-dynamic";

const ALLOWED_SOURCES = [
  "tout",
  "pages_jaunes",
  "api_gouv",
  "google_places",
  "insee",
  "bodacc",
  "enrichissement",
] as const;

type Source = (typeof ALLOWED_SOURCES)[number];

const SOURCE_SQL: Record<Source, string | null> = {
  tout: null,
  pages_jaunes: `EXISTS (SELECT 1 FROM data_pages_jaunes t WHERE t.siren = sm.siren)`,
  api_gouv: `EXISTS (SELECT 1 FROM data_api_gouv t WHERE t.siren = sm.siren)`,
  google_places: `EXISTS (SELECT 1 FROM data_google_places t WHERE t.siren = sm.siren)`,
  insee: `EXISTS (SELECT 1 FROM data_insee t WHERE t.siren = sm.siren)`,
  bodacc: `EXISTS (SELECT 1 FROM data_bodacc t WHERE t.siren = sm.siren)`,
  enrichissement: `EXISTS (SELECT 1 FROM enrichissement_entreprise t WHERE t.siren = sm.siren)`,
};

function csvCell(val: unknown): string {
  if (val === null || val === undefined) return "";
  const s = String(val);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

export async function GET(request: NextRequest) {
  const raw = request.nextUrl.searchParams.get("source") || "tout";
  const source = (ALLOWED_SOURCES.includes(raw as Source) ? raw : "tout") as Source;

  const extra = SOURCE_SQL[source];
  const whereExtra = extra ? `AND ${extra}` : "";

  const rows = await sql.unsafe(
    `SELECT s.id AS serre_id, s.departement, s.commune AS commune_serre, s.code_cultu, s.surface_ha,
            sm.rang AS match_rang, sm.siren, sm.nom_entreprise, sm.dirigeant_prenom, sm.dirigeant_nom,
            sm.commune_entreprise, sm.distance_km, COALESCE(sm.excluded, false) AS exclu,
            pr.statut AS statut_prospection,
            e.nom_complet AS nom_complet_enrichi, e.nom_raison_sociale, e.telephone, e.site_web, e.email,
            e.adresse_siege, e.libelle_commune_siege AS commune_siege, e.code_postal_siege,
            e.code_naf, e.libelle_naf, e.etat_administratif,
            e.google_maps_uri, e.google_formatted_address, e.note_google,
            e.enrichi_at
     FROM serre_matches sm
     INNER JOIN serres s ON s.id = sm.serre_id
     LEFT JOIN prospection pr ON pr.serre_id = sm.serre_id AND pr.siren = sm.siren
     LEFT JOIN enrichissement_entreprise e ON e.siren = sm.siren
     WHERE 1=1 ${whereExtra}
     ORDER BY s.departement NULLS LAST, s.commune NULLS LAST, s.id, sm.rang`
  );

  const headerKeys: [string, string][] = [
    ["serre_id", "serre_id"],
    ["departement", "departement"],
    ["commune_serre", "commune_serre"],
    ["code_cultu", "code_cultu"],
    ["surface_ha", "surface_ha"],
    ["match_rang", "match_rang"],
    ["siren", "siren"],
    ["nom_entreprise", "nom_entreprise"],
    ["dirigeant_prenom", "dirigeant_prenom"],
    ["dirigeant_nom", "dirigeant_nom"],
    ["commune_entreprise", "commune_entreprise"],
    ["distance_km", "distance_km"],
    ["exclu", "exclu"],
    ["statut_prospection", "statut_prospection"],
    ["nom_complet_enrichi", "nom_complet_enrichi"],
    ["nom_raison_sociale", "nom_raison_sociale"],
    ["telephone", "telephone"],
    ["site_web", "site_web"],
    ["email", "email"],
    ["adresse_siege", "adresse_siege"],
    ["commune_siege", "commune_siege"],
    ["code_postal_siege", "code_postal_siege"],
    ["code_naf", "code_naf"],
    ["libelle_naf", "libelle_naf"],
    ["etat_administratif", "etat_administratif"],
    ["google_maps_uri", "google_maps_uri"],
    ["google_formatted_address", "google_formatted_address"],
    ["note_google", "note_google"],
    ["enrichi_at", "enrichi_at"],
  ];

  const lines = [
    headerKeys.map(([h]) => h).join(","),
    ...rows.map((r: Record<string, unknown>) =>
      headerKeys.map(([, k]) => csvCell(r[k])).join(",")
    ),
  ];

  const body = "\uFEFF" + lines.join("\r\n");
  const filename = `prospects_serres_${source}_${new Date().toISOString().slice(0, 10)}.csv`;

  return new NextResponse(body, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
