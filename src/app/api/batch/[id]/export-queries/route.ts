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

  // Get all prospects for this batch from data_api_gouv (including dirigeants for PJ fallback search)
  const prospects = await sql`
    SELECT siren, nom_complet, libelle_commune_siege, code_postal_siege, dirigeants_complet
    FROM data_api_gouv
    WHERE batch_id = ${batchId}
      AND nom_complet IS NOT NULL
      AND nom_complet != ''
    ORDER BY siren
  `;

  if (prospects.length === 0) {
    return NextResponse.json(
      { error: "Aucun prospect dans ce batch. Lancez d'abord l'enrichissement API Gouv." },
      { status: 400 }
    );
  }

  if (type === "google") {
    // Google Maps: one query per line → "company_name city"
    // Filter out already enriched via Google Places
    const alreadyGoogle = await sql`
      SELECT siren FROM data_google_places WHERE batch_id = ${batchId}
    `;
    const doneSet = new Set(alreadyGoogle.map((r: any) => r.siren));

    // Format: "siren|company_name city" — SIREN is propagated through the scraper pipeline
    const lines = prospects
      .filter((p: any) => !doneSet.has(p.siren))
      .map((p: any) => {
        const siren = (p.siren || "").trim();
        const name = (p.nom_complet || "").trim();
        const city = (p.libelle_commune_siege || "").trim();
        return `${siren}|${name} ${city}`;
      })
      .filter((l: string) => l.split("|")[1]?.trim().length > 3);

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

    const header = "siren,nom,commune,departement,dirigeants";
    const csvLines = prospects
      .filter((p: any) => !doneSet.has(p.siren))
      .map((p: any) => {
        const siren = p.siren || "";
        const nom = csvEscape(p.nom_complet || "");
        const commune = csvEscape(p.libelle_commune_siege || "");
        const cp = (p.code_postal_siege || "").substring(0, 2);
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
        return `${siren},${nom},${commune},${cp},${csvEscape(dirigeantNames)}`;
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
