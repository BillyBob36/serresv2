import { NextResponse } from "next/server";
import { readFileSync, existsSync } from "fs";
import { join } from "path";

const LOG_DIR = join(process.cwd(), ".update-logs");

export async function GET() {
  // Import dynamique pour accéder au state partagé
  let currentProcess: { action: string; pid: number; startedAt: string } | null = null;
  try {
    const mod = await import("../route");
    currentProcess = mod.currentProcess;
  } catch {
    // Module pas encore chargé
  }

  let running = false;
  if (currentProcess) {
    try {
      process.kill(currentProcess.pid, 0);
      running = true;
    } catch {
      running = false;
    }
  }

  // Lire les dernières lignes du log
  let lastLines = "";
  const logFiles = ["all", "rpg", "entreprises", "match"];
  for (const name of logFiles) {
    const logPath = join(LOG_DIR, `${name}.log`);
    if (existsSync(logPath)) {
      try {
        const content = readFileSync(logPath, "utf-8");
        const lines = content.trim().split("\n");
        lastLines = lines.slice(-5).join("\n");
        break;
      } catch { /* ignore */ }
    }
  }

  return NextResponse.json({
    running,
    action: currentProcess?.action || null,
    pid: currentProcess?.pid || null,
    started_at: currentProcess?.startedAt || null,
    last_log: lastLines,
  });
}
