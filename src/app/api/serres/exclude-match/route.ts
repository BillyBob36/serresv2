import { NextRequest, NextResponse } from "next/server";
import sql from "@/lib/db";
// Force dynamic — never cache API routes
export const dynamic = "force-dynamic";


export async function PATCH(request: NextRequest) {
  const body = await request.json();
  const { serre_id, siren, excluded } = body;

  if (!serre_id || !siren) {
    return NextResponse.json({ error: "serre_id et siren requis" }, { status: 400 });
  }

  await sql`
    UPDATE serre_matches
    SET excluded = ${excluded === true}
    WHERE serre_id = ${serre_id} AND siren = ${siren}
  `;

  return NextResponse.json({ ok: true });
}
