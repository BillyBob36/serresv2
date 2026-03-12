import { NextResponse } from "next/server";
import sql from "@/lib/db";

// Dernière année RPG disponible en open data (à mettre à jour manuellement)
const RPG_LATEST_YEAR = 2024;

export async function GET() {
  try {
    const [rpgInfo] = await sql`
      SELECT
        MAX(annee_rpg) as annee,
        MIN(created_at) as imported_at,
        COUNT(*) as count
      FROM serres
    `;

    const [entInfo] = await sql`
      SELECT
        MIN(created_at) as imported_at,
        COUNT(*) as count
      FROM entreprises_agri
    `;

    const [matchInfo] = await sql`
      SELECT
        COUNT(*) FILTER (WHERE siren IS NOT NULL) as matched,
        COUNT(*) FILTER (WHERE match_confiance = 'haute') as haute,
        COUNT(*) FILTER (WHERE match_confiance = 'moyenne') as moyenne,
        COUNT(*) FILTER (WHERE match_confiance = 'basse') as basse,
        COUNT(*) as total
      FROM serres
    `;

    const rpgYear = Number(rpgInfo.annee) || 0;
    const totalSerres = Number(matchInfo.total) || 0;
    const matched = Number(matchInfo.matched) || 0;

    // BDNB stats
    const [bdnbInfo] = await sql`
      SELECT
        COUNT(*) as total,
        COUNT(serre_rpg_id) as matched,
        COUNT(proprietaire_siren) FILTER (WHERE proprietaire_siren IS NOT NULL AND proprietaire_siren != '') as with_siren
      FROM bdnb_serres
    `;

    const bdnbSettings = await sql`
      SELECT value FROM app_settings WHERE key = 'bdnb_match_distance_m'
    `;
    const bdnb_distance_m = bdnbSettings.length > 0 ? parseInt(bdnbSettings[0].value) : 200;

    return NextResponse.json({
      rpg: {
        annee: rpgYear,
        imported_at: rpgInfo.imported_at,
        count: Number(rpgInfo.count),
        latest_available: RPG_LATEST_YEAR,
        up_to_date: rpgYear >= RPG_LATEST_YEAR,
      },
      entreprises: {
        imported_at: entInfo.imported_at,
        count: Number(entInfo.count),
        // Considéré à jour si importé il y a moins de 30 jours
        up_to_date: entInfo.imported_at
          ? Date.now() - new Date(entInfo.imported_at).getTime() < 30 * 24 * 60 * 60 * 1000
          : false,
      },
      matching: {
        matched,
        haute: Number(matchInfo.haute),
        moyenne: Number(matchInfo.moyenne),
        basse: Number(matchInfo.basse),
        total: totalSerres,
        coverage_pct: totalSerres > 0 ? Math.round((matched / totalSerres) * 1000) / 10 : 0,
      },
      bdnb: {
        total: Number(bdnbInfo.total),
        matched: Number(bdnbInfo.matched),
        with_siren: Number(bdnbInfo.with_siren),
        distance_m: bdnb_distance_m,
      },
    });
  } catch (err) {
    console.error("Erreur freshness:", err);
    return NextResponse.json({ error: "Erreur BDD" }, { status: 500 });
  }
}
