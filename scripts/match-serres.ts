/**
 * Script 3 : Matching parcelles serres → entreprises agricoles
 *
 * Usage : npx tsx scripts/match-serres.ts
 *
 * Stratégie optimisée (éviter E007 — UPDATE individuels trop lents) :
 *   Phase 1 : Tout charger en mémoire
 *   Phase 2 : Calculer tous les matchs en mémoire (Haversine)
 *   Phase 3 : Grouper et batch-update la BDD
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

const MAX_DISTANCE_KM = 10;

/**
 * Calcule la distance Haversine entre deux points GPS (en km)
 */
function haversineKm(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

/**
 * Détermine le niveau de confiance du match
 */
function getConfiance(
  distanceKm: number,
  nbCandidats: number
): "haute" | "moyenne" | "basse" {
  if (distanceKm < 2 && nbCandidats === 1) return "haute";
  if (distanceKm < 5) return "moyenne";
  return "basse";
}

interface MatchResult {
  serreId: number;
  siren: string;
  siret_siege: string;
  nom: string;
  dirigeant_nom: string;
  dirigeant_prenom: string;
  commune: string;
  distance_km: number;
  confiance: string;
}

async function main() {
  console.log("=== Matching Serres → Entreprises ===\n");
  const t0 = Date.now();

  // Stats initiales
  const [{ totalSerres }] =
    await sql`SELECT COUNT(*) as "totalSerres" FROM serres`;
  const [{ totalEntreprises }] =
    await sql`SELECT COUNT(*) as "totalEntreprises" FROM entreprises_agri`;
  const [{ dejaMatch }] =
    await sql`SELECT COUNT(*) as "dejaMatch" FROM serres WHERE siren IS NOT NULL`;

  console.log(`Serres en base : ${totalSerres}`);
  console.log(`Entreprises en base : ${totalEntreprises}`);
  console.log(`Déjà matchées : ${dejaMatch}\n`);

  // ═══════════════════════════════════════════
  // Phase 1 : Tout charger en mémoire
  // ═══════════════════════════════════════════
  console.log("--- Phase 1 : Chargement en mémoire ---");

  const allSerres = await sql`
    SELECT id, centroid_lat, centroid_lon, departement
    FROM serres
    WHERE departement IS NOT NULL AND departement != ''
      AND siren IS NULL
      AND centroid_lat IS NOT NULL AND centroid_lat != 0
  `;
  console.log(`Serres à matcher : ${allSerres.length}`);

  const allEntreprises = await sql`
    SELECT siren, siret_siege, nom, dirigeant_nom, dirigeant_prenom,
           latitude, longitude, commune, departement
    FROM entreprises_agri
    WHERE latitude IS NOT NULL AND longitude IS NOT NULL
  `;
  console.log(`Entreprises chargées : ${allEntreprises.length}`);

  // Indexer les entreprises par cellule de grille géographique (1°x1° ≈ 80-111km)
  // Cela évite de rater les entreprises situées dans un département voisin mais très proches
  const GRID_SIZE = 1.0; // degrés
  const entByCell = new Map<string, { ent: (typeof allEntreprises)[number]; lat: number; lon: number }[]>();
  for (const ent of allEntreprises) {
    const lat = Number(ent.latitude);
    const lon = Number(ent.longitude);
    if (!lat || !lon) continue;
    const cellLat = Math.floor(lat / GRID_SIZE);
    const cellLon = Math.floor(lon / GRID_SIZE);
    const key = `${cellLat},${cellLon}`;
    if (!entByCell.has(key)) entByCell.set(key, []);
    entByCell.get(key)!.push({ ent, lat, lon });
  }
  console.log(`Cellules de grille : ${entByCell.size}\n`);

  // ═══════════════════════════════════════════
  // Phase 2 : Calcul de tous les matchs en mémoire
  // ═══════════════════════════════════════════
  console.log("--- Phase 2 : Calcul des matchs (Haversine, multi-département) ---");
  const matchResults: MatchResult[] = [];
  let totalHaute = 0;
  let totalMoyenne = 0;
  let totalBasse = 0;
  let noMatch = 0;

  let serreProcessed = 0;

  for (const serre of allSerres) {
    const serreLat = Number(serre.centroid_lat);
    const serreLon = Number(serre.centroid_lon);
    const cellLat = Math.floor(serreLat / GRID_SIZE);
    const cellLon = Math.floor(serreLon / GRID_SIZE);

    // Collecter les entreprises dans la cellule courante + les 8 cellules voisines
    const candidates: { ent: (typeof allEntreprises)[number]; lat: number; lon: number }[] = [];
    for (let dlat = -1; dlat <= 1; dlat++) {
      for (let dlon = -1; dlon <= 1; dlon++) {
        const key = `${cellLat + dlat},${cellLon + dlon}`;
        const cell = entByCell.get(key);
        if (cell) candidates.push(...cell);
      }
    }

    let bestEnt: (typeof allEntreprises)[number] | null = null;
    let bestDistance = MAX_DISTANCE_KM;
    let candidatsInRadius = 0;

    for (const { ent, lat, lon } of candidates) {
      const dist = haversineKm(serreLat, serreLon, lat, lon);
      if (dist < MAX_DISTANCE_KM) {
        candidatsInRadius++;
        if (dist < bestDistance) {
          bestDistance = dist;
          bestEnt = ent;
        }
      }
    }

    if (bestEnt) {
      const confiance = getConfiance(bestDistance, candidatsInRadius);
      matchResults.push({
        serreId: serre.id as number,
        siren: bestEnt.siren as string,
        siret_siege: bestEnt.siret_siege as string,
        nom: bestEnt.nom as string,
        dirigeant_nom: bestEnt.dirigeant_nom as string,
        dirigeant_prenom: bestEnt.dirigeant_prenom as string,
        commune: bestEnt.commune as string,
        distance_km: Math.round(bestDistance * 100) / 100,
        confiance,
      });
      if (confiance === "haute") totalHaute++;
      else if (confiance === "moyenne") totalMoyenne++;
      else totalBasse++;
    } else {
      noMatch++;
    }

    serreProcessed++;
    if (serreProcessed % 1000 === 0 || serreProcessed === allSerres.length) {
      const elapsed = ((Date.now() - t0) / 1000).toFixed(0);
      console.log(
        `  [${serreProcessed}/${allSerres.length}] matchées: ${matchResults.length} | sans match: ${noMatch} | ${elapsed}s`
      );
    }
  }

  const calcTime = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(`\nMatchs calculés en ${calcTime}s : ${matchResults.length} matchées, ${noMatch} sans match\n`);

  // ═══════════════════════════════════════════
  // Phase 3 : Batch update groupé
  // ═══════════════════════════════════════════
  console.log("--- Phase 3 : Mise à jour BDD (batch groupé) ---");

  // Grouper par (siren, siret_siege, nom, dirigeant_nom, dirigeant_prenom, commune, distance_km, confiance)
  // pour réduire le nombre de requêtes SQL
  const groups = new Map<string, { match: MatchResult; ids: number[] }>();

  for (const m of matchResults) {
    const key = `${m.siren}|||${m.siret_siege}|||${m.nom}|||${m.dirigeant_nom}|||${m.dirigeant_prenom}|||${m.commune}|||${m.distance_km}|||${m.confiance}`;
    if (!groups.has(key)) {
      groups.set(key, { match: m, ids: [] });
    }
    groups.get(key)!.ids.push(m.serreId);
  }

  console.log(`${groups.size} groupes uniques (au lieu de ${matchResults.length} requêtes)\n`);

  let updated = 0;
  let groupNum = 0;

  for (const [, { match, ids }] of groups) {
    // Batch les IDs par paquets de 500
    for (let i = 0; i < ids.length; i += 500) {
      const chunk = ids.slice(i, i + 500);
      await sql`
        UPDATE serres SET
          siren = ${match.siren},
          siret = ${match.siret_siege},
          nom_entreprise = ${match.nom},
          dirigeant_nom = ${match.dirigeant_nom},
          dirigeant_prenom = ${match.dirigeant_prenom},
          adresse_entreprise = ${match.commune},
          distance_km = ${match.distance_km},
          match_confiance = ${match.confiance}
        WHERE id = ANY(${chunk})
      `;
      updated += chunk.length;
    }

    groupNum++;
    if (groupNum % 200 === 0) {
      console.log(`  ${updated}/${matchResults.length} mises à jour (${groupNum}/${groups.size} groupes)...`);
    }
  }

  // ═══════════════════════════════════════════
  // Stats finales
  // ═══════════════════════════════════════════
  const [{ matched }] =
    await sql`SELECT COUNT(*) as matched FROM serres WHERE siren IS NOT NULL`;
  const [{ hauteCount }] =
    await sql`SELECT COUNT(*) as "hauteCount" FROM serres WHERE match_confiance = 'haute'`;
  const [{ moyenneCount }] =
    await sql`SELECT COUNT(*) as "moyenneCount" FROM serres WHERE match_confiance = 'moyenne'`;
  const [{ basseCount }] =
    await sql`SELECT COUNT(*) as "basseCount" FROM serres WHERE match_confiance = 'basse'`;

  const totalTime = ((Date.now() - t0) / 1000).toFixed(0);

  console.log(`\n=== Résultat ===`);
  console.log(`Total serres : ${totalSerres}`);
  console.log(`Matchées     : ${matched} (${Math.round((Number(matched) / Number(totalSerres)) * 100)}%)`);
  console.log(`  Haute      : ${hauteCount}`);
  console.log(`  Moyenne    : ${moyenneCount}`);
  console.log(`  Basse      : ${basseCount}`);
  console.log(`Non matchées : ${Number(totalSerres) - Number(matched)}`);
  console.log(`Durée totale : ${totalTime}s`);

  await sql.end();
}

main().catch((err) => {
  console.error("Erreur fatale:", err);
  process.exit(1);
});
