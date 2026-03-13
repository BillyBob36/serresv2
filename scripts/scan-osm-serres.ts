/**
 * Script : Scan des serres OSM via Overpass API
 *
 * Usage : npx tsx scripts/scan-osm-serres.ts
 *
 * Stratégie :
 *   1. Charger toutes les serres (centroïdes) depuis la BDD
 *   2. Découper la France en tuiles de 0.5° × 0.5°
 *   3. Pour chaque tuile contenant des serres, requêter Overpass
 *   4. Convertir les ways en polygones, calculer la surface géodésique
 *   5. Matcher chaque polygone à la serre la plus proche (< 500m)
 *   6. Stocker surface_osm_m2 en BDD
 */

import postgres from "postgres";
import * as dotenv from "dotenv";
import { resolve } from "path";

dotenv.config({ path: resolve(__dirname, "../.env.local") });

const sql = postgres(
  process.env.DATABASE_URL ||
    "postgresql://serres:SerresV2_2024!@65.21.146.193:5433/serresv2",
  { max: 5, connect_timeout: 30 }
);

const OVERPASS_URL = "https://overpass-api.de/api/interpreter";
const TILE_SIZE = 0.5; // degrés
const MAX_MATCH_DISTANCE_M = 500; // distance max serre ↔ centroïde polygone
const RATE_LIMIT_MS = 2000; // pause entre requêtes Overpass

// ─── Géométrie ───────────────────────────────────────────────

/** Distance Haversine en mètres */
function haversineM(lat1: number, lon1: number, lat2: number, lon2: number): number {
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

/**
 * Calcul de l'aire géodésique d'un polygone (coordonnées lat/lon)
 * Formule de l'excès sphérique simplifiée (Shoelace sur sphère)
 * Retourne la surface en m²
 */
function geodesicAreaM2(coords: [number, number][]): number {
  if (coords.length < 3) return 0;

  const toRad = Math.PI / 180;
  let area = 0;

  for (let i = 0; i < coords.length; i++) {
    const j = (i + 1) % coords.length;
    const k = (i + 2) % coords.length;

    const lat1 = coords[i][0] * toRad;
    const lon1 = coords[i][1] * toRad;
    const lat2 = coords[j][0] * toRad;
    const lon2 = coords[j][1] * toRad;
    const lat3 = coords[k][0] * toRad;
    const lon3 = coords[k][1] * toRad;

    area += (lon3 - lon1) * Math.sin(lat2);
  }

  area = Math.abs(area) * 6371000 * 6371000 / 2;
  return Math.round(area * 100) / 100;
}

/** Centroïde simple d'un polygone */
function centroid(coords: [number, number][]): [number, number] {
  let latSum = 0, lonSum = 0;
  for (const [lat, lon] of coords) {
    latSum += lat;
    lonSum += lon;
  }
  return [latSum / coords.length, lonSum / coords.length];
}

// ─── Overpass ────────────────────────────────────────────────

function buildOverpassQuery(south: number, west: number, north: number, east: number): string {
  const bbox = `${south},${west},${north},${east}`;
  return `[out:json][timeout:120];
(
  way["building"="greenhouse"](${bbox});
  relation["building"="greenhouse"](${bbox});
  way["building"="glasshouse"](${bbox});
  relation["building"="glasshouse"](${bbox});
  way["landuse"="greenhouse_horticulture"](${bbox});
  relation["landuse"="greenhouse_horticulture"](${bbox});
);
out body;
>;
out skel qt;`;
}

interface OsmNode {
  id: number;
  lat: number;
  lon: number;
}

interface OsmWay {
  id: number;
  nodes: number[];
  tags?: Record<string, string>;
}

interface OsmElement {
  type: string;
  id: number;
  lat?: number;
  lon?: number;
  nodes?: number[];
  tags?: Record<string, string>;
  members?: { type: string; ref: number; role: string }[];
}

interface GreenhousePolygon {
  osmId: number;
  coords: [number, number][];
  centroidLat: number;
  centroidLon: number;
  areaM2: number;
  tags: Record<string, string>;
}

async function queryOverpass(query: string, retries = 3): Promise<OsmElement[]> {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const resp = await fetch(OVERPASS_URL, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: `data=${encodeURIComponent(query)}`,
      });

      if (resp.status === 429 || resp.status === 504) {
        const wait = attempt * 10000;
        console.log(`  Overpass ${resp.status}, retry in ${wait / 1000}s...`);
        await sleep(wait);
        continue;
      }

      if (!resp.ok) {
        throw new Error(`Overpass HTTP ${resp.status}`);
      }

      const json = await resp.json();
      return json.elements || [];
    } catch (err: any) {
      if (attempt === retries) throw err;
      console.log(`  Erreur Overpass (tentative ${attempt}): ${err.message}`);
      await sleep(attempt * 5000);
    }
  }
  return [];
}

