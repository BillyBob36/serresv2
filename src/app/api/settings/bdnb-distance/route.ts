import { NextRequest, NextResponse } from "next/server";
import sql from "@/lib/db";
// Force dynamic — never cache API routes
export const dynamic = "force-dynamic";


export async function GET() {
  try {
    // Get current distance from settings
    const settings = await sql`
      SELECT value FROM app_settings WHERE key = 'bdnb_match_distance_m'
    `;
    const distance_m = settings.length > 0 ? parseInt(settings[0].value) : 200;

    // Get current match stats
    const stats = await sql`
      SELECT
        COUNT(*) as total_bdnb,
        COUNT(serre_rpg_id) as matched,
        COUNT(proprietaire_siren) FILTER (WHERE proprietaire_siren IS NOT NULL AND proprietaire_siren != '') as with_siren
      FROM bdnb_serres
    `;

    return NextResponse.json({
      distance_m,
      total_bdnb: parseInt(stats[0].total_bdnb),
      matched: parseInt(stats[0].matched),
      with_siren: parseInt(stats[0].with_siren),
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const distance_m = parseInt(body.distance_m);

    if (!distance_m || distance_m < 10 || distance_m > 5000) {
      return NextResponse.json(
        { error: "distance_m must be between 10 and 5000" },
        { status: 400 }
      );
    }

    // Bounding box pre-filter: convert meters to approximate degrees
    // 1 degree latitude ≈ 111,320 m, so X meters ≈ X/111320 degrees
    // Add 50% margin for safety
    const boundingDeg = ((distance_m * 1.5) / 111320).toFixed(6);

    // Step 1: Reset all matches
    await sql`UPDATE bdnb_serres SET serre_rpg_id = NULL, distance_rpg_m = NULL`;

    // Step 2: Re-run matching with new distance threshold
    const result = await sql.unsafe(`
      UPDATE bdnb_serres b
      SET serre_rpg_id = sub.serre_id, distance_rpg_m = sub.dist_m
      FROM (
        SELECT DISTINCT ON (b2.batiment_groupe_id)
          b2.batiment_groupe_id,
          s.id as serre_id,
          (6371000 * acos(LEAST(1.0,
            cos(radians(b2.centroid_lat)) * cos(radians(s.centroid_lat)) *
            cos(radians(s.centroid_lon) - radians(b2.centroid_lon)) +
            sin(radians(b2.centroid_lat)) * sin(radians(s.centroid_lat))
          ))) as dist_m
        FROM bdnb_serres b2
        CROSS JOIN LATERAL (
          SELECT id, centroid_lat, centroid_lon
          FROM serres s
          WHERE s.departement = b2.code_departement
            AND ABS(s.centroid_lat - b2.centroid_lat) < ${boundingDeg}
            AND ABS(s.centroid_lon - b2.centroid_lon) < ${boundingDeg}
          ORDER BY ((s.centroid_lat - b2.centroid_lat)^2 + (s.centroid_lon - b2.centroid_lon)^2)
          LIMIT 1
        ) s
        WHERE b2.serre_rpg_id IS NULL
      ) sub
      WHERE b.batiment_groupe_id = sub.batiment_groupe_id
        AND sub.dist_m < ${distance_m}
    `);

    // Step 3: Save new distance
    await sql`
      INSERT INTO app_settings (key, value, updated_at)
      VALUES ('bdnb_match_distance_m', ${String(distance_m)}, NOW())
      ON CONFLICT (key) DO UPDATE SET value = ${String(distance_m)}, updated_at = NOW()
    `;

    // Step 4: Return updated stats
    const stats = await sql`
      SELECT
        COUNT(*) as total_bdnb,
        COUNT(serre_rpg_id) as matched,
        COUNT(proprietaire_siren) FILTER (WHERE proprietaire_siren IS NOT NULL AND proprietaire_siren != '') as with_siren
      FROM bdnb_serres
    `;

    return NextResponse.json({
      success: true,
      distance_m,
      rows_updated: result.count,
      total_bdnb: parseInt(stats[0].total_bdnb),
      matched: parseInt(stats[0].matched),
      with_siren: parseInt(stats[0].with_siren),
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
