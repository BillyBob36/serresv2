/**
 * Script : Remplir les départements manquants par proximité géographique
 *
 * Usage : npx tsx scripts/geocode-batch.ts
 *
 * Approche : on a ~5000 parcelles déjà géocodées. Pour les ~19000 restantes,
 * on trouve la parcelle géocodée la plus proche et on copie son département.
 * Zéro appel API, tout en mémoire, ~10 secondes.
 */

import postgres from "postgres";
import * as dotenv from "dotenv";
import { resolve } from "path";

dotenv.config({ path: resolve(__dirname, "../.env.local") });

const sql = postgres(
  process.env.DATABASE_URL ||
    "postgresql://serres:SerresV2_2024!@65.21.146.193:5433/serresv2",
  { max: 5, connect_timeout: 10 }
);

function distSq(lat1: number, lon1: number, lat2: number, lon2: number): number {
  return (lat1 - lat2) ** 2 + (lon1 - lon2) ** 2;
}

async function main() {
  console.log("=== Remplissage départements par proximité ===\n");

  // 1. Charger les parcelles déjà géocodées (référence)
  const refs = await sql`
    SELECT id, centroid_lat, centroid_lon, commune, code_postal, departement
    FROM serres
    WHERE departement IS NOT NULL AND departement != ''
  `;
  console.log(`Parcelles de référence (géocodées) : ${refs.length}`);

  if (refs.length === 0) {
    console.log("Aucune parcelle de référence ! Lancez d'abord import-rpg.ts");
    await sql.end();
    return;
  }

  // 2. Charger les parcelles sans département
  const missing = await sql`
    SELECT id, centroid_lat, centroid_lon
    FROM serres
    WHERE (departement IS NULL OR departement = '')
      AND centroid_lat IS NOT NULL AND centroid_lat != 0
  `;
  console.log(`Parcelles sans département : ${missing.length}\n`);

  if (missing.length === 0) {
    console.log("Toutes les parcelles ont un département !");
    await sql.end();
    return;
  }

  // 3. Pré-calculer les coordonnées des références en arrays pour la performance
  const refData = refs.map((r) => ({
    lat: Number(r.centroid_lat),
    lon: Number(r.centroid_lon),
    commune: r.commune as string,
    code_postal: r.code_postal as string,
    departement: r.departement as string,
  }));

  // 4. Pour chaque parcelle sans département, trouver la plus proche
  console.log("Calcul des correspondances...");
  const t0 = Date.now();

  const updates: {
    id: number;
    commune: string;
    code_postal: string;
    departement: string;
  }[] = [];

  for (const m of missing) {
    const mLat = Number(m.centroid_lat);
    const mLon = Number(m.centroid_lon);

    let bestDist = Infinity;
    let bestRef = refData[0];

    for (const ref of refData) {
      const d = distSq(mLat, mLon, ref.lat, ref.lon);
      if (d < bestDist) {
        bestDist = d;
        bestRef = ref;
      }
    }

    updates.push({
      id: m.id as number,
      commune: bestRef.commune,
      code_postal: bestRef.code_postal,
      departement: bestRef.departement,
    });
  }

  const calcTime = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(`Correspondances calculées en ${calcTime}s\n`);

  // 5. Grouper les updates par (commune, code_postal, departement) pour réduire les requêtes
  console.log("Regroupement des updates...");
  const groups = new Map<string, number[]>();
  for (const u of updates) {
    const key = `${u.departement}|||${u.commune}|||${u.code_postal}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(u.id);
  }
  console.log(`${groups.size} groupes uniques (au lieu de ${updates.length} requêtes)\n`);

  console.log("Mise à jour de la base...");
  let updated = 0;
  let groupNum = 0;

  for (const [key, ids] of groups) {
    const [dept, commune, code_postal] = key.split("|||");

    // Batch les IDs par paquets de 500 pour éviter les requêtes trop longues
    for (let i = 0; i < ids.length; i += 500) {
      const chunk = ids.slice(i, i + 500);
      await sql`
        UPDATE serres SET
          commune = ${commune},
          code_postal = ${code_postal},
          departement = ${dept}
        WHERE id = ANY(${chunk})
      `;
      updated += chunk.length;
    }

    groupNum++;
    if (groupNum % 50 === 0) {
      console.log(`  ${updated}/${updates.length} mises à jour (${groupNum}/${groups.size} groupes)...`);
    }
  }

  // 6. Stats finales
  const [{ total }] = await sql`SELECT COUNT(*) as total FROM serres`;
  const [{ withDept }] = await sql`
    SELECT COUNT(*) as "withDept" FROM serres
    WHERE departement IS NOT NULL AND departement != ''
  `;

  const deptStats = await sql`
    SELECT departement, COUNT(*) as count
    FROM serres
    WHERE departement IS NOT NULL AND departement != ''
    GROUP BY departement
    ORDER BY count DESC
    LIMIT 10
  `;

  console.log(`\n=== Résultat ===`);
  console.log(`Total : ${total} parcelles`);
  console.log(`Avec département : ${withDept} (${Math.round((Number(withDept) / Number(total)) * 100)}%)`);
  console.log(`\nTop 10 départements :`);
  for (const d of deptStats) {
    console.log(`  ${d.departement} : ${d.count} serres`);
  }
  console.log(`\nDurée totale : ${((Date.now() - t0) / 1000).toFixed(1)}s`);

  await sql.end();
}

main().catch((e) => {
  console.error("FATAL:", e);
  process.exit(1);
});
