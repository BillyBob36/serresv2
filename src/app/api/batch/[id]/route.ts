import { NextRequest, NextResponse } from "next/server";
import sql from "@/lib/db";

// GET: get batch detail with API statuses
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const batchId = parseInt(id, 10);
  if (!batchId) return NextResponse.json({ error: "ID invalide" }, { status: 400 });

  const batch = await sql`
    SELECT * FROM enrichissement_batch WHERE id = ${batchId}
  `;
  if (batch.length === 0) {
    return NextResponse.json({ error: "Batch non trouve" }, { status: 404 });
  }

  const apis = await sql`
    SELECT * FROM enrichissement_batch_api
    WHERE batch_id = ${batchId}
    ORDER BY api_name
  `;

  // Count per-API data
  const counts: Record<string, number> = {};
  for (const api of apis) {
    const table = apiTable(api.api_name);
    if (table) {
      const c = await sql.unsafe(`SELECT COUNT(*) as n FROM ${table} WHERE batch_id = ${batchId}`);
      counts[api.api_name] = Number(c[0]?.n || 0);
    }
  }

  return NextResponse.json({
    data: {
      ...batch[0],
      apis: apis.map((a: any) => ({
        ...a,
        data_count: counts[a.api_name] || 0,
      })),
    },
  });
}

// DELETE: delete a batch and all its data
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const batchId = parseInt(id, 10);
  if (!batchId) return NextResponse.json({ error: "ID invalide" }, { status: 400 });

  await sql`DELETE FROM enrichissement_batch WHERE id = ${batchId}`;
  return NextResponse.json({ ok: true });
}

function apiTable(apiName: string): string | null {
  const map: Record<string, string> = {
    api_gouv: "data_api_gouv",
    insee: "data_insee",
    google_places: "data_google_places",
    bodacc: "data_bodacc",
    pages_jaunes: "data_pages_jaunes",
  };
  return map[apiName] || null;
}
