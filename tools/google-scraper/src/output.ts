import { createWriteStream, existsSync, readFileSync, writeFileSync, statSync } from 'fs';
import { stringify } from 'csv-stringify/sync';

const HEADERS = [
  'siren', 'query', 'title', 'category', 'address', 'phone', 'website',
  'email', 'latitude', 'longitude', 'rating', 'review_count',
  'open_hours', 'status', 'price_level'
];

const CHECKPOINT_FILE = '.google_checkpoint.json';

let outputStream: ReturnType<typeof createWriteStream> | null = null;

export function initOutput(outputPath: string): void {
  const fileExists = existsSync(outputPath) && statSync(outputPath).size > 0;
  outputStream = createWriteStream(outputPath, { flags: 'a', encoding: 'utf-8' });
  if (!fileExists) {
    outputStream.write(stringify([HEADERS]));
  }
}

export function appendRow(row: Record<string, string>): void {
  if (!outputStream) throw new Error('Output not initialized');
  const values = HEADERS.map(h => row[h] ?? '');
  outputStream.write(stringify([values]));
}

export function loadCheckpoint(): number {
  if (existsSync(CHECKPOINT_FILE)) {
    try {
      const data = JSON.parse(readFileSync(CHECKPOINT_FILE, 'utf-8'));
      return data.lastIndex ?? 0;
    } catch { return 0; }
  }
  return 0;
}

export function saveCheckpoint(lastIndex: number): void {
  writeFileSync(CHECKPOINT_FILE, JSON.stringify({ lastIndex, updatedAt: new Date().toISOString() }));
}

export function closeOutput(): void {
  outputStream?.end();
}
