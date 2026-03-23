/**
 * Import merged Pages Jaunes CSV into database.
 * Usage: npx tsx scripts/import-pj-csv.ts <batch_id> [csv_file]
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
  const csvPath = process.argv[3] || resolve(__dirname, "../data/pj-csv/merged_pj.csv");

  console.log(`Importing Pages Jaunes CSV for batch ${batchId}`);
  console.log(`File: ${csvPath}`);

  const text = readFileSync(csvPath, "utf-8");
  const rows = parseCSV(text);
  console.log(`Parsed ${rows.length} rows`);

  // Filter out not_found rows
  const validRows = rows.filter((r) => r.match_confidence !== "not_found" && r.raison_social);
  console.log(`Valid rows (not not_found, has name): ${validRows.length}`);

  // Get valid SIRENs
  const validSirenRows = await sql`
    SELECT DISTINCT siren FROM serre_matches WHERE siren IS NOT NULL
    UNION
    SELECT DISTINCT siren FROM data_api_gouv WHERE batch_id = ${batchId} AND siren IS NOT NULL
  `;
  const validSirens = new Set(validSirenRows.map((r: any) => r.siren));
  console.log(`Valid SIRENs in DB: ${validSirens.size}`);

  // Get already enriched
  const existing = await sql`SELECT siren FROM data_pages_jaunes WHERE batch_id = ${batchId}`;
  const existingSet = new Set(existing.map((r: any) => r.siren));
  console.log(`Already enriched: ${existingSet.size}`);

  let inserted = 0;
  let updated = 0;
  let skipped = 0;
  let errCount = 0;

  for (const row of validRows) {
    try {
      const siren = row.siren_match || "";
      if (!siren || !validSirens.has(siren)) { skipped++; continue; }

      // Parse phone — can be multiple separated by |
      const phones = (row.telephone || "").split("|").map((p: string) => p.trim()).filter(Boolean);

      const email = row.email || null;
      const horaires = row.horaires || null;
      const notePj = parseFloat(row.note || "") || null;
      const nbAvis = parseInt(row.nb_avis || "", 10) || null;
      const matchConf = row.match_confidence || null;
      const sourcePers = row.source_personne || null;

      await sql`
        INSERT INTO data_pages_jaunes (
          batch_id, siren, raison_social, description,
          adresse, code_postal, ville, telephone,
          siret, naf, forme_juridique, activite,
          site_web, url_pj, email, horaires, note_pj, nb_avis,
          match_confidence, source_personne, enrichi_at
        ) VALUES (
          ${batchId}, ${siren}, ${row.raison_social || null}, ${row.description || null},
          ${row.adresse || null}, ${row.code_postal || null}, ${row.ville || null}, ${sql.array(phones)},
          ${row.siret_pj || null}, ${row.naf || null}, ${row.forme_juridique || null}, ${row.activite || null},
          ${row.site_web || null}, ${row.url_fiche || null}, ${email}, ${horaires}, ${notePj}, ${nbAvis},
          ${matchConf}, ${sourcePers}, NOW()
        ) ON CONFLICT (batch_id, siren) DO UPDATE SET
          telephone = COALESCE(
            CASE WHEN array_length(EXCLUDED.telephone, 1) > 0 THEN EXCLUDED.telephone ELSE NULL END,
            data_pages_jaunes.telephone
          ),
          site_web = COALESCE(EXCLUDED.site_web, data_pages_jaunes.site_web),
          email = COALESCE(EXCLUDED.email, data_pages_jaunes.email),
          raison_social = COALESCE(EXCLUDED.raison_social, data_pages_jaunes.raison_social),
          description = COALESCE(EXCLUDED.description, data_pages_jaunes.description),
          adresse = COALESCE(EXCLUDED.adresse, data_pages_jaunes.adresse),
          code_postal = COALESCE(EXCLUDED.code_postal, data_pages_jaunes.code_postal),
          ville = COALESCE(EXCLUDED.ville, data_pages_jaunes.ville),
          siret = COALESCE(EXCLUDED.siret, data_pages_jaunes.siret),
          naf = COALESCE(EXCLUDED.naf, data_pages_jaunes.naf),
          activite = COALESCE(EXCLUDED.activite, data_pages_jaunes.activite),
          url_pj = COALESCE(EXCLUDED.url_pj, data_pages_jaunes.url_pj),
          horaires = COALESCE(EXCLUDED.horaires, data_pages_jaunes.horaires),
          note_pj = COALESCE(EXCLUDED.note_pj, data_pages_jaunes.note_pj),
          nb_avis = COALESCE(EXCLUDED.nb_avis, data_pages_jaunes.nb_avis),
          match_confidence = COALESCE(EXCLUDED.match_confidence, data_pages_jaunes.match_confidence),
          source_personne = COALESCE(EXCLUDED.source_personne, data_pages_jaunes.source_personne),
          enrichi_at = NOW()
      `;

      if (existingSet.has(siren)) {
        updated++;
      } else {
        inserted++;
        existingSet.add(siren);
      }

      if ((inserted + updated) % 500 === 0) {
        console.log(`  Progress: ${inserted} inserted, ${updated} updated, ${skipped} skipped, ${errCount} errors`);
      }
    } catch (err: any) {
      errCount++;
      if (errCount <= 5) console.error(`[Import] Error row ${row.siren_match}:`, err.message || err);
    }
  }

  // Update batch API status
  const totalEnriched = existingSet.size;
  await sql`
    INSERT INTO enrichissement_batch_api (batch_id, api_name, statut, nb_total, nb_enrichis, completed_at)
    VALUES (${batchId}, 'pages_jaunes', 'done', ${validSirens.size}, ${totalEnriched}, NOW())
    ON CONFLICT (batch_id, api_name) DO UPDATE SET
      statut = 'done', nb_enrichis = ${totalEnriched}, completed_at = NOW()
  `;

  // Also update dirigeants_complet with source_personne phone attribution
  let personUpdated = 0;
  for (const row of validRows) {
    if (!row.source_personne || !row.telephone) continue;
    const siren = row.siren_match || "";
    const phone = (row.telephone || "").split("|")[0]?.trim();
    if (!siren || !phone) continue;

    try {
      // Get current dirigeants_complet from data_api_gouv
      const [apiRow] = await sql`
        SELECT dirigeants_complet FROM data_api_gouv WHERE batch_id = ${batchId} AND siren = ${siren}
      `;
      if (!apiRow?.dirigeants_complet) continue;

      const dirs = typeof apiRow.dirigeants_complet === "string"
        ? JSON.parse(apiRow.dirigeants_complet)
        : apiRow.dirigeants_complet;
      if (!Array.isArray(dirs)) continue;

      // Find matching person and add phone
      const personName = row.source_personne.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
      let found = false;
      for (const d of dirs) {
        const dName = `${d.prenoms || d.prenom || ""} ${d.nom || ""}`.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();
        if (dName === personName || dName.includes(personName) || personName.includes(dName)) {
          d.telephone = phone;
          found = true;
          break;
        }
      }

      if (found) {
        await sql`
          UPDATE data_api_gouv SET dirigeants_complet = ${JSON.stringify(dirs)}::jsonb
          WHERE batch_id = ${batchId} AND siren = ${siren}
        `;
        personUpdated++;
      }
    } catch { /* ignore person update errors */ }
  }

  console.log(`\nImport termine:`);
  console.log(`  Inseres: ${inserted}`);
  console.log(`  Mis a jour: ${updated}`);
  console.log(`  Ignores: ${skipped}`);
  console.log(`  Erreurs: ${errCount}`);
  console.log(`  Dirigeants avec tel attribue: ${personUpdated}`);

  await sql.end();
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
