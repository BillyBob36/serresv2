/**
 * Import merged Google Places CSV into database.
 * Same logic as upload/route.ts but runs standalone.
 *
 * Usage: npx tsx scripts/import-google-csv.ts <batch_id> <csv_file>
 */
import postgres from "postgres";
import * as dotenv from "dotenv";
import { resolve } from "path";
import { readFileSync } from "fs";

dotenv.config({ path: resolve(__dirname, "../.env.local") });

const sql = postgres(
  process.env.DATABASE_URL || "postgresql://serres:SerresV2_2024!@65.21.146.193:5433/serresv2",
  { max: 5, connect_timeout: 10 }
);

function parseCSV(text: string): Record<string, string>[] {
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) return [];

  const parseRow = (line: string): string[] => {
    const fields: string[] = [];
    let current = "";
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        if (inQuotes && line[i + 1] === '"') { current += '"'; i++; }
        else inQuotes = !inQuotes;
      } else if (ch === "," && !inQuotes) {
        fields.push(current.trim());
        current = "";
      } else {
        current += ch;
      }
    }
    fields.push(current.trim());
    return fields;
  };

  const headers = parseRow(lines[0]).map((h) => h.replace(/^\uFEFF/, ""));
  const rows: Record<string, string>[] = [];

  for (let i = 1; i < lines.length; i++) {
    const values = parseRow(lines[i]);
    if (values.length === 0 || (values.length === 1 && !values[0])) continue;
    const row: Record<string, string> = {};
    headers.forEach((h, j) => { row[h] = values[j] || ""; });
    rows.push(row);
  }

  return rows;
}

async function main() {
  const batchId = parseInt(process.argv[2] || "1", 10);
  const csvPath = process.argv[3] || resolve(__dirname, "../data/google-csv/merged_google.csv");

  console.log(`Importing Google Places CSV for batch ${batchId}`);
  console.log(`File: ${csvPath}`);

  const text = readFileSync(csvPath, "utf-8");
  const rows = parseCSV(text);
  console.log(`Parsed ${rows.length} rows`);

  // Get valid SIRENs
  const validRows = await sql`
    SELECT DISTINCT siren FROM serre_matches WHERE siren IS NOT NULL
    UNION
    SELECT DISTINCT siren FROM data_api_gouv WHERE batch_id = ${batchId} AND siren IS NOT NULL
  `;
  const validSirens = new Set(validRows.map((r: any) => r.siren));
  console.log(`Valid SIRENs: ${validSirens.size}`);

  // Get already enriched
  const existing = await sql`SELECT siren FROM data_google_places WHERE batch_id = ${batchId}`;
  const existingSet = new Set(existing.map((r: any) => r.siren));
  console.log(`Already enriched: ${existingSet.size}`);

  let inserted = 0;
  let skipped = 0;
  let errCount = 0;

  for (const row of rows) {
    try {
      const siren = row.siren || "";
      if (!siren || !validSirens.has(siren)) { skipped++; continue; }
      if (existingSet.has(siren)) { skipped++; continue; }

      const phone = row.phone || row.telephone || null;
      const website = row.website || row.site_web || null;
      const rating = parseFloat(row.review_rating || row.rating || "") || null;
      const reviewCount = parseInt(row.review_count || row.avis_count || "", 10) || null;
      const hours = row.open_hours || row.hours || row.horaires || null;
      const address = row.address || row.formatted_address || null;
      const category = row.category || row.type || row.primary_type || null;
      const status = row.status || row.business_status || null;
      const email = row.emails || row.email || null;

      await sql`
        INSERT INTO data_google_places (
          batch_id, siren, telephone, site_web, email, note_google,
          horaires, avis_count, google_business_status,
          google_formatted_address, google_primary_type, enrichi_at
        ) VALUES (
          ${batchId}, ${siren}, ${phone}, ${website}, ${email}, ${rating},
          ${hours}, ${reviewCount}, ${status},
          ${address}, ${category}, NOW()
        ) ON CONFLICT (batch_id, siren) DO UPDATE SET
          telephone = COALESCE(EXCLUDED.telephone, data_google_places.telephone),
          site_web = COALESCE(EXCLUDED.site_web, data_google_places.site_web),
          email = COALESCE(EXCLUDED.email, data_google_places.email),
          note_google = COALESCE(EXCLUDED.note_google, data_google_places.note_google),
          horaires = COALESCE(EXCLUDED.horaires, data_google_places.horaires),
          avis_count = COALESCE(EXCLUDED.avis_count, data_google_places.avis_count),
          enrichi_at = NOW()
      `;
      existingSet.add(siren);
      inserted++;

      if (inserted % 500 === 0) {
        console.log(`  Progress: ${inserted} inserted, ${skipped} skipped, ${errCount} errors`);
      }
    } catch (err) {
      errCount++;
      if (errCount <= 5) console.error(`[Import] Error row ${row.siren}:`, err);
    }
  }

  // Update batch API status
  await sql`
    INSERT INTO enrichissement_batch_api (batch_id, api_name, statut, nb_total, nb_enrichis, completed_at)
    VALUES (${batchId}, 'google_places', 'done', ${rows.length}, ${inserted}, NOW())
    ON CONFLICT (batch_id, api_name) DO UPDATE SET
      statut = 'done', nb_enrichis = enrichissement_batch_api.nb_enrichis + ${inserted}, completed_at = NOW()
  `;

  console.log(`\nImport termine:`);
  console.log(`  Inseres: ${inserted}`);
  console.log(`  Ignores: ${skipped}`);
  console.log(`  Erreurs: ${errCount}`);

  await sql.end();
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
