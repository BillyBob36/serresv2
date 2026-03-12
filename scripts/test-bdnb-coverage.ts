/**
 * Test de couverture BDNB sur nos serres
 *
 * Stratégie : charger TOUS les bâtiments BDNB d'une commune via l'API Open,
 * puis croiser en mémoire avec nos serres (distance Haversine).
 * Le bbox ne fonctionne pas en tier Open, mais le filtre par code_commune_insee oui.
 */

import postgres from "postgres";

const connectionString =
  process.env.DATABASE_URL ||
  "postgresql://serres:SerresV2_2024!@65.21.146.193:5433/serresv2";

const sql = postgres(connectionString, { max: 5 });

const BDNB_API = "https://api.bdnb.io/v1/bdnb/donnees/batiment_groupe_complet";
const RAYON_M = 200; // rayon de recherche en mètres

function haversine(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371000;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

interface BDNBBat {
  batiment_groupe_id: string;
  l_siren: string[] | null;
  s_geom_groupe: number;
  hauteur_mean: number | null;
  usage_principal_bdnb_open: string | null;
  // Les coordonnées WGS84 sont dans batiment_groupe (pas _complet)
  // On va devoir utiliser batiment_groupe pour les coords
}

interface BDNBPos {
  batiment_groupe_id: string;
  geom_groupe_pos_wgs84: { coordinates: [number, number] } | null;
}

// Cache par commune
const communeCache = new Map<string, { bats: BDNBBat[]; positions: Map<string, [number, number]> }>();

async function loadCommune(codeCommune: string) {
  if (communeCache.has(codeCommune)) return communeCache.get(codeCommune)!;

  // Charger les bâtiments avec SIREN et usage
  const batsResp = await fetch(
    `${BDNB_API}?code_commune_insee=eq.${codeCommune}` +
      `&select=batiment_groupe_id,l_siren,s_geom_groupe,hauteur_mean,usage_principal_bdnb_open` +
      `&limit=10000`
  );
  const bats: BDNBBat[] = batsResp.ok ? await batsResp.json() : [];

  // Charger les positions (table batiment_groupe qui a les coords WGS84)
  const posResp = await fetch(
    `https://api.bdnb.io/v1/bdnb/donnees/batiment_groupe?code_commune_insee=eq.${codeCommune}` +
      `&select=batiment_groupe_id,geom_groupe_pos_wgs84` +
      `&limit=10000`
  );
  const positions: BDNBPos[] = posResp.ok ? await posResp.json() : [];

  const posMap = new Map<string, [number, number]>();
  for (const p of positions) {
    if (p.geom_groupe_pos_wgs84?.coordinates) {
      posMap.set(p.batiment_groupe_id, p.geom_groupe_pos_wgs84.coordinates);
    }
  }

  const result = { bats, positions: posMap };
  communeCache.set(codeCommune, result);
  console.log(`  Commune ${codeCommune}: ${bats.length} bâtiments BDNB, ${posMap.size} avec coords`);
  return result;
}

async function main() {
  console.log("=== Test de couverture BDNB sur nos serres ===\n");

  const deptTest = "84";

  // Charger les serres avec leur code commune INSEE
  const serres = await sql`
    SELECT s.id, s.centroid_lat, s.centroid_lon, s.commune, s.surface_ha,
           s.siren as siren_actuel, s.nom_entreprise, s.code_postal
    FROM serres s
    WHERE s.departement = ${deptTest}
    ORDER BY s.surface_ha DESC
  `;

  console.log(`Dept ${deptTest}: ${serres.length} serres\n`);
  if (serres.length === 0) {
    await sql.end();
    return;
  }

  // On a besoin du code commune INSEE. Essayons de le déduire du code_postal
  // Pour le Vaucluse (84), code_commune_insee = "84" + 3 chiffres
  // On va chercher les codes communes uniques via l'API BDNB

  // Prendre un échantillon de 100 serres (les plus grandes = plus de chance d'être en BDNB)
  const sample = serres.slice(0, 100);
  console.log(`Test sur ${sample.length} serres\n`);

  // Regrouper par commune pour minimiser les appels API
  const communeMap = new Map<string, typeof sample>();
  for (const s of sample) {
    const commune = s.commune as string;
    if (!commune) continue;
    if (!communeMap.has(commune)) communeMap.set(commune, []);
    communeMap.get(commune)!.push(s);
  }
  console.log(`${communeMap.size} communes distinctes\n`);

  // Récupérer les code_commune_insee via la BDD BDNB (chercher par nom)
  const communeCodes = new Map<string, string>();
  for (const commune of communeMap.keys()) {
    try {
      const resp = await fetch(
        `https://api.bdnb.io/v1/bdnb/donnees/batiment_groupe?` +
          `libelle_commune_insee=ilike.*${encodeURIComponent(commune)}*&code_departement_insee=eq.84` +
          `&select=code_commune_insee&limit=1`
      );
      if (resp.ok) {
        const data = await resp.json();
        if (data.length > 0) {
          communeCodes.set(commune, data[0].code_commune_insee);
        }
      }
    } catch {
      // skip
    }
    // Rate limit
    await new Promise((r) => setTimeout(r, 200));
  }
  console.log(`Codes communes trouvés: ${communeCodes.size}/${communeMap.size}\n`);

  let totalTested = 0;
  let withBDNB = 0;
  let withBDNBSiren = 0;
  let sirenMatch = 0;
  let sirenDiff = 0;
  const usages: Record<string, number> = {};

  for (const [commune, serresInCommune] of communeMap.entries()) {
    const codeCommune = communeCodes.get(commune);
    if (!codeCommune) continue;

    const { bats, positions } = await loadCommune(codeCommune);

    for (const serre of serresInCommune) {
      totalTested++;
      const lat = Number(serre.centroid_lat);
      const lon = Number(serre.centroid_lon);

      let closestBat: BDNBBat | null = null;
      let closestDist = Infinity;

      for (const bat of bats) {
        const coords = positions.get(bat.batiment_groupe_id);
        if (!coords) continue;
        const [bLon, bLat] = coords;
        const dist = haversine(lat, lon, bLat, bLon);
        if (dist < closestDist) {
          closestDist = dist;
          closestBat = bat;
        }
      }

      if (closestBat && closestDist <= RAYON_M) {
        withBDNB++;
        const usage = closestBat.usage_principal_bdnb_open || "null";
        usages[usage] = (usages[usage] || 0) + 1;

        const hasSiren = closestBat.l_siren && closestBat.l_siren.length > 0;
        if (hasSiren) {
          withBDNBSiren++;
          const bdnbSiren = closestBat.l_siren![0];
          if (serre.siren_actuel && bdnbSiren === serre.siren_actuel) {
            sirenMatch++;
          } else if (serre.siren_actuel) {
            sirenDiff++;
          }
        }

        if (withBDNB <= 15) {
          console.log(
            `  [MATCH] Serre #${serre.id} (${serre.commune}, ${Number(serre.surface_ha).toFixed(2)}ha) ` +
              `→ BDNB à ${closestDist.toFixed(0)}m, ${closestBat.s_geom_groupe}m2, h=${closestBat.hauteur_mean}m, ` +
              `usage="${usage}", SIREN=${closestBat.l_siren ? closestBat.l_siren.join(",") : "null"}`
          );
        }
      }
    }

    // Rate limit entre communes
    await new Promise((r) => setTimeout(r, 500));
  }

  console.log("\n=== RÉSULTATS ===");
  console.log(`Serres testées: ${totalTested}`);
  console.log(`Avec bâtiment BDNB à <${RAYON_M}m: ${withBDNB} (${((withBDNB / totalTested) * 100).toFixed(1)}%)`);
  console.log(`  dont avec SIREN: ${withBDNBSiren} (${((withBDNBSiren / totalTested) * 100).toFixed(1)}%)`);
  console.log(`  SIREN identique: ${sirenMatch}, SIREN différent: ${sirenDiff}`);

  console.log("\nUsages des bâtiments matchés:");
  for (const [usage, count] of Object.entries(usages).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${usage}: ${count}`);
  }

  console.log("\n=== VERDICT ===");
  const coveragePct = totalTested > 0 ? (withBDNBSiren / totalTested) * 100 : 0;
  const bdnbPct = totalTested > 0 ? (withBDNB / totalTested) * 100 : 0;
  if (coveragePct > 20) {
    console.log(`✅ ${coveragePct.toFixed(1)}% avec SIREN BDNB → VAUT LE COUP`);
  } else if (bdnbPct > 20) {
    console.log(`⚠️ ${bdnbPct.toFixed(1)}% matchent un bâtiment BDNB mais seulement ${coveragePct.toFixed(1)}% ont un SIREN`);
  } else if (coveragePct > 5) {
    console.log(`⚠️ ${coveragePct.toFixed(1)}% → enrichissement secondaire utile`);
  } else {
    console.log(`❌ ${coveragePct.toFixed(1)}% < 5% → BDNB pas rentable pour les serres`);
  }

  await sql.end();
}

main().catch(console.error);
