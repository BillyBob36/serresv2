/**
 * Export Google Maps queries for RE-SCRAPING.
 * Targets: SIRENs not found + found but without contact data.
 * Uses improved name variant generation (strip forme + linking words).
 *
 * Usage: npx tsx scripts/export-google-rescrape.ts <batch_id> [output_file]
 * Output: queries.txt — format: "siren|query_text" (one per line)
 */
import postgres from "postgres";
import * as dotenv from "dotenv";
import { resolve } from "path";
import { writeFileSync } from "fs";

dotenv.config({ path: resolve(__dirname, "../.env.local") });

const sql = postgres(
  process.env.DATABASE_URL || "postgresql://serres:SerresV2_2024!@65.21.146.193:5433/serresv2",
  { max: 5, connect_timeout: 10 }
);

const FORMES = [
  "sarl", "sas", "sasu", "sa", "eurl", "earl", "gaec", "gfa", "sci",
  "scea", "gie", "snc", "selarl", "scp", "cooperative", "cuma",
  "exploitation agricole", "societe civile", "groupement agricole",
  "groupement foncier", "societe en nom collectif",
];

function stripFormeJuridique(name: string): string {
  let cleaned = name;
  for (const forme of FORMES) {
    cleaned = cleaned.replace(new RegExp(`^${forme}\\s+`, "i"), "");
    cleaned = cleaned.replace(new RegExp(`\\s+${forme}$`, "i"), "");
    // Also handle parenthesized forms: "NOM (EARL)"
    cleaned = cleaned.replace(new RegExp(`\\s*\\(${forme}\\)\\s*`, "i"), " ");
  }
  // Strip linking words: DES, DE, DU, DE LA, DE L', D', L'
  cleaned = cleaned.replace(/^(des|de la|de l'|du|de|d'|l')\s+/i, "").trim();
  return cleaned;
}

function buildNameVariants(p: any): string[] {
  const seen = new Set<string>();
  const variants: string[] = [];

  function add(name: string | null | undefined) {
    if (!name || name.trim().length < 3) return;
    const key = name.trim().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    if (seen.has(key)) return;
    seen.add(key);
    variants.push(name.trim());
  }

  // 1. Original name
  add(p.nom_complet);
  // 2. Legal name
  add(p.nom_raison_sociale);
  // 3. Stripped version (forme juridique + linking words)
  if (p.nom_complet) {
    const stripped = stripFormeJuridique(p.nom_complet);
    if (stripped !== p.nom_complet) add(stripped);
  }
  // 4. Acronym
  add(p.sigle);
  // 5. Historical names from INSEE
  try {
    const hist = typeof p.periodes_historique === "string"
      ? JSON.parse(p.periodes_historique) : p.periodes_historique;
    if (Array.isArray(hist)) {
      for (const period of hist) {
        if (period.denomination) add(period.denomination);
      }
    }
  } catch { /* ignore */ }

  // 6. Dirigeant names (new! for individual farmers)
  try {
    const dirs = typeof p.dirigeants_complet === "string"
      ? JSON.parse(p.dirigeants_complet) : p.dirigeants_complet;
    if (Array.isArray(dirs)) {
      for (const d of dirs) {
        if (d.type_dirigeant !== "personne physique") continue;
        const fullName = `${(d.prenoms || d.prenom || "").split(" ")[0]} ${d.nom || ""}`.trim();
        if (fullName.length > 5) add(fullName);
      }
    }
  } catch { /* ignore */ }

  return variants;
}

async function main() {
  const batchId = parseInt(process.argv[2] || "1", 10);
  const outputFile = process.argv[3] || resolve(__dirname, "../data/google_rescrape_queries.txt");

  console.log(`Exporting Google re-scrape queries for batch ${batchId}...`);

  // Get SIRENs that need re-scraping:
  // 1. Not in data_google_places at all
  // 2. In data_google_places but without any contact info
  const prospects = await sql`
    SELECT g.siren, g.nom_complet, g.nom_raison_sociale, g.sigle,
           g.libelle_commune_siege, g.dirigeants_complet,
           i.periodes_historique,
           CASE
             WHEN gp.siren IS NULL THEN 'not_found'
             ELSE 'no_contact'
           END as reason
    FROM data_api_gouv g
    LEFT JOIN data_insee i ON i.batch_id = g.batch_id AND i.siren = g.siren
    LEFT JOIN data_google_places gp ON gp.batch_id = g.batch_id AND gp.siren = g.siren
    WHERE g.batch_id = ${batchId}
      AND g.nom_complet IS NOT NULL AND g.nom_complet != ''
      AND (
        gp.siren IS NULL
        OR (
          (gp.telephone IS NULL OR gp.telephone = '')
          AND (gp.site_web IS NULL OR gp.site_web = '')
          AND (gp.email IS NULL OR gp.email = '')
        )
      )
    ORDER BY g.siren
  `;

  const notFound = prospects.filter(p => p.reason === "not_found").length;
  const noContact = prospects.filter(p => p.reason === "no_contact").length;
  console.log(`  Not found previously: ${notFound}`);
  console.log(`  Found but no contact: ${noContact}`);
  console.log(`  Total to re-scrape: ${prospects.length}`);

  const lines: string[] = [];
  let totalQueries = 0;

  for (const p of prospects) {
    const city = p.libelle_commune_siege || "";
    const variants = buildNameVariants(p);

    for (const name of variants) {
      const query = city ? `${name} ${city}` : name;
      lines.push(`${p.siren}|${query}`);
      totalQueries++;
    }
  }

  writeFileSync(outputFile, lines.join("\n") + "\n", "utf-8");

  console.log(`\nExport termine:`);
  console.log(`  SIRENs: ${prospects.length}`);
  console.log(`  Total queries (with variants): ${totalQueries}`);
  console.log(`  Avg variants per SIREN: ${(totalQueries / prospects.length).toFixed(1)}`);
  console.log(`  Fichier: ${outputFile}`);

  await sql.end();
}

main().catch((err) => { console.error("Error:", err); process.exit(1); });
