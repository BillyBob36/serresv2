import { readFileSync } from 'fs';
import { resolve } from 'path';
import { initOutput, loadCheckpoint, saveCheckpoint, closeOutput } from './output.js';
import { scrapeGoogleMaps } from './scraper.js';

// Parse CLI args
const args = process.argv.slice(2);
function getArg(name: string): string | undefined {
  const idx = args.indexOf(name);
  return idx >= 0 ? args[idx + 1] : undefined;
}

const inputPath = getArg('--input');
const outputPath = getArg('--output') ?? 'google_results.csv';
const concurrency = parseInt(getArg('--concurrency') ?? '3', 10);
const noEmails = args.includes('--no-emails');
const debug = args.includes('--debug');

if (!inputPath) {
  console.error('Usage: npx tsx src/index.ts --input <queries.txt> --output <results.csv> [--concurrency 3] [--no-emails]');
  console.error('  queries.txt: one search query per line (e.g. "Serres de Provence Aix-en-Provence")');
  process.exit(1);
}

const absInput = resolve(inputPath);
const absOutput = resolve(outputPath);

// Load queries (one per line, format: "siren|query_text" or just "query_text")
const rawLines = readFileSync(absInput, 'utf-8')
  .split('\n')
  .map(l => l.trim())
  .filter(l => l.length > 0);

// Parse siren|query format
const lines = rawLines.map(l => {
  const pipeIdx = l.indexOf('|');
  if (pipeIdx > 0) {
    return { siren: l.substring(0, pipeIdx).trim(), text: l.substring(pipeIdx + 1).trim() };
  }
  return { siren: '', text: l };
}).filter(l => l.text.length > 3);

console.log(`\n=== Google Maps Scraper ===`);
console.log(`Input: ${absInput} (${lines.length} queries)`);
console.log(`Output: ${absOutput}`);
console.log(`Concurrency: ${concurrency} tabs`);
console.log(`Email extraction: ${noEmails ? 'off' : 'on'}`);

// Resume from checkpoint
const checkpoint = loadCheckpoint();
const queries = lines
  .map((l, i) => ({ index: i, text: l.text, siren: l.siren }))
  .filter(q => q.index >= checkpoint);

if (checkpoint > 0) {
  console.log(`Resuming from checkpoint: ${checkpoint} (${lines.length - checkpoint} remaining)`);
}

console.log(`\nStarting in 3 seconds... (Ctrl+C to stop)\n`);

const startTime = Date.now();

// Initialize output
initOutput(absOutput);

// Graceful shutdown
let stopping = false;
process.on('SIGINT', () => {
  if (stopping) process.exit(1);
  stopping = true;
  console.log('\n\nStopping gracefully... (Ctrl+C again to force quit)');
  console.log('Progress saved — relaunch to resume.');
});

// Run scraper
const stats = await scrapeGoogleMaps(queries, {
  extractEmails: !noEmails,
  concurrency,
  debug,
  onProgress: (s) => {
    const total = s.completed + s.notFound + s.errors;
    const pct = ((total / queries.length) * 100).toFixed(1);
    process.stdout.write(`\r  Progress: ${total}/${queries.length} (${pct}%) | Found: ${s.completed} | Not found: ${s.notFound} | Errors: ${s.errors} | Emails: ${s.emailsFound}  `);
  },
});

closeOutput();
saveCheckpoint(lines.length);

const duration = ((Date.now() - startTime) / 1000 / 60).toFixed(1);
console.log(`\n\n=== Finished ===`);
console.log(`Duration: ${duration} min`);
console.log(`Results: ${stats.completed} found, ${stats.notFound} not found, ${stats.errors} errors`);
console.log(`Emails extracted: ${stats.emailsFound}`);
console.log(`Coverage: ${((stats.completed / lines.length) * 100).toFixed(1)}%`);
console.log(`Output: ${absOutput}`);
