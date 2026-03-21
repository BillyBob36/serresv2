/**
 * Export Google Maps queries for gosom scraper.
 *
 * Usage: npx tsx scripts/export-google-queries.ts <batch_id> [output_file]
 * Output: queries.txt (one query per line: "company_name city")
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

async function main() {
  const batchId = parseInt(process.argv[2], 10);
  const outputFile = process.argv[3] || resolve(__dirname, "../data/queries_google.txt");

  if (!batchId) {
    console.error("Usage: npx tsx scripts/export-google-queries.ts <batch_id> [output_file]");
    process.exit(1);
  }

  const prospects = await sql`
    SELECT siren, nom_complet, libelle_commune_siege
    FROM data_api_gouv
    WHERE batch_id = ${batchId} AND nom_complet IS NOT NULL AND nom_complet != ''
  `;

  // Exclude already enriched
  const done = await sql`SELECT siren FROM data_google_places WHERE batch_id = ${batchId}`;
  const doneSet = new Set(done.map((r: any) => r.siren));

  const lines = prospects
    .filter((p: any) => !doneSet.has(p.siren))
    .map((p: any) => `${(p.nom_complet || "").trim()} ${(p.libelle_commune_siege || "").trim()}`)
    .filter((l: string) => l.trim().length > 3);

  writeFileSync(outputFile, lines.join("\n"), "utf-8");
  console.log(`Exported ${lines.length} queries to ${outputFile} (${doneSet.size} already enriched, skipped)`);

  await sql.end();
}

main().catch((err) => {
  console.error("Error:", err);
  process.exit(1);
});
