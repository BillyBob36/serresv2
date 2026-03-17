import { NextRequest, NextResponse } from "next/server";
import sql from "@/lib/db";

// GET: lire les notes d'un prospect (par siren)
export async function GET(request: NextRequest) {
  const siren = request.nextUrl.searchParams.get("siren");
  if (!siren) {
    return NextResponse.json({ data: [] });
  }

  const data = await sql`
    SELECT n.id, n.siren, n.note, n.created_at, u.username
    FROM prospection_notes n
    LEFT JOIN users u ON u.id = n.user_id
    WHERE n.siren = ${siren}
    ORDER BY n.created_at DESC
  `;

  return NextResponse.json({ data });
}

// POST: ajouter une note à un prospect
export async function POST(request: NextRequest) {
  const body = await request.json();
  const { siren, note } = body;

  if (!siren || !note) {
    return NextResponse.json({ error: "siren et note requis" }, { status: 400 });
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
    INSERT INTO prospection_notes (siren, user_id, note)
    VALUES (${siren}, ${userId}, ${note})
  `;

  return NextResponse.json({ ok: true });
}
