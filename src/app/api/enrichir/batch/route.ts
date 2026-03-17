import { NextRequest, NextResponse } from "next/server";
import sql from "@/lib/db";

export async function POST(request: NextRequest) {
  const body = await request.json();
  const { sirens } = body;

  if (!sirens || !Array.isArray(sirens) || sirens.length === 0) {
    return NextResponse.json({ data: {} });
  }

  // Limit to 100 sirens per batch
  const batch = sirens.slice(0, 100);

  const rows = await sql`
    SELECT * FROM enrichissement_entreprise WHERE siren = ANY(${batch})
  `;

  const result: Record<string, any> = {};
  for (const row of rows) {
    result[row.siren] = row;
  }

  return NextResponse.json({ data: result });
}
