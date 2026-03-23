/**
 * Export PJ prospects CSV for the PJ scraper.
 * Usage: npx tsx scripts/export-pj-queries.ts <batch_id> [output_file]
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

const FORMES = [
  "sarl", "sas", "sasu", "sa", "eurl", "earl", "gaec", "gfa", "sci",
  "scea", "gie", "snc", "selarl", "scp", "cooperative", "cuma",
  "exploitation agricole", "societe civile", "groupement agricole",
];

function stripFormeJuridique(name: string): string {
  let cleaned = name;
  for (const forme of FORMES) {
    cleaned = cleaned.replace(new RegExp(`^${forme}\\s+`, "i"), "");
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
    const hist = typeof p.periodes_historique === "string" ? JSON.parse(p.periodes_historique) : p.periodes_historique;
    if (Array.isArray(hist)) {
      for (const period of hist) { if (period.denomination) add(period.denomination); }
    }
  } catch { /* ignore */ }
  return variants;
}

function csvEscape(s: string): string {
  if (s.includes(",") || s.includes('"') || s.includes("\n")) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

async function main() {
  const batchId = parseInt(process.argv[2] || "1", 10);
  const outputFile = process.argv[3] || resolve(__dirname, "../data/prospects_pj.csv");

  console.log(`Exporting PJ prospects for batch ${batchId}...`);

  const prospects = await sql`
    SELECT g.siren, g.nom_complet, g.nom_raison_sociale, g.sigle,
           g.libelle_commune_siege, g.code_postal_siege, g.dirigeants_complet,
           i.periodes_historique
    FROM data_api_gouv g
    LEFT JOIN data_insee i ON i.batch_id = g.batch_id AND i.siren = g.siren
    WHERE g.batch_id = ${batchId}
      AND g.nom_complet IS NOT NULL AND g.nom_complet != ''
    ORDER BY g.siren
  `;

  // Exclude already scraped
  const done = await sql`SELECT siren FROM data_pages_jaunes WHERE batch_id = ${batchId}`;
  const doneSet = new Set(done.map((r: any) => r.siren));

  const header = "siren,nom,noms_alternatifs,commune,departement,dirigeants";
  const csvLines: string[] = [];

  for (const p of prospects) {
    if (doneSet.has(p.siren)) continue;
    const siren = p.siren || "";
    const nom = csvEscape(p.nom_complet || "");
    const commune = csvEscape(p.libelle_commune_siege || "");
    const cp = (p.code_postal_siege || "").substring(0, 2);

    const allVariants = buildNameVariants(p);
    const altNames = allVariants.slice(1).join("|");

    let dirigeantNames = "";
    try {
      const dirs = typeof p.dirigeants_complet === "string" ? JSON.parse(p.dirigeants_complet) : p.dirigeants_complet;
      if (Array.isArray(dirs)) {
        dirigeantNames = dirs
          .filter((d: any) => d.type_dirigeant === "personne physique")
          .map((d: any) => `${(d.prenoms || d.prenom || "").split(" ")[0]} ${d.nom || ""}`.trim())
          .filter((n: string) => n.length > 3)
          .join("|");
      }
    } catch { /* ignore */ }

    csvLines.push(`${siren},${nom},${csvEscape(altNames)},${commune},${cp},${csvEscape(dirigeantNames)}`);
  }

  mkdirSync(dirname(outputFile), { recursive: true });
  writeFileSync(outputFile, [header, ...csvLines].join("\n"), "utf-8");

  console.log(`\nExport termine:`);
  console.log(`  Prospects API Gouv: ${prospects.length}`);
  console.log(`  Deja scrapes (skip): ${doneSet.size}`);
  console.log(`  A scraper: ${csvLines.length}`);
  console.log(`  Fichier: ${outputFile}`);

  await sql.end();
}

main().catch((err) => { console.error("Error:", err); process.exit(1); });
