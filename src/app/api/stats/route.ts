import { NextResponse } from "next/server";
import sql from "@/lib/db";
// Force dynamic — never cache API routes
export const dynamic = "force-dynamic";


export async function GET() {
  const [stats] = await sql`
    SELECT
      COUNT(*) as total_serres,
      COUNT(siren) as total_matchees,
      COUNT(DISTINCT departement) as departements,
      COALESCE(ROUND(SUM(surface_ha)::numeric, 1), 0) as surface_totale_ha
    FROM serres
  `;

  const par_code = await sql`
    SELECT code_cultu, COUNT(*) as count
    FROM serres
    GROUP BY code_cultu
    ORDER BY count DESC
  `;

  const top_depts = await sql`
    SELECT departement, COUNT(*) as count
    FROM serres
    WHERE departement IS NOT NULL AND departement != ''
    GROUP BY departement
    ORDER BY count DESC
    LIMIT 10
  `;

  return NextResponse.json({
    ...stats,
    par_code,
    top_depts,
  });
}
