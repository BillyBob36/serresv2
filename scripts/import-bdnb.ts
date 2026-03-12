/**
 * Script : Import des serres BDNB département par département
 *
 * Usage : npx tsx scripts/import-bdnb.ts
 *         npx tsx scripts/import-bdnb.ts --dept 84       (un seul département)
 *         npx tsx scripts/import-bdnb.ts --start 30      (reprendre à partir du dept 30)
 *
 * Processus pour chaque département :
 *   1. Télécharge le ZIP BDNB (~300-500 Mo)
 *   2. Extrait uniquement les CSV nécessaires (pipe, pas en mémoire)
 *   3. Filtre les bâtiments tagués "Serre" dans bdtopo_bat
 *   4. Enrichit avec parcelle, propriétaire, adresse
 *   5. Convertit Lambert93 → WGS84
 *   6. Insère en BDD
 *   7. Supprime le ZIP → passe au suivant
 *
 * Espace disque requis : ~500 Mo temporaire (un seul ZIP à la fois)
 * Durée estimée : ~2-3h pour la France entière
 */

import postgres from "postgres";
import * as dotenv from "dotenv";
import { resolve, join } from "path";
import { createWriteStream, existsSync, mkdirSync, unlinkSync, createReadStream } from "fs";
import { createInterface } from "readline";
import { execSync } from "child_process";
import { pipeline } from "stream/promises";

dotenv.config({ path: resolve(__dirname, "../.env.local") });

const sql = postgres(
  process.env.DATABASE_URL ||
    "postgresql://serres:SerresV2_2024!@65.21.146.193:5433/serresv2",
  { max: 5, connect_timeout: 10 }
);

// --- Config ---
// Millésime 2025-07-a (publié déc 2025, format v0.7.10)
const BDNB_MILLESIME = "2025-07-a";
const BDNB_BASE_URL = "https://open-data.s3.fr-par.scw.cloud/bdnb_millesime_2025-07-a";
const DATA_DIR = resolve(__dirname, "../data/bdnb");
const BATCH_SIZE = 100;

// Tous les départements français (métropole)
const ALL_DEPTS = [
  "01","02","03","04","05","06","07","08","09","10",
  "11","12","13","14","15","16","17","18","19","21",
  "22","23","24","25","26","27","28","29","2A","2B",
  "30","31","32","33","34","35","36","37","38","39",
  "40","41","42","43","44","45","46","47","48","49",
  "50","51","52","53","54","55","56","57","58","59",
  "60","61","62","63","64","65","66","67","68","69",
  "70","71","72","73","74","75","76","77","78","79",
  "80","81","82","83","84","85","86","87","88","89",
  "90","91","92","93","94","95",
  // DOM
  "971","972","973","974","976"
];

// --- Lambert93 (EPSG:2154) → WGS84 (EPSG:4326) ---
// Approximation suffisante pour la France métropolitaine
function lambert93ToWgs84(x: number, y: number): { lat: number; lon: number } {
  // Constantes de la projection Lambert93
  const n = 0.7256077650;
  const C = 11754255.426;
  const xs = 700000;
  const ys = 12655612.0499;
  const e = 0.0818191910428;
  const lon0 = 0.0523598775598; // 3° en radians

  const dx = x - xs;
  const dy = ys - y;
  const R = Math.sqrt(dx * dx + dy * dy);
  const gamma = Math.atan2(dx, dy);
  const latIso = -Math.log(R / C) / n;
  const lon = gamma / n + lon0;

  // Itération pour trouver la latitude
  let lat = 2 * Math.atan(Math.exp(latIso)) - Math.PI / 2;
  for (let i = 0; i < 10; i++) {
    const eSinLat = e * Math.sin(lat);
    lat = 2 * Math.atan(
      Math.exp(latIso) * Math.pow((1 + eSinLat) / (1 - eSinLat), e / 2)
    ) - Math.PI / 2;
  }

  return {
    lat: lat * 180 / Math.PI,
    lon: lon * 180 / Math.PI,
  };
}

// --- Parsing CSV BDNB (séparateur ; avec quotes) ---
function parseCsvLine(line: string): string[] {
  const fields: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && i + 1 < line.length && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === ";" && !inQuotes) {
      fields.push(current.trim());
      current = "";
    } else {
      current += ch;
    }
  }
  fields.push(current.trim());
  return fields;
}

