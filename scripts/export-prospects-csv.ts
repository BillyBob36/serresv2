/**
 * Export prospects CSV for PJ scraper.
 *
 * Usage: npx tsx scripts/export-prospects-csv.ts <batch_id> [output_file]
 * Output: prospects.csv (siren,nom,commune,departement)
 */

import postgres from "postgres";
import * as dotenv from "dotenv";
import { resolve } from "path";
import { writeFileSync } from "fs";

dotenv.config({ path: resolve(__dirname, "../.env.local") });

const sql = postgres(
  process.env.DATABASE_URL || "postgresql://serres:SerresV2_2024!@65.21.146.193:5433/serresv2",
  { max: 3, connect_timeout: 10 }
);

function csvEscape(s: string): string {
  if (s.includes(",") || s.includes('"') || s.includes("\n")) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

async function main() {
  const batchId = parseInt(process.argv[2], 10);
  const outputFile = process.argv[3] || resolve(__dirname, "../data/prospects_pj.csv");

  if (!batchId) {
    console.error("Usage: npx tsx scripts/export-prospects-csv.ts <batch_id> [output_file]");
    process.exit(1);
  }

  const prospects = await sql`
    SELECT siren, nom_complet, libelle_commune_siege, code_postal_siege
    FROM data_api_gouv
    WHERE batch_id = ${batchId} AND nom_complet IS NOT NULL AND nom_complet != ''
  `;

  // Exclude already enriched
  const done = await sql`SELECT siren FROM data_pages_jaunes WHERE batch_id = ${batchId}`;
  const doneSet = new Set(done.map((r: any) => r.siren));

  const header = "siren,nom,commune,departement";
  const lines = prospects
    .filter((p: any) => !doneSet.has(p.siren))
    .map((p: any) => {
      const dep = (p.code_postal_siege || "").substring(0, 2);
      return `${p.siren},${csvEscape(p.nom_complet || "")},${csvEscape(p.libelle_commune_siege || "")},${dep}`;
    });

  const content = [header, ...lines].join("\n");
  writeFileSync(outputFile, content, "utf-8");
  console.log(`Exported ${lines.length} prospects to ${outputFile} (${doneSet.size} already enriched, skipped)`);

  await sql.end();
}

main().catch((err) => {
  console.error("Error:", err);
  process.exit(1);
});
