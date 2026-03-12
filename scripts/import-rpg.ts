/**
 * Script 1 : Import des parcelles serres depuis l'API Carto RPG
 *
 * Usage : npx tsx scripts/import-rpg.ts
 *
 * Codes cultures ciblés :
 *   CSS (culture sous serre hors sol) : ~2 000 parcelles
 *   FLA (fleurs et plantes aromatiques) : ~16 500 parcelles
 *   PEP (pépinières) : ~5 500 parcelles
 *
 * Total : ~24 000 parcelles importées en ~25 appels API
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

// --- Config ---
const ANNEE_RPG = 2024;
const CODES_SERRES = ["CSS", "FLA", "PEP"];
const PAGE_SIZE = 1000;
const FRANCE_BBOX = {
  type: "Polygon" as const,
  coordinates: [
    [
      [-5.5, 41.0],
      [10.0, 41.0],
      [10.0, 51.5],
      [-5.5, 51.5],
      [-5.5, 41.0],
    ],
  ],
};

// --- Helpers ---

interface RPGProperties {
  id_parcel: string;
  surf_parc: number;
  code_cultu: string;
  code_group: string;
  culture_d1: string | null;
  culture_d2: string | null;
  cat_cult_p?: string;
}

interface RPGFeature {
  type: "Feature";
  geometry: {
    type: "MultiPolygon";
    coordinates: number[][][][];
  };
  properties: RPGProperties;
}

interface RPGResponse {
  type: "FeatureCollection";
  features: RPGFeature[];
  totalFeatures: number;
  numberReturned: number;
}

/**
 * Calcule le centroïde (barycentre) d'un MultiPolygon
 */
function computeCentroid(geometry: RPGFeature["geometry"]): {
  lat: number;
  lon: number;
} {
  let sumLat = 0;
  let sumLon = 0;
  let count = 0;

  for (const polygon of geometry.coordinates) {
    for (const ring of polygon) {
      for (const [lon, lat] of ring) {
        sumLon += lon;
        sumLat += lat;
        count++;
      }
    }
  }

  return {
    lat: count > 0 ? sumLat / count : 0,
    lon: count > 0 ? sumLon / count : 0,
  };
}

/**
 * Détermine le département depuis le centroïde via l'API Adresse
 */
async function reversGeocode(
  lat: number,
  lon: number
): Promise<{ commune: string; code_postal: string; departement: string }> {
  try {
    const resp = await fetch(
      `https://api-adresse.data.gouv.fr/reverse?lon=${lon}&lat=${lat}&limit=1`
    );
    if (!resp.ok) return { commune: "", code_postal: "", departement: "" };
    const data = await resp.json();
    if (data.features && data.features.length > 0) {
      const props = data.features[0].properties;
      return {
        commune: props.city || props.label || "",
        code_postal: props.postcode || "",
        departement: (props.postcode || "").substring(0, 2),
      };
    }
  } catch {
    // Silencieux en cas d'erreur réseau
  }
  return { commune: "", code_postal: "", departement: "" };
}

/**
 * Fetch toutes les parcelles RPG pour un code culture donné
 */
async function fetchParcelles(codeCultu: string): Promise<RPGFeature[]> {
  const allFeatures: RPGFeature[] = [];
  let start = 0;
  let total = Infinity;

  const geomParam = encodeURIComponent(JSON.stringify(FRANCE_BBOX));

  while (start < total) {
    const url = `https://apicarto.ign.fr/api/rpg/v2?annee=${ANNEE_RPG}&code_cultu=${codeCultu}&_limit=${PAGE_SIZE}&_start=${start}&geom=${geomParam}`;

    console.log(
      `  [${codeCultu}] Fetching page ${Math.floor(start / PAGE_SIZE) + 1} (_start=${start})...`
    );

    const resp = await fetch(url);
    if (!resp.ok) {
      console.error(
        `  [${codeCultu}] Erreur HTTP ${resp.status}: ${await resp.text()}`
      );
      break;
    }

    const data: RPGResponse = await resp.json();
    total = data.totalFeatures;

    if (data.features.length === 0) break;
    allFeatures.push(...data.features);

    console.log(
      `  [${codeCultu}] ${allFeatures.length}/${total} parcelles récupérées`
    );

    start += PAGE_SIZE;

    // Rate limiting poli : 500ms entre chaque requête
    await new Promise((r) => setTimeout(r, 500));
  }

  return allFeatures;
}

/**
 * Insère un batch de parcelles dans PostgreSQL
 */