function parseGreenhousePolygons(elements: OsmElement[]): GreenhousePolygon[] {
  // Index des nodes
  const nodeMap = new Map<number, OsmNode>();
  for (const el of elements) {
    if (el.type === "node" && el.lat !== undefined && el.lon !== undefined) {
      nodeMap.set(el.id, { id: el.id, lat: el.lat, lon: el.lon });
    }
  }

  const polygons: GreenhousePolygon[] = [];

  for (const el of elements) {
    if (el.type === "way" && el.nodes && el.tags) {
      // Reconstruire les coordonnées
      const coords: [number, number][] = [];
      for (const nid of el.nodes) {
        const n = nodeMap.get(nid);
        if (n) coords.push([n.lat, n.lon]);
      }

      if (coords.length < 3) continue;

      const area = geodesicAreaM2(coords);
      if (area < 5 || area > 500000) continue; // filtrer aberrations

      const c = centroid(coords);
      polygons.push({
        osmId: el.id,
        coords,
        centroidLat: c[0],
        centroidLon: c[1],
        areaM2: area,
        tags: el.tags,
      });
    }
  }

  return polygons;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// ─── Main ────────────────────────────────────────────────────

interface SerreRow {
  id: number;
  centroid_lat: number;
  centroid_lon: number;
}

async function main() {
  console.log("=== Scan OSM des serres (Overpass API) ===\n");
  const t0 = Date.now();

  // Charger les serres
  const allSerres = await sql`
    SELECT id, centroid_lat, centroid_lon
    FROM serres
    WHERE centroid_lat IS NOT NULL AND centroid_lat != 0
  `;
  console.log(`Serres en base : ${allSerres.length}`);

  // Indexer les serres par tuile
  const serresByTile = new Map<string, SerreRow[]>();
  for (const s of allSerres) {
    const lat = Number(s.centroid_lat);
    const lon = Number(s.centroid_lon);
    const tLat = Math.floor(lat / TILE_SIZE);
    const tLon = Math.floor(lon / TILE_SIZE);
    const key = `${tLat},${tLon}`;
    if (!serresByTile.has(key)) serresByTile.set(key, []);
    serresByTile.get(key)!.push({ id: s.id as number, centroid_lat: lat, centroid_lon: lon });
  }

  const tiles = [...serresByTile.keys()];
  console.log(`Tuiles à scanner : ${tiles.length}\n`);

  let totalMatched = 0;
  let totalPolygons = 0;
  let tilesDone = 0;

  // Accumuler les résultats pour bulk update
  const results: { serreId: number; areaM2: number }[] = [];

  for (const tileKey of tiles) {
    const [tLatStr, tLonStr] = tileKey.split(",");
    const tLat = Number(tLatStr);
    const tLon = Number(tLonStr);

    const south = tLat * TILE_SIZE;
    const west = tLon * TILE_SIZE;
    const north = south + TILE_SIZE;
    const east = west + TILE_SIZE;

    const serresInTile = serresByTile.get(tileKey)!;

    try {
      const query = buildOverpassQuery(south, west, north, east);
      const elements = await queryOverpass(query);
      const polygons = parseGreenhousePolygons(elements);
      totalPolygons += polygons.length;

      if (polygons.length > 0) {
        // Matcher chaque serre au polygone le plus proche
        for (const serre of serresInTile) {
          let bestPoly: GreenhousePolygon | null = null;
          let bestDist = MAX_MATCH_DISTANCE_M;

          for (const poly of polygons) {
            const dist = haversineM(
              serre.centroid_lat, serre.centroid_lon,
              poly.centroidLat, poly.centroidLon
            );
            if (dist < bestDist) {
              bestDist = dist;
              bestPoly = poly;
            }
          }

          if (bestPoly) {
            results.push({ serreId: serre.id, areaM2: bestPoly.areaM2 });
            totalMatched++;
          }
        }
      }
    } catch (err: any) {
      console.error(`  Erreur tuile ${tileKey}: ${err.message}`);
    }

    tilesDone++;
    if (tilesDone % 5 === 0 || tilesDone === tiles.length) {
      const elapsed = ((Date.now() - t0) / 1000).toFixed(0);
      console.log(
        `  [${tilesDone}/${tiles.length}] polygones: ${totalPolygons} | matchées: ${totalMatched} | ${elapsed}s`
      );
    }

    // Rate limiting
    await sleep(RATE_LIMIT_MS);
  }

  console.log(`\nScan terminé : ${totalPolygons} polygones, ${totalMatched} matchs\n`);

  // Bulk update
  if (results.length > 0) {
    console.log("--- Mise à jour BDD ---");
    const CHUNK = 5000;
    let updated = 0;

    for (let i = 0; i < results.length; i += CHUNK) {
      const slice = results.slice(i, i + CHUNK);
      const ids = slice.map(r => r.serreId);
      const areas = slice.map(r => r.areaM2);

      await sql`
        UPDATE serres AS s SET
          surface_osm_m2 = v.area
        FROM (
          SELECT
            unnest(${ids}::int[]) AS id,
            unnest(${areas}::numeric[]) AS area
        ) AS v
        WHERE s.id = v.id
      `;

      updated += slice.length;
      console.log(`  ${updated}/${results.length} mises à jour...`);
    }
  }

  // Stats finales
  const [{ withOsm }] =
    await sql`SELECT COUNT(*) as "withOsm" FROM serres WHERE surface_osm_m2 IS NOT NULL`;

  const totalTime = ((Date.now() - t0) / 1000).toFixed(0);
  console.log(`\n=== Résultat ===`);
  console.log(`Serres avec surface OSM : ${withOsm} / ${allSerres.length}`);
  console.log(`Durée totale : ${totalTime}s`);

  await sql.end();
}

main().catch((err) => {
  console.error("Erreur fatale:", err);
  process.exit(1);
});
