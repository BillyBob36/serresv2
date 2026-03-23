import { NextRequest, NextResponse } from "next/server";
import sql from "@/lib/db";
// Force dynamic — never cache API routes
export const dynamic = "force-dynamic";


const API_NAMES = ["api_gouv", "insee", "google_places", "bodacc", "pages_jaunes"];

// GET: list all batches
export async function GET() {
  const batches = await sql`
    SELECT b.id, b.nom, b.created_at, b.created_by,
           COALESCE(json_agg(
             json_build_object(
               'api_name', ba.api_name,
               'statut', ba.statut,
               'nb_total', ba.nb_total,
               'nb_enrichis', ba.nb_enrichis,
               'nb_erreurs', ba.nb_erreurs,
               'started_at', ba.started_at,
               'completed_at', ba.completed_at
             ) ORDER BY ba.api_name
           ) FILTER (WHERE ba.id IS NOT NULL), '[]') as apis
    FROM enrichissement_batch b
    LEFT JOIN enrichissement_batch_api ba ON ba.batch_id = b.id
    GROUP BY b.id
    ORDER BY b.created_at DESC
  `;

  return NextResponse.json({ data: batches });
}

// POST: create a new batch
export async function POST(request: NextRequest) {
  let userId: number | null = null;
  const session = request.cookies.get("serres_session")?.value;
  if (session) {
    try {
      const decoded = JSON.parse(Buffer.from(session, "base64").toString());
      userId = decoded.id;
    } catch {}
  }

  const today = new Date().toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit", year: "numeric" });
  const nom = `Enrichissement ${today}`;

  const result = await sql`
    INSERT INTO enrichissement_batch (nom, created_by)
    VALUES (${nom}, ${userId})
    RETURNING id, nom, created_at
  `;

  const batchId = result[0].id;

  // Create entries for each API
  for (const apiName of API_NAMES) {
    await sql`
      INSERT INTO enrichissement_batch_api (batch_id, api_name, statut)
      VALUES (${batchId}, ${apiName}, 'pending')
    `;
  }

  return NextResponse.json({ data: result[0] }, { status: 201 });
}
