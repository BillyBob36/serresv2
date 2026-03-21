#!/usr/bin/env node
/**
 * PJ Scraper CLI — Pages Jaunes scraper standalone tool.
 *
 * Usage:
 *   npx tsx src/index.ts --input <prospects.csv> --output <pj_results.csv>
 *
 * Input CSV columns: siren, nom, commune, departement
 * Output CSV columns: siren_match, raison_social, telephone, email, site_web,
 *                     adresse, code_postal, ville, horaires, note, nb_avis,
 *                     description, siret_pj, naf, forme_juridique, activite,
 *                     url_fiche, match_confidence
 */

import { parse } from "csv-parse/sync";
import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { runScraper, type ScrapeResult } from "./scraper.js";
import { initOutput, appendRow, loadCheckpoint, saveCheckpoint, type CsvRow, type Checkpoint } from "./output.js";

// Parse CLI args
function parseArgs(): { input: string; output: string } {
  const args = process.argv.slice(2);
  let input = "";
  let output = "";

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--input" && args[i + 1]) input = args[++i];
    else if (args[i] === "--output" && args[i + 1]) output = args[++i];
  }

  if (!input || !output) {
    console.error("Usage: npx tsx src/index.ts --input <prospects.csv> --output <pj_results.csv>");
    process.exit(1);
  }

  return { input: resolve(input), output: resolve(output) };
}

interface Prospect {
  siren: string;
  nom: string;
  commune: string;
  departement: string;
  dirigeants: string[];
}

function loadProspects(csvPath: string): Prospect[] {
  const content = readFileSync(csvPath, "utf-8");
  const records = parse(content, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
    bom: true,
  });

  return records.map((r: any) => ({
    siren: r.siren || "",
    nom: r.nom || r.nom_complet || "",
    commune: r.commune || r.libelle_commune_siege || "",
    departement: r.departement || "",
    dirigeants: (r.dirigeants || "").split("|").map((n: string) => n.trim()).filter((n: string) => n.length > 3),
  })).filter((p: Prospect) => p.siren && p.nom);
}

async function main() {
  const { input, output } = parseArgs();

  console.log(`[PJ Scraper] Input: ${input}`);
  console.log(`[PJ Scraper] Output: ${output}`);

  // Load prospects
  const prospects = loadProspects(input);
  console.log(`[PJ Scraper] Loaded ${prospects.length} prospects`);

  if (prospects.length === 0) {
    console.error("No prospects found in input file");
    process.exit(1);
  }

  // Init output CSV
  initOutput(output);

  // Load checkpoint for resume
  const checkpointDir = dirname(output);
  const checkpoint = loadCheckpoint(checkpointDir);
  let startIndex = 0;
  let stats = { completed: 0, notFound: 0, errors: 0 };

  if (checkpoint) {
    startIndex = checkpoint.lastIndex + 1;
    stats.completed = checkpoint.completed;
    stats.notFound = checkpoint.notFound;
    stats.errors = checkpoint.errors;
    console.log(`[PJ Scraper] Resuming from index ${startIndex} (${stats.completed} already done)`);
  }

  const startTime = Date.now();

  // Run the scraper
  await runScraper(
    prospects,
    startIndex,
    // onResult callback
    (index: number, result: ScrapeResult) => {
      stats.completed++;

      if (result.matchConfidence === "not_found") {
        stats.notFound++;
        // Still write a row for tracking
        appendRow({
          siren_match: result.siren,
          raison_social: "",
          telephone: "",
          email: "",
          site_web: "",
          adresse: "",
          code_postal: "",
          ville: result.city,
          horaires: "",
          note: "",
          nb_avis: "",
          description: "",
          siret_pj: "",
          naf: "",
          forme_juridique: "",
          activite: "",
          url_fiche: "",
          match_confidence: "not_found",
          source_personne: "",
        });
      } else if (result.detail) {
        appendRow({
          siren_match: result.siren,
          raison_social: result.detail.raison_social || "",
          telephone: result.detail.telephone.join(";") || "",
          email: result.detail.email || "",
          site_web: result.detail.site_web || "",
          adresse: result.detail.adresse || "",
          code_postal: result.detail.code_postal || "",
          ville: result.detail.ville || "",
          horaires: result.detail.horaires || "",
          note: result.detail.note || "",
          nb_avis: result.detail.nb_avis?.toString() || "",
          description: result.detail.description || "",
          siret_pj: result.detail.siret || "",
          naf: result.detail.naf || "",
          forme_juridique: result.detail.forme_juridique || "",
          activite: result.detail.activites.join(";") || "",
          url_fiche: result.detail.url_fiche || "",
          match_confidence: result.matchConfidence,
          source_personne: result.sourcePersonne || "",
        });
      }

      // Save checkpoint every 50 results
      if (stats.completed % 50 === 0) {
        saveCheckpoint(checkpointDir, {
          lastIndex: index,
          completed: stats.completed,
          notFound: stats.notFound,
          errors: stats.errors,
          startedAt: checkpoint?.startedAt || new Date().toISOString(),
        });
      }
    },
    // onProgress callback
    (completed: number, total: number, notFound: number, errors: number) => {
      const elapsed = (Date.now() - startTime) / 1000;
      const rate = completed / elapsed;
      const remaining = (total - completed) / rate;
      const etaMin = Math.ceil(remaining / 60);
      console.log(
        `[PJ Scraper] Progress: ${completed}/${total} (${notFound} not found, ${errors} errors) — ETA: ${etaMin}min`
      );
    }
  );

  // Final report
  const totalTime = ((Date.now() - startTime) / 1000 / 60).toFixed(1);
  const coverage = (((stats.completed - stats.notFound - stats.errors) / prospects.length) * 100).toFixed(1);

  console.log("\n========== RAPPORT FINAL ==========");
  console.log(`Total: ${prospects.length}`);
  console.log(`Enrichis: ${stats.completed - stats.notFound - stats.errors}`);
  console.log(`Non trouves: ${stats.notFound}`);
  console.log(`Erreurs: ${stats.errors}`);
  console.log(`Couverture: ${coverage}%`);
  console.log(`Duree: ${totalTime} min`);
  console.log(`Output: ${output}`);
  console.log("====================================\n");
}

main().catch((err) => {
  console.error("[PJ Scraper] Fatal error:", err);
  process.exit(1);
});
