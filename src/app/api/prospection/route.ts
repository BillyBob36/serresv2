import { NextRequest, NextResponse } from "next/server";
import sql from "@/lib/db";

// GET: charger les prospections pour une liste de serre_ids
export async function GET(request: NextRequest) {
  const serreIds = request.nextUrl.searchParams.get("serre_ids");
  if (!serreIds) {
    return NextResponse.json({ data: [] });
  }

  const ids = serreIds.split(",").map(Number).filter(Boolean);
  if (ids.length === 0) {
    return NextResponse.json({ data: [] });
  }

  const data = await sql`
    SELECT serre_id, statut, match_valide FROM prospection
    WHERE serre_id = ANY(${ids})
  `;

  return NextResponse.json({ data });
}

// PATCH: mettre à jour statut ou match_valide
export async function PATCH(request: NextRequest) {
  const body = await request.json();
  const { serre_id, statut, match_valide } = body;

  if (!serre_id) {
    return NextResponse.json({ error: "serre_id requis" }, { status: 400 });
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

  // Upsert
  if (statut) {
    await sql`
      INSERT INTO prospection (serre_id, user_id, statut, updated_at)
      VALUES (${serre_id}, ${userId}, ${statut}, NOW())
      ON CONFLICT (serre_id) DO UPDATE SET statut = ${statut}, user_id = ${userId}, updated_at = NOW()
    `;
  }

  if (match_valide) {
    await sql`
      INSERT INTO prospection (serre_id, user_id, match_valide, updated_at)
      VALUES (${serre_id}, ${userId}, ${match_valide}, NOW())
      ON CONFLICT (serre_id) DO UPDATE SET match_valide = ${match_valide}, user_id = ${userId}, updated_at = NOW()
    `;
  }

  return NextResponse.json({ ok: true });
}
