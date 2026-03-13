import { NextRequest, NextResponse } from "next/server";
import sql from "@/lib/db";

// GET: lire les notes d'une serre
export async function GET(request: NextRequest) {
  const serreId = request.nextUrl.searchParams.get("serre_id");
  if (!serreId) {
    return NextResponse.json({ data: [] });
  }

  const data = await sql`
    SELECT n.id, n.serre_id, n.note, n.created_at, u.username
    FROM prospection_notes n
    LEFT JOIN users u ON u.id = n.user_id
    WHERE n.serre_id = ${Number(serreId)}
    ORDER BY n.created_at DESC
  `;

  return NextResponse.json({ data });
}

// POST: ajouter une note
export async function POST(request: NextRequest) {
  const body = await request.json();
  const { serre_id, note } = body;

  if (!serre_id || !note) {
    return NextResponse.json({ error: "serre_id et note requis" }, { status: 400 });
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

  await sql`
    INSERT INTO prospection_notes (serre_id, user_id, note)
    VALUES (${serre_id}, ${userId}, ${note})
  `;

  return NextResponse.json({ ok: true });
}
