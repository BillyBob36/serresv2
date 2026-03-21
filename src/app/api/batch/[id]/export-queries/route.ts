import { NextRequest, NextResponse } from "next/server";
import sql from "@/lib/db";

/**
 * GET /api/batch/[id]/export-queries?type=google|pj
 *
 * Exports query files for external scrapers:
 * - type=google → queries.txt (one query per line for gosom: "company_name city")
 * - type=pj     → prospects.csv (siren,nom,commune,departement)
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const batchId = parseInt(id, 10);
  if (!batchId) return NextResponse.json({ error: "ID invalide" }, { status: 400 });

  const { searchParams } = new URL(request.url);
  const type = searchParams.get("type");

  if (!type || !["google", "pj"].includes(type)) {
    return NextResponse.json({ error: "Type invalide (google | pj)" }, { status: 400 });
  }

  // Get all prospects for this batch from data_api_gouv (all name variants + dirigeants for PJ fallback)
  const prospects = await sql`
    SELECT g.siren, g.nom_complet, g.nom_raison_sociale, g.sigle,
           g.libelle_commune_siege, g.code_postal_siege, g.dirigeants_complet,
           i.periodes_historique
    FROM data_api_gouv g
    LEFT JOIN data_insee i ON i.batch_id = g.batch_id AND i.siren = g.siren
    WHERE g.batch_id = ${batchId}
      AND g.nom_complet IS NOT NULL
      AND g.nom_complet != ''
    ORDER BY g.siren
  `;

  if (prospects.length === 0) {
    return NextResponse.json(
      { error: "Aucun prospect dans ce batch. Lancez d'abord l'enrichissement API Gouv." },
      { status: 400 }
    );
  }

  if (type === "google") {
    // Google Maps: multiple name variants per company for better discovery
    // Format: "siren|name city" — scraper tries first line, falls back to next with same SIREN
    const alreadyGoogle = await sql`
      SELECT siren FROM data_google_places WHERE batch_id = ${batchId}
    `;
    const doneSet = new Set(alreadyGoogle.map((r: any) => r.siren));

    const lines: string[] = [];
    for (const p of prospects) {
      if (doneSet.has(p.siren)) continue;
      const siren = (p.siren || "").trim();
      const city = (p.libelle_commune_siege || "").trim();

      // Build unique name variants in priority order
      const variants = buildNameVariants(p);
      for (const name of variants) {
        const query = city ? `${name} ${city}` : name;
        if (query.trim().length > 3) {
          lines.push(`${siren}|${query}`);
        }
      }
    }

    const content = lines.join("\n");
    const filename = `queries_google_batch_${batchId}.txt`;

    return new NextResponse(content, {
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Content-Disposition": `attachment; filename="${filename}"`,
      },
    });
  }

  if (type === "pj") {
    // PJ: CSV with siren, nom, commune, departement
    const alreadyPJ = await sql`
      SELECT siren FROM data_pages_jaunes WHERE batch_id = ${batchId}
    `;
    const doneSet = new Set(alreadyPJ.map((r: any) => r.siren));

    const header = "siren,nom,noms_alternatifs,commune,departement,dirigeants";
    const csvLines = prospects
      .filter((p: any) => !doneSet.has(p.siren))
      .map((p: any) => {
        const siren = p.siren || "";
        const nom = csvEscape(p.nom_complet || "");
        const commune = csvEscape(p.libelle_commune_siege || "");
        const cp = (p.code_postal_siege || "").substring(0, 2);
        // Build alternative name variants for fallback PJ search
        const allVariants = buildNameVariants(p);
        // Skip first (it's nom_complet already in the nom column)
        const altNames = allVariants.slice(1).join("|");
        // Extract physical person dirigeant names for PJ fallback search
        let dirigeantNames = "";
        try {
          const dirs = typeof p.dirigeants_complet === "string"
            ? JSON.parse(p.dirigeants_complet)
            : p.dirigeants_complet;
          if (Array.isArray(dirs)) {
            dirigeantNames = dirs
              .filter((d: any) => d.type_dirigeant === "personne physique")
              .map((d: any) => `${(d.prenoms || d.prenom || "").split(" ")[0]} ${d.nom || ""}`.trim())
              .filter((n: string) => n.length > 3)
              .join("|");
          }
        } catch { /* ignore */ }
        return `${siren},${nom},${csvEscape(altNames)},${commune},${cp},${csvEscape(dirigeantNames)}`;
      });

    const content = [header, ...csvLines].join("\n");
    const filename = `prospects_pj_batch_${batchId}.csv`;

    return new NextResponse(content, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${filename}"`,
      },
    });
  }

  return NextResponse.json({ error: "Type invalide" }, { status: 400 });
}

function csvEscape(s: string): string {
  if (s.includes(",") || s.includes('"') || s.includes("\n")) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

/** Strip legal form prefixes/suffixes from company name */
function stripFormeJuridique(name: string): string {
  const formes = [
    "sarl", "sas", "sasu", "sa", "eurl", "earl", "gaec", "gfa", "sci",
    "scea", "gie", "snc", "selarl", "scp", "cooperative", "cuma",
    "exploitation agricole", "societe civile", "groupement agricole",
  ];
  let cleaned = name;
  for (const forme of formes) {
    cleaned = cleaned.replace(new RegExp(`^${forme}\\s+`, "i"), "");
    cleaned = cleaned.replace(new RegExp(`\\s+${forme}$`, "i"), "");
  }
  return cleaned.trim();
}

/** Build unique name variants from a prospect row (API Gouv + INSEE) */
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

  // 1. nom_complet (primary)
  add(p.nom_complet);

  // 2. nom_raison_sociale (often without legal form prefix)
  add(p.nom_raison_sociale);

  // 3. nom_complet stripped of legal form (SARL, SAS, EARL...)
  if (p.nom_complet) {
    const stripped = stripFormeJuridique(p.nom_complet);
    if (stripped !== p.nom_complet) add(stripped);
  }

  // 4. sigle (acronym)
  add(p.sigle);

  // 5. historical names from INSEE periodes_historique
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
