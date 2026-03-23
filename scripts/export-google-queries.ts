/**
 * Export Google Maps queries for our Playwright scraper.
 * Generates multiple name variants per SIREN for maximum discovery.
 *
 * Usage: npx tsx scripts/export-google-queries.ts <batch_id> [output_file]
 * Output: queries.txt — format: "siren|company_name city" (one per line)
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
];

function stripFormeJuridique(name: string): string {
  let cleaned = name;
  for (const forme of FORMES) {
    // Strip forme at start: "EARL DES PEPINIERES" -> "DES PEPINIERES"
    cleaned = cleaned.replace(new RegExp(`^${forme}\\s+`, "i"), "");
    // Strip forme at end
    cleaned = cleaned.replace(new RegExp(`\\s+${forme}$`, "i"), "");
  }
  // Strip common linking words left at the start: DES, DE, DU, DE LA, DE L', D', L'
  cleaned = cleaned.replace(/^(des|de la|de l'|du|de|d'|l')\s+/i, "").trim();
  return cleaned;
}

function buildNameVariants(p: any): string[] {
  const seen = new Set<string>();
  const variants: string[] = [];

  function add(name: string | null | undefined) {
    if (!name || name.trim().length < 4) return;
    const key = name.trim().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    if (seen.has(key)) return;
    seen.add(key);
    variants.push(name.trim());
  }

  add(p.nom_complet);
  add(p.nom_raison_sociale);
  if (p.nom_complet) {
    const stripped = stripFormeJuridique(p.nom_complet);
    if (stripped !== p.nom_complet) add(stripped);
  }
  add(p.sigle);

  try {
    const hist = typeof p.periodes_historique === "string"
      ? JSON.parse(p.periodes_historique)
      : p.periodes_historique;
    if (Array.isArray(hist)) {
      for (const period of hist) {
        if (period.denomination) add(period.denomination);
      }
    }
  } catch { /* ignore */ }

  return variants;
}

async function main() {
  const batchId = parseInt(process.argv[2], 10);
  const outputFile = process.argv[3] || resolve(__dirname, "../data/queries_google.txt");

  if (!batchId) {
    console.error("Usage: npx tsx scripts/export-google-queries.ts <batch_id> [output_file]");
    process.exit(1);
  }

  console.log(`Exporting Google queries for batch ${batchId}...`);

  // Get all prospects with name variants from API Gouv + historical names from INSEE
  const prospects = await sql`
    SELECT g.siren, g.nom_complet, g.nom_raison_sociale, g.sigle,
           g.libelle_commune_siege, g.code_postal_siege,
           i.periodes_historique
    FROM data_api_gouv g
    LEFT JOIN data_insee i ON i.batch_id = g.batch_id AND i.siren = g.siren
    WHERE g.batch_id = ${batchId}
      AND g.nom_complet IS NOT NULL AND g.nom_complet != ''
    ORDER BY g.siren
  `;

  // Exclude already scraped
  const done = await sql`SELECT siren FROM data_google_places WHERE batch_id = ${batchId}`;
  const doneSet = new Set(done.map((r: any) => r.siren));

  const lines: string[] = [];
  let skippedDone = 0;

  for (const p of prospects) {
    if (doneSet.has(p.siren)) { skippedDone++; continue; }
    const siren = (p.siren || "").trim();
    const city = (p.libelle_commune_siege || "").trim();

    const variants = buildNameVariants(p);
    for (const name of variants) {
      const query = city ? `${name} ${city}` : name;
      if (query.trim().length > 3) {
        lines.push(`${siren}|${query}`);
      }
    }
  }

  // Ensure output directory exists
  const { mkdirSync } = await import("fs");
  const { dirname } = await import("path");
  mkdirSync(dirname(outputFile), { recursive: true });

  writeFileSync(outputFile, lines.join("\n"), "utf-8");

  const sirens = new Set(lines.map(l => l.split("|")[0]));

  console.log(`\nExport termine:`);
  console.log(`  Prospects API Gouv: ${prospects.length}`);
  console.log(`  Deja scrapes (skip): ${skippedDone}`);
  console.log(`  SIRENs a scraper: ${sirens.size}`);
  console.log(`  Lignes de queries (avec variantes): ${lines.length}`);
  console.log(`  Fichier: ${outputFile}`);

  await sql.end();
}

main().catch((err) => {
  console.error("Error:", err);
  process.exit(1);
});
