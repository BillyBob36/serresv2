/**
 * Export PJ prospects CSV — DIRIGEANTS ONLY.
 * For SIRENs that were NOT found by the first PJ scrape,
 * generates one row per dirigeant person (not per company).
 *
 * Usage: npx tsx scripts/export-pj-dirigeants.ts <batch_id> [output_file] [--limit N]
 */
import postgres from "postgres";
import * as dotenv from "dotenv";
import { resolve } from "path";
import { writeFileSync, mkdirSync } from "fs";
import { dirname } from "path";

dotenv.config({ path: resolve(__dirname, "../.env.local") });

const sql = postgres(
  process.env.DATABASE_URL || "postgresql://serres:SerresV2_2024!@65.21.146.193:5433/serresv2",
  { max: 5, connect_timeout: 10 }
);

function csvEscape(s: string): string {
  if (s.includes(",") || s.includes('"') || s.includes("\n")) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

async function main() {
  const batchId = parseInt(process.argv[2] || "1", 10);
  const outputFile = process.argv[3] || resolve(__dirname, "../data/prospects_pj_dirigeants.csv");

  // Optional limit for testing
  const limitIdx = process.argv.indexOf("--limit");
  const limit = limitIdx >= 0 ? parseInt(process.argv[limitIdx + 1], 10) : 0;

  console.log(`Exporting PJ dirigeant queries for batch ${batchId}...`);
  if (limit) console.log(`  Limit: ${limit} SIRENs`);

  // Get SIRENs that have NO PJ data (not found in first scrape)
  const prospects = await sql`
    SELECT g.siren, g.nom_complet, g.libelle_commune_siege, g.code_postal_siege, g.dirigeants_complet
    FROM data_api_gouv g
    WHERE g.batch_id = ${batchId}
      AND g.nom_complet IS NOT NULL AND g.nom_complet != ''
      AND NOT EXISTS (
        SELECT 1 FROM data_pages_jaunes pj
        WHERE pj.siren = g.siren AND pj.batch_id = ${batchId}
      )
    ORDER BY g.siren
  `;

  console.log(`  SIRENs sans resultat PJ: ${prospects.length}`);

  const header = "siren,nom,noms_alternatifs,commune,departement,dirigeants";
  const csvLines: string[] = [];
  let withDirigeants = 0;
  let withoutDirigeants = 0;

  const processedSirens = limit ? prospects.slice(0, limit) : prospects;

  for (const p of processedSirens) {
    const siren = p.siren || "";
    const commune = p.libelle_commune_siege || "";
    const cp = (p.code_postal_siege || "").substring(0, 2);

    // Parse dirigeants
    let dirigeantNames: string[] = [];
    try {
      const dirs = typeof p.dirigeants_complet === "string"
        ? JSON.parse(p.dirigeants_complet)
        : p.dirigeants_complet;
      if (Array.isArray(dirs)) {
        dirigeantNames = dirs
          .filter((d: any) => d.type_dirigeant === "personne physique")
          .map((d: any) => {
            const prenoms = (d.prenoms || d.prenom || "").trim();
            const nom = (d.nom || "").trim();
            // Use full first name (not just first word) for better matching
            return `${prenoms} ${nom}`.trim();
          })
          .filter((n: string) => n.length > 3);
      }
    } catch { /* ignore */ }

    if (dirigeantNames.length === 0) {
      withoutDirigeants++;
      continue; // Skip SIRENs with no dirigeant person names
    }

    withDirigeants++;

    // PRIMARY search = first dirigeant name
    // ALT search = remaining dirigeant names + company name as fallback
    const primaryName = dirigeantNames[0];
    const altNames = [
      ...dirigeantNames.slice(1),
      p.nom_complet, // company name as fallback
    ].join("|");

    csvLines.push(
      `${siren},${csvEscape(primaryName)},${csvEscape(altNames)},${csvEscape(commune)},${cp},${csvEscape(dirigeantNames.join("|"))}`
    );
  }

  mkdirSync(dirname(outputFile), { recursive: true });
  writeFileSync(outputFile, [header, ...csvLines].join("\n"), "utf-8");

  console.log(`\nExport termine:`);
  console.log(`  SIRENs traites: ${processedSirens.length}`);
  console.log(`  Avec dirigeants physiques: ${withDirigeants}`);
  console.log(`  Sans dirigeants (ignores): ${withoutDirigeants}`);
  console.log(`  Lignes CSV: ${csvLines.length}`);
  console.log(`  Fichier: ${outputFile}`);

  await sql.end();
}

main().catch((err) => { console.error("Error:", err); process.exit(1); });
