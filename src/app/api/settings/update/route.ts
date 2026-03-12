import { NextRequest, NextResponse } from "next/server";
import { spawn } from "child_process";
import { writeFileSync, mkdirSync } from "fs";
import { join } from "path";

const SCRIPTS: Record<string, string> = {
  rpg: "scripts/import-rpg.ts",
  entreprises: "scripts/import-entreprises.ts",
  match: "scripts/match-serres.ts",
};

const LOG_DIR = join(process.cwd(), ".update-logs");

// PID en mémoire pour le tracking (reset au redémarrage du serveur)
let currentProcess: { action: string; pid: number; startedAt: string } | null = null;

export { currentProcess };

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const action = body.action as string;

    if (action === "all") {
      // Lancer les 3 scripts séquentiellement via un wrapper
      return startScript("all", "scripts/import-rpg.ts");
    }

    const scriptPath = SCRIPTS[action];
    if (!scriptPath) {
      return NextResponse.json(
        { error: `Action inconnue: ${action}. Valides: ${Object.keys(SCRIPTS).join(", ")}, all` },
        { status: 400 }
      );
    }

    return startScript(action, scriptPath);
  } catch {
    return NextResponse.json({ error: "Body JSON invalide" }, { status: 400 });
  }
}

function startScript(action: string, scriptPath: string) {
  if (currentProcess) {
    try {
      process.kill(currentProcess.pid, 0); // Vérifie si le process tourne encore
      return NextResponse.json(
        { error: `Une mise à jour est déjà en cours (${currentProcess.action})`, pid: currentProcess.pid },
        { status: 409 }
      );
    } catch {
      currentProcess = null; // Le process est terminé
    }
  }

  mkdirSync(LOG_DIR, { recursive: true });
  const logFile = join(LOG_DIR, `${action}.log`);
  writeFileSync(logFile, `[${new Date().toISOString()}] Démarrage: ${action}\n`);

  let scripts: string[];
  if (action === "all") {
    scripts = [SCRIPTS.rpg, SCRIPTS.entreprises, SCRIPTS.match];
  } else {
    scripts = [scriptPath];
  }

  // Lancer le premier script (pour "all", on les chaîne avec &&)
  const cmd = scripts.map((s) => `npx tsx ${s}`).join(" && ");
  const child = spawn("bash", ["-c", cmd], {
    cwd: process.cwd(),
    detached: true,
    stdio: ["ignore", "pipe", "pipe"],
  });

  const { pid } = child;
  if (!pid) {
    return NextResponse.json({ error: "Impossible de lancer le script" }, { status: 500 });
  }

  currentProcess = { action, pid, startedAt: new Date().toISOString() };

  // Écrire stdout/stderr dans le log
  const { appendFileSync } = require("fs");
  child.stdout?.on("data", (data: Buffer) => {
    try { appendFileSync(logFile, data); } catch { /* ignore */ }
  });
  child.stderr?.on("data", (data: Buffer) => {
    try { appendFileSync(logFile, `[ERR] ${data}`); } catch { /* ignore */ }
  });
  child.on("exit", () => {
    try { appendFileSync(logFile, `\n[${new Date().toISOString()}] Terminé\n`); } catch { /* ignore */ }
    if (currentProcess?.pid === pid) currentProcess = null;
  });

  child.unref();

  return NextResponse.json({
    status: "started",
    action,
    pid,
    started_at: currentProcess.startedAt,
  });
}