// --- Extraire le centroïde d'un MULTIPOLYGON Lambert93 ---
function centroidFromMultipolygon(wkt: string): { x: number; y: number } | null {
  const coords = wkt.match(/([\d.]+)\s+([\d.]+)/g);
  if (!coords || coords.length === 0) return null;

  let sumX = 0, sumY = 0;
  for (const c of coords) {
    const [x, y] = c.split(/\s+/).map(Number);
    sumX += x;
    sumY += y;
  }
  return { x: sumX / coords.length, y: sumY / coords.length };
}

// --- Lire un CSV depuis un ZIP via pipe (pas d'extraction complète) ---
async function readCsvFromZip(
  zipPath: string,
  csvName: string,
  onRow: (fields: string[], headers: string[]) => void
): Promise<void> {
  return new Promise((resolve, reject) => {
    try {
      // Utilise unzip -p pour pipe le CSV sans extraire
      const { execSync } = require("child_process");
      const data = execSync(`unzip -p "${zipPath}" "csv/${csvName}"`, {
        maxBuffer: 500 * 1024 * 1024, // 500 Mo max
        encoding: "utf-8",
      });

      const lines = data.split("\n");
      if (lines.length === 0) { resolve(); return; }

      const headers = parseCsvLine(lines[0]);
      for (let i = 1; i < lines.length; i++) {
        if (!lines[i].trim()) continue;
        onRow(parseCsvLine(lines[i]), headers);
      }
      resolve();
    } catch (err: any) {
      if (err.message?.includes("caution")) {
        // unzip warnings, pas fatal
        resolve();
      } else {
        reject(err);
      }
    }
  });
}

// --- Lire un CSV volumineux ligne par ligne via stream ---
async function streamCsvFromZip(
  zipPath: string,
  csvName: string,
  filter: (fields: string[], headers: string[]) => boolean,
  onMatch: (fields: string[], headers: string[]) => void
): Promise<void> {
  return new Promise((resolveP, reject) => {
    const { spawn } = require("child_process");
    const proc = spawn("unzip", ["-p", zipPath, `csv/${csvName}`]);

    const rl = createInterface({ input: proc.stdout });
    let headers: string[] = [];
    let isFirst = true;

    rl.on("line", (line: string) => {
      if (!line.trim()) return;
      if (isFirst) {
        headers = parseCsvLine(line);
        isFirst = false;
        return;
      }
      const fields = parseCsvLine(line);
      if (filter(fields, headers)) {
        onMatch(fields, headers);
      }
    });

    rl.on("close", resolveP);
    proc.on("error", reject);
    proc.stderr.on("data", () => {}); // Ignorer stderr
  });
}

interface BdnbSerre {
  batiment_groupe_id: string;
  code_departement: string;
  commune: string | null;
  code_commune_insee: string | null;
  centroid_lat: number | null;
  centroid_lon: number | null;
  surface_m2: number | null;
  nature: string | null;
  usage_1: string | null;
  usage_2: string | null;
  etat: string | null;
  hauteur_moy: number | null;
  hauteur_max: number | null;
  altitude_sol: number | null;
  parcelle_id: string | null;
  proprietaire_siren: string | null;
  proprietaire_denomination: string | null;
  proprietaire_forme_juridique: string | null;
  adresse: string | null;
}

