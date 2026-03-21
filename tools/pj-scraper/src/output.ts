/**
 * CSV output with append mode — writes results continuously, never holds all in memory.
 */

import { createWriteStream, existsSync, readFileSync, writeFileSync } from "fs";
import { stringify } from "csv-stringify/sync";

export interface CsvRow {
  siren_match: string;
  raison_social: string;
  telephone: string;
  email: string;
  site_web: string;
  adresse: string;
  code_postal: string;
  ville: string;
  horaires: string;
  note: string;
  nb_avis: string;
  description: string;
  siret_pj: string;
  naf: string;
  forme_juridique: string;
  activite: string;
  url_fiche: string;
  match_confidence: string;
  source_personne: string;
}

const CSV_HEADERS: (keyof CsvRow)[] = [
  "siren_match", "raison_social", "telephone", "email", "site_web",
  "adresse", "code_postal", "ville", "horaires", "note", "nb_avis",
  "description", "siret_pj", "naf", "forme_juridique", "activite",
  "url_fiche", "match_confidence", "source_personne",
];

let outputPath: string;
let headerWritten = false;

export function initOutput(path: string) {
  outputPath = path;
  // If file doesn't exist or is empty, write header
  if (!existsSync(path) || readFileSync(path, "utf-8").trim() === "") {
    const header = stringify([CSV_HEADERS]);
    writeFileSync(path, header);
  }
  headerWritten = true;
}

export function appendRow(row: CsvRow) {
  if (!headerWritten) throw new Error("Call initOutput() first");
  const line = stringify([CSV_HEADERS.map((k) => row[k] || "")]);
  const stream = createWriteStream(outputPath, { flags: "a" });
  stream.write(line);
  stream.end();
}

// Checkpoint management
export interface Checkpoint {
  lastIndex: number;
  completed: number;
  notFound: number;
  errors: number;
  startedAt: string;
}

const CHECKPOINT_FILE = ".pj-checkpoint.json";

export function loadCheckpoint(dir: string): Checkpoint | null {
  const path = `${dir}/${CHECKPOINT_FILE}`;
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf-8"));
  } catch {
    return null;
  }
}

export function saveCheckpoint(dir: string, checkpoint: Checkpoint) {
  writeFileSync(`${dir}/${CHECKPOINT_FILE}`, JSON.stringify(checkpoint, null, 2));
}

export function clearCheckpoint(dir: string) {
  const path = `${dir}/${CHECKPOINT_FILE}`;
  if (existsSync(path)) {
    writeFileSync(path, "");
  }
}
