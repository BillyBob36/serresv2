import { NextRequest, NextResponse } from "next/server";
import sql from "@/lib/db";
import { spawn } from "child_process";
import { mkdirSync, writeFileSync, appendFileSync } from "fs";
import { join } from "path";

// Force dynamic - never cache API routes
export const dynamic = "force-dynamic";

const LOG_DIR = join(process.cwd(), ".update-logs");

// Track running batch enrichment processes
const runningProcesses: Map<string, { pid: number; startedAt: string }> = new Map();

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const batchId = parseInt(id, 10);
  if (!batchId) return NextResponse.json({ error: "ID invalide" }, { status: 400 });

  const body = await request.json();
  const { api_name } = body;

  const validApis = ["api_gouv", "insee", "google_places", "bodacc", "pages_jaunes"];
  if (!validApis.includes(api_name)) {
    return NextResponse.json({ error: `API inconnue: ${api_name}` }, { status: 400 });
  }

  // Check batch exists
  const batch = await sql`SELECT * FROM enrichissement_batch WHERE id = ${batchId}`;
  if (batch.length === 0) {
    return NextResponse.json({ error: "Batch non trouve" }, { status: 404 });
  }

  // Check if already running
  const key = `${batchId}_${api_name}`;
  const existing = runningProcesses.get(key);
  if (existing) {
    try {
      process.kill(existing.pid, 0);
      return NextResponse.json(
        { error: `Enrichissement ${api_name} deja en cours pour ce batch`, pid: existing.pid },
        { status: 409 }
      );
    } catch {
      runningProcesses.delete(key);
    }
  }

  // Ensure batch_api record exists
  await sql`
    INSERT INTO enrichissement_batch_api (batch_id, api_name, statut)
    VALUES (${batchId}, ${api_name}, 'pending')
    ON CONFLICT (batch_id, api_name) DO UPDATE SET statut = 'pending'
  `;

  // Spawn background script
  mkdirSync(LOG_DIR, { recursive: true });
  const logFile = join(LOG_DIR, `batch_${batchId}_${api_name}.log`);
  writeFileSync(logFile, `[${new Date().toISOString()}] Demarrage enrichissement batch ${batchId} / ${api_name}\n`);

  const child = spawn(
    "npx",
    ["tsx", "scripts/batch-enrich.ts", String(batchId), api_name],
    {
      cwd: process.cwd(),
      detached: true,
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env },
    }
  );

  const { pid } = child;
  if (!pid) {
    return NextResponse.json({ error: "Impossible de lancer le script" }, { status: 500 });
  }

  runningProcesses.set(key, { pid, startedAt: new Date().toISOString() });

  child.stdout?.on("data", (data: Buffer) => {
    try { appendFileSync(logFile, data); } catch {}
  });
  child.stderr?.on("data", (data: Buffer) => {
    try { appendFileSync(logFile, `[ERR] ${data}`); } catch {}
  });
  child.on("exit", () => {
    try { appendFileSync(logFile, `\n[${new Date().toISOString()}] Termine\n`); } catch {}
    runningProcesses.delete(key);
  });

  child.unref();

  return NextResponse.json({
    status: "started",
    batch_id: batchId,
    api_name,
    pid,
  });
}