async function processDepartement(dept: string, zipPath: string): Promise<number> {
  console.log(`\n  [1/5] Lecture des bâtiments-serres (bdtopo_bat)...`);

  // Step 1: Identifier les bâtiments "Serre"
  const serreIds = new Set<string>();
  const serreData = new Map<string, Partial<BdnbSerre>>();

  await streamCsvFromZip(zipPath, "batiment_groupe_bdtopo_bat.csv",
    (fields, headers) => {
      const natureIdx = headers.indexOf("l_nature");
      return fields[natureIdx]?.includes("Serre") ?? false;
    },
    (fields, headers) => {
      const id = fields[headers.indexOf("batiment_groupe_id")];
      serreIds.add(id);
      serreData.set(id, {
        batiment_groupe_id: id,
        code_departement: dept,
        nature: fields[headers.indexOf("l_nature")]?.replace(/[\[\]"]/g, "").trim() || null,
        usage_1: fields[headers.indexOf("l_usage_1")]?.replace(/[\[\]"]/g, "").trim() || null,
        usage_2: fields[headers.indexOf("l_usage_2")]?.replace(/[\[\]"]/g, "").trim() || null,
        etat: fields[headers.indexOf("l_etat")]?.replace(/[\[\]"]/g, "").trim() || null,
        hauteur_moy: parseFloat(fields[headers.indexOf("hauteur_mean")]) || null,
        hauteur_max: parseFloat(fields[headers.indexOf("max_hauteur")]) || null,
        altitude_sol: parseFloat(fields[headers.indexOf("altitude_sol_mean")]) || null,
      });
    }
  );

  console.log(`    → ${serreIds.size} bâtiments-serres trouvés`);
  if (serreIds.size === 0) return 0;

  // Step 2: Récupérer géométrie + commune depuis batiment_groupe
  console.log(`  [2/5] Géolocalisation (batiment_groupe)...`);
  await streamCsvFromZip(zipPath, "batiment_groupe.csv",
    (fields, headers) => serreIds.has(fields[headers.indexOf("batiment_groupe_id")]),
    (fields, headers) => {
      const id = fields[headers.indexOf("batiment_groupe_id")];
      const data = serreData.get(id);
      if (!data) return;

      const geom = fields[headers.indexOf("geom_groupe")];
      const centroid = centroidFromMultipolygon(geom);
      if (centroid) {
        const wgs = lambert93ToWgs84(centroid.x, centroid.y);
        data.centroid_lat = Math.round(wgs.lat * 1e6) / 1e6;
        data.centroid_lon = Math.round(wgs.lon * 1e6) / 1e6;
      }

      data.surface_m2 = parseFloat(fields[headers.indexOf("s_geom_groupe")]) || null;
      data.commune = fields[headers.indexOf("libelle_commune_insee")]?.replace(/"/g, "") || null;
      data.code_commune_insee = fields[headers.indexOf("code_commune_insee")]?.replace(/"/g, "") || null;
    }
  );

  // Step 3: Parcelle cadastrale
  console.log(`  [3/5] Parcelles cadastrales...`);
  await streamCsvFromZip(zipPath, "rel_batiment_groupe_parcelle.csv",
    (fields, headers) => serreIds.has(fields[headers.indexOf("batiment_groupe_id")]),
    (fields, headers) => {
      const id = fields[headers.indexOf("batiment_groupe_id")];
      const data = serreData.get(id);
      if (data && fields[headers.indexOf("parcelle_principale")] === "1") {
        data.parcelle_id = fields[headers.indexOf("parcelle_id")]?.replace(/"/g, "") || null;
      }
    }
  );

  // Step 4: Propriétaire (via relation + table proprietaire)
  console.log(`  [4/5] Propriétaires...`);
  const serrePersonne = new Map<string, string>(); // batiment_id → personne_id

  await streamCsvFromZip(zipPath, "rel_batiment_groupe_proprietaire.csv",
    (fields, headers) => serreIds.has(fields[headers.indexOf("batiment_groupe_id")]),
    (fields, headers) => {
      const batId = fields[headers.indexOf("batiment_groupe_id")];
      const persId = fields[headers.indexOf("personne_id")]?.replace(/"/g, "");
      if (persId) serrePersonne.set(batId, persId);
    }
  );

  if (serrePersonne.size > 0) {
    const personneIds = new Set(serrePersonne.values());
    await streamCsvFromZip(zipPath, "proprietaire.csv",
      (fields, headers) => personneIds.has(fields[headers.indexOf("personne_id")]?.replace(/"/g, "")),
      (fields, headers) => {
        const persId = fields[headers.indexOf("personne_id")]?.replace(/"/g, "");
        // Trouver les bâtiments liés à cette personne
        for (const [batId, pId] of serrePersonne) {
          if (pId === persId) {
            const data = serreData.get(batId);
            if (data) {
              data.proprietaire_siren = fields[headers.indexOf("siren")]?.replace(/"/g, "") || null;
              data.proprietaire_denomination = fields[headers.indexOf("denomination")]?.replace(/"/g, "") || null;
              data.proprietaire_forme_juridique = fields[headers.indexOf("forme_juridique")]?.replace(/"/g, "") || null;
            }
          }
        }
      }
    );
  }

  // Step 5: Adresse BAN
  console.log(`  [5/5] Adresses...`);
  await streamCsvFromZip(zipPath, "batiment_groupe_adresse.csv",
    (fields, headers) => serreIds.has(fields[headers.indexOf("batiment_groupe_id")]),
    (fields, headers) => {
      const id = fields[headers.indexOf("batiment_groupe_id")];
      const data = serreData.get(id);
      if (data) {
        data.adresse = fields[headers.indexOf("libelle_adr_principale_ban")]?.replace(/"/g, "") || null;
      }
    }
  );

  // Insert en BDD par batch
  const serres = Array.from(serreData.values()).filter(s => s.centroid_lat && s.centroid_lon);
  console.log(`  → ${serres.length} serres avec coordonnées valides`);

  for (let i = 0; i < serres.length; i += BATCH_SIZE) {
    const batch = serres.slice(i, i + BATCH_SIZE);
    await sql`
      INSERT INTO bdnb_serres ${sql(batch.map(s => ({
        batiment_groupe_id: s.batiment_groupe_id!,
        code_departement: s.code_departement!,
        commune: s.commune || null,
        code_commune_insee: s.code_commune_insee || null,
        centroid_lat: s.centroid_lat!,
        centroid_lon: s.centroid_lon!,
        surface_m2: s.surface_m2 || null,
        nature: s.nature || null,
        usage_1: s.usage_1 || null,
        usage_2: s.usage_2 || null,
        etat: s.etat || null,
        hauteur_moy: s.hauteur_moy || null,
        hauteur_max: s.hauteur_max || null,
        altitude_sol: s.altitude_sol || null,
        parcelle_id: s.parcelle_id || null,
        proprietaire_siren: s.proprietaire_siren || null,
        proprietaire_denomination: s.proprietaire_denomination || null,
        proprietaire_forme_juridique: s.proprietaire_forme_juridique || null,
        adresse: s.adresse || null,
      })))}
      ON CONFLICT (batiment_groupe_id) DO UPDATE SET
        commune = EXCLUDED.commune,
        centroid_lat = EXCLUDED.centroid_lat,
        centroid_lon = EXCLUDED.centroid_lon,
        surface_m2 = EXCLUDED.surface_m2,
        nature = EXCLUDED.nature,
        usage_1 = EXCLUDED.usage_1,
        usage_2 = EXCLUDED.usage_2,
        etat = EXCLUDED.etat,
        hauteur_moy = EXCLUDED.hauteur_moy,
        hauteur_max = EXCLUDED.hauteur_max,
        altitude_sol = EXCLUDED.altitude_sol,
        parcelle_id = EXCLUDED.parcelle_id,
        proprietaire_siren = EXCLUDED.proprietaire_siren,
        proprietaire_denomination = EXCLUDED.proprietaire_denomination,
        proprietaire_forme_juridique = EXCLUDED.proprietaire_forme_juridique,
        adresse = EXCLUDED.adresse
    `;
  }

  return serres.length;
}

async function downloadZip(dept: string): Promise<string> {
  // Pattern URL: millesime_2025-07-a_dep84/open_data_millesime_2025-07-a_dep84_csv.zip
  const url = `${BDNB_BASE_URL}/millesime_${BDNB_MILLESIME}_dep${dept}/open_data_millesime_${BDNB_MILLESIME}_dep${dept}_csv.zip`;
  const zipPath = join(DATA_DIR, `dep${dept}_csv.zip`);

  if (existsSync(zipPath)) {
    console.log(`  ZIP déjà présent, skip download`);
    return zipPath;
  }

  console.log(`  Téléchargement ${url}...`);
  const resp = await fetch(url);
  if (!resp.ok) {
    throw new Error(`HTTP ${resp.status} pour dept ${dept}`);
  }

  const fileStream = createWriteStream(zipPath);
  // @ts-ignore - ReadableStream vers Node stream
  await pipeline(resp.body as any, fileStream);

  const sizeMb = Math.round((await import("fs")).statSync(zipPath).size / 1024 / 1024);
  console.log(`  → ${sizeMb} Mo téléchargés`);

  return zipPath;
}

async function main() {
  const args = process.argv.slice(2);
  let depts = [...ALL_DEPTS];

  // Parse args
  const deptIdx = args.indexOf("--dept");
  if (deptIdx !== -1 && args[deptIdx + 1]) {
    depts = [args[deptIdx + 1]];
  }

  const startIdx = args.indexOf("--start");
  if (startIdx !== -1 && args[startIdx + 1]) {
    const startDept = args[startIdx + 1];
    const idx = depts.indexOf(startDept);
    if (idx !== -1) depts = depts.slice(idx);
  }

  console.log("╔══════════════════════════════════════════╗");
  console.log("║   Import BDNB Serres — France entière   ║");
  console.log("╚══════════════════════════════════════════╝");
  console.log(`\nDépartements à traiter : ${depts.length}`);

  // Créer la table si nécessaire
  const migrationPath = resolve(__dirname, "../migrations/004_bdnb_serres.sql");
  if (existsSync(migrationPath)) {
    const { readFileSync } = require("fs");
    const migrationSql = readFileSync(migrationPath, "utf-8");
    await sql.unsafe(migrationSql);
    console.log("Table bdnb_serres créée/vérifiée\n");
  }

  mkdirSync(DATA_DIR, { recursive: true });

  let totalSerres = 0;
  let totalWithSiren = 0;
  const results: { dept: string; count: number }[] = [];

  for (let i = 0; i < depts.length; i++) {
    const dept = depts[i];
    console.log(`\n━━━ Département ${dept} [${i + 1}/${depts.length}] ━━━`);

    try {
      // 1. Télécharger
      const zipPath = await downloadZip(dept);

      // 2. Extraire et insérer les serres
      const count = await processDepartement(dept, zipPath);
      totalSerres += count;
      results.push({ dept, count });

      // 3. Compter les serres avec SIREN pour ce dept
      const [sirenCount] = await sql`
        SELECT COUNT(*) as c FROM bdnb_serres
        WHERE code_departement = ${dept} AND proprietaire_siren IS NOT NULL
      `;
      totalWithSiren += Number(sirenCount.c);

      console.log(`  ✓ Dept ${dept} : ${count} serres (${sirenCount.c} avec SIREN)`);

      // 4. Supprimer le ZIP pour libérer l'espace
      if (!args.includes("--keep")) {
        unlinkSync(zipPath);
        console.log(`  🗑 ZIP supprimé`);
      }

    } catch (err: any) {
      console.error(`  ✗ Erreur dept ${dept} : ${err.message}`);
      // Nettoyer le ZIP corrompu si il existe
      const zipPath = join(DATA_DIR, `dep${dept}_csv.zip`);
      if (existsSync(zipPath)) {
        try { unlinkSync(zipPath); } catch {}
      }
      continue;
    }
  }

  // Résumé final
  console.log("\n╔══════════════════════════════════════════╗");
  console.log("║            RÉSUMÉ FINAL                 ║");
  console.log("╚══════════════════════════════════════════╝");
  console.log(`Total serres BDNB : ${totalSerres}`);
  console.log(`Dont avec SIREN   : ${totalWithSiren} (${totalSerres > 0 ? Math.round(totalWithSiren / totalSerres * 100) : 0}%)`);
  console.log(`\nTop départements :`);
  results
    .sort((a, b) => b.count - a.count)
    .slice(0, 10)
    .forEach(r => console.log(`  ${r.dept} : ${r.count} serres`));

  // Matcher BDNB avec nos serres RPG
  console.log("\n━━━ Matching BDNB ↔ RPG ━━━");
  await matchBdnbToRpg();

  await sql.end();
  console.log("\n✓ Terminé !");
}

async function matchBdnbToRpg() {
  // Pour chaque serre BDNB, trouver la serre RPG la plus proche (< 200m)
  const result = await sql`
    UPDATE bdnb_serres b
    SET serre_rpg_id = sub.serre_id,
        distance_rpg_m = sub.dist_m
    FROM (
      SELECT DISTINCT ON (b2.batiment_groupe_id)
        b2.batiment_groupe_id,
        s.id as serre_id,
        (
          6371000 * acos(
            LEAST(1.0,
              cos(radians(b2.centroid_lat)) * cos(radians(s.centroid_lat)) *
              cos(radians(s.centroid_lon) - radians(b2.centroid_lon)) +
              sin(radians(b2.centroid_lat)) * sin(radians(s.centroid_lat))
            )
          )
        ) as dist_m
      FROM bdnb_serres b2
      CROSS JOIN LATERAL (
        SELECT id, centroid_lat, centroid_lon
        FROM serres s
        WHERE s.departement = b2.code_departement
          AND ABS(s.centroid_lat - b2.centroid_lat) < 0.003
          AND ABS(s.centroid_lon - b2.centroid_lon) < 0.003
        ORDER BY (
          (s.centroid_lat - b2.centroid_lat) * (s.centroid_lat - b2.centroid_lat) +
          (s.centroid_lon - b2.centroid_lon) * (s.centroid_lon - b2.centroid_lon)
        )
        LIMIT 1
      ) s
      WHERE b2.serre_rpg_id IS NULL
    ) sub
    WHERE b.batiment_groupe_id = sub.batiment_groupe_id
      AND sub.dist_m < 200
  `;

  const [stats] = await sql`
    SELECT
      COUNT(*) as total_bdnb,
      COUNT(serre_rpg_id) as matched,
      COUNT(*) FILTER (WHERE proprietaire_siren IS NOT NULL AND serre_rpg_id IS NOT NULL) as matched_with_siren
    FROM bdnb_serres
  `;

  console.log(`  Total BDNB     : ${stats.total_bdnb}`);
  console.log(`  Matchées RPG   : ${stats.matched} (< 200m)`);
  console.log(`  Avec SIREN     : ${stats.matched_with_siren}`);
}

main().catch(err => {
  console.error("Erreur fatale:", err);
  process.exit(1);
});