async function insertBatch(features: RPGFeature[]): Promise<number> {
  if (features.length === 0) return 0;

  const BATCH_SIZE = 100;
  let inserted = 0;

  for (let i = 0; i < features.length; i += BATCH_SIZE) {
    const batch = features.slice(i, i + BATCH_SIZE);

    // Géocodage inverse par batch (avec rate limiting)
    const geocoded = await Promise.all(
      batch.map(async (f, idx) => {
        const centroid = computeCentroid(f.geometry);
        // Limiter les appels géocodage : 1 sur 5 ou si < 500 features
        if (features.length < 500 || idx % 5 === 0) {
          await new Promise((r) => setTimeout(r, 50));
          const geo = await reversGeocode(centroid.lat, centroid.lon);
          return { ...centroid, ...geo };
        }
        // Pour les 4/5 restants, déduire le département du centroïde sera fait plus tard
        return {
          ...centroid,
          commune: "",
          code_postal: "",
          departement: "",
        };
      })
    );

    const values = batch.map((f, idx) => ({
      id_parcel: f.properties.id_parcel,
      code_cultu: f.properties.code_cultu,
      code_group: f.properties.code_group,
      surface_ha: f.properties.surf_parc,
      centroid_lat: geocoded[idx].lat,
      centroid_lon: geocoded[idx].lon,
      commune: geocoded[idx].commune,
      code_postal: geocoded[idx].code_postal,
      departement: geocoded[idx].departement,
      geojson: JSON.stringify(f.geometry),
      annee_rpg: ANNEE_RPG,
    }));

    await sql`
      INSERT INTO serres ${sql(values, "id_parcel", "code_cultu", "code_group", "surface_ha", "centroid_lat", "centroid_lon", "commune", "code_postal", "departement", "geojson", "annee_rpg")}
      ON CONFLICT (id_parcel) DO NOTHING
    `;

    inserted += batch.length;
    if (i % 500 === 0 && i > 0) {
      console.log(`    Inserted ${inserted}/${features.length}...`);
    }
  }

  return inserted;
}

// --- Main ---

async function main() {
  console.log("=== Import RPG Serres ===\n");
  console.log(`Année RPG : ${ANNEE_RPG}`);
  console.log(`Codes cultures : ${CODES_SERRES.join(", ")}\n`);

  // Vérifier la connexion BDD
  const [{ version }] = await sql`SELECT version()`;
  console.log(`PostgreSQL : ${version}\n`);

  let totalInserted = 0;

  for (const code of CODES_SERRES) {
    console.log(`\n--- Import ${code} ---`);
    const features = await fetchParcelles(code);
    console.log(`  Total récupéré : ${features.length} parcelles`);

    if (features.length > 0) {
      const inserted = await insertBatch(features);
      totalInserted += inserted;
      console.log(`  Inséré : ${inserted} parcelles`);
    }
  }

  // Remplir les départements manquants via le centroïde
  console.log("\n--- Complétion des départements manquants ---");
  const missing = await sql`
    SELECT id, centroid_lat, centroid_lon FROM serres
    WHERE departement = '' OR departement IS NULL
    LIMIT 5000
  `;

  if (missing.length > 0) {
    console.log(`  ${missing.length} parcelles sans département, géocodage...`);
    let filled = 0;
    for (const row of missing) {
      const geo = await reversGeocode(
        Number(row.centroid_lat),
        Number(row.centroid_lon)
      );
      if (geo.departement) {
        await sql`
          UPDATE serres SET
            commune = ${geo.commune},
            code_postal = ${geo.code_postal},
            departement = ${geo.departement}
          WHERE id = ${row.id}
        `;
        filled++;
      }
      // Rate limiting API Adresse : 50 req/s max
      await new Promise((r) => setTimeout(r, 30));
      if (filled % 100 === 0 && filled > 0) {
        console.log(`    Géocodé ${filled}/${missing.length}...`);
      }
    }
    console.log(`  Départements complétés : ${filled}`);
  }

  // Stats finales
  const stats = await sql`
    SELECT
      code_cultu,
      COUNT(*) as count,
      ROUND(AVG(surface_ha)::numeric, 2) as avg_surface
    FROM serres
    GROUP BY code_cultu
    ORDER BY count DESC
  `;

  console.log("\n=== Résultat ===");
  console.log("Code | Parcelles | Surface moy.");
  for (const row of stats) {
    console.log(`${row.code_cultu}  | ${row.count} | ${row.avg_surface} ha`);
  }

  const [{ total }] = await sql`SELECT COUNT(*) as total FROM serres`;
  console.log(`\nTotal : ${total} parcelles serres importées`);

  await sql.end();
}

main().catch((err) => {
  console.error("Erreur fatale:", err);
  process.exit(1);
});
