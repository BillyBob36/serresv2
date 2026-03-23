import { NextRequest, NextResponse } from "next/server";
import sql from "@/lib/db";
// Force dynamic — never cache API routes
export const dynamic = "force-dynamic";


/**
 * POST /api/batch/[id]/upload
 * Upload CSV enrichment data (from gosom Google Maps scraper or PJ scraper).
 * Body: FormData with 'file' (CSV) + 'source' ("google_places" | "pages_jaunes")
 */

/** Normalize string for fuzzy matching (lowercase, no accents, no special chars) */
function normalize(s: string): string {
  return (s || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s]/g, "")
    .trim();
}

/** Parse CSV text into array of row objects */
function parseCSV(text: string): Record<string, string>[] {
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) return [];

  // Parse header — handle quoted fields
  const parseRow = (line: string): string[] => {
    const fields: string[] = [];
    let current = "";
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        if (inQuotes && line[i + 1] === '"') { current += '"'; i++; }
        else inQuotes = !inQuotes;
      } else if (ch === "," && !inQuotes) {
        fields.push(current.trim());
        current = "";
      } else {
        current += ch;
      }
    }
    fields.push(current.trim());
    return fields;
  };

  const headers = parseRow(lines[0]).map((h) => h.replace(/^\uFEFF/, ""));
  const rows: Record<string, string>[] = [];

  for (let i = 1; i < lines.length; i++) {
    const values = parseRow(lines[i]);
    if (values.length === 0 || (values.length === 1 && !values[0])) continue;
    const row: Record<string, string> = {};
    headers.forEach((h, j) => { row[h] = values[j] || ""; });
    rows.push(row);
  }

  return rows;
}

/** Get all valid SIRENs for this batch */
async function getValidSirens(batchId: number): Promise<Set<string>> {
  const rows = await sql`
    SELECT DISTINCT siren FROM serre_matches WHERE siren IS NOT NULL
    UNION
    SELECT DISTINCT siren FROM data_api_gouv WHERE batch_id = ${batchId} AND siren IS NOT NULL
  `;
  return new Set(rows.map((r: any) => r.siren));
}

async function processGooglePlacesCSV(batchId: number, rows: Record<string, string>[]) {
  const validSirens = await getValidSirens(batchId);
  let inserted = 0;
  let skipped = 0;
  let errCount = 0;

  // Get already enriched
  const existing = await sql`SELECT siren FROM data_google_places WHERE batch_id = ${batchId}`;
  const existingSet = new Set(existing.map((r: any) => r.siren));

  for (const row of rows) {
    try {
      // SIREN comes directly from the CSV (propagated through the scraper pipeline)
      const siren = row.siren || "";
      if (!siren || !validSirens.has(siren)) { skipped++; continue; }
      if (existingSet.has(siren)) { skipped++; continue; }

      const phone = row.phone || row.telephone || null;
      const website = row.website || row.site_web || null;
      const rating = parseFloat(row.review_rating || row.rating || "") || null;
      const reviewCount = parseInt(row.review_count || row.avis_count || "", 10) || null;
      const hours = row.open_hours || row.hours || row.horaires || null;
      const address = row.address || row.formatted_address || null;
      const category = row.category || row.type || row.primary_type || null;
      const status = row.status || row.business_status || null;
      const email = row.emails || row.email || null;

      await sql`
        INSERT INTO data_google_places (
          batch_id, siren, telephone, site_web, email, note_google,
          horaires, avis_count, google_business_status,
          google_formatted_address, google_primary_type, enrichi_at
        ) VALUES (
          ${batchId}, ${siren}, ${phone}, ${website}, ${email}, ${rating},
          ${hours}, ${reviewCount}, ${status},
          ${address}, ${category}, NOW()
        ) ON CONFLICT (batch_id, siren) DO UPDATE SET
          telephone = COALESCE(EXCLUDED.telephone, data_google_places.telephone),
          site_web = COALESCE(EXCLUDED.site_web, data_google_places.site_web),
          email = COALESCE(EXCLUDED.email, data_google_places.email),
          note_google = COALESCE(EXCLUDED.note_google, data_google_places.note_google),
          horaires = COALESCE(EXCLUDED.horaires, data_google_places.horaires),
          avis_count = COALESCE(EXCLUDED.avis_count, data_google_places.avis_count),
          enrichi_at = NOW()
      `;
      existingSet.add(siren);
      inserted++;
    } catch (err) {
      errCount++;
      console.error(`[Upload Google] Error:`, err);
    }
  }

  // Update batch API status
  await sql`
    INSERT INTO enrichissement_batch_api (batch_id, api_name, statut, nb_total, nb_enrichis, completed_at)
    VALUES (${batchId}, 'google_places', 'done', ${rows.length}, ${inserted}, NOW())
    ON CONFLICT (batch_id, api_name) DO UPDATE SET
      statut = 'done', nb_enrichis = enrichissement_batch_api.nb_enrichis + ${inserted}, completed_at = NOW()
  `;

  return { inserted, skipped, errors: errCount };
}

async function processPagesJaunesCSV(batchId: number, rows: Record<string, string>[]) {
  let inserted = 0;
  let skipped = 0;
  let errCount = 0;

  // Get already enriched
  const existing = await sql`SELECT siren FROM data_pages_jaunes WHERE batch_id = ${batchId}`;
  const existingSet = new Set(existing.map((r: any) => r.siren));

  for (const row of rows) {
    try {
      const siren = row.siren_match || row.siren || "";
      if (!siren) { skipped++; continue; }
      if (existingSet.has(siren)) { skipped++; continue; }
      if (row.match_confidence === "not_found") { skipped++; continue; }

      const phoneRaw = row.telephone || "";
      const phones = phoneRaw.split(";").filter((p: string) => p.trim());

      // If this result came from a dirigeant search, store the person's contact info
      const sourcePersonne = row.source_personne || null;

      await sql`
        INSERT INTO data_pages_jaunes (
          batch_id, siren, raison_social, description, adresse,
          code_postal, ville, telephone, siret, naf,
          forme_juridique, activite, site_web, url_pj, raw_data, enrichi_at
        ) VALUES (
          ${batchId}, ${siren}, ${row.raison_social || null},
          ${row.description || null}, ${row.adresse || null},
          ${row.code_postal || null}, ${row.ville || null},
          ${phones.length > 0 ? sql.array(phones) : null},
          ${row.siret_pj || null}, ${row.naf || null},
          ${row.forme_juridique || null}, ${row.activite || null},
          ${row.site_web || null}, ${row.url_fiche || null},
          ${JSON.stringify(row)}, NOW()
        ) ON CONFLICT (batch_id, siren) DO UPDATE SET
          telephone = COALESCE(EXCLUDED.telephone, data_pages_jaunes.telephone),
          site_web = COALESCE(EXCLUDED.site_web, data_pages_jaunes.site_web),
          raw_data = EXCLUDED.raw_data,
          enrichi_at = NOW()
      `;

      // If found via dirigeant name search, update that person's contact in dirigeants_complet
      if (sourcePersonne && phones.length > 0) {
        try {
          await sql`
            UPDATE data_api_gouv
            SET dirigeants_complet = (
              SELECT jsonb_agg(
                CASE
                  WHEN (elem->>'nom' ILIKE ${'%' + sourcePersonne.split(' ').pop() + '%'})
                  THEN elem || jsonb_build_object('telephone', ${phones[0]})
                  ELSE elem
                END
              )
              FROM jsonb_array_elements(dirigeants_complet::jsonb) AS elem
            )
            WHERE batch_id = ${batchId} AND siren = ${siren}
              AND dirigeants_complet IS NOT NULL
          `;
        } catch { /* ignore — non-critical enrichment */ }
      }
      existingSet.add(siren);
      inserted++;
    } catch (err) {
      errCount++;
      console.error(`[Upload PJ] Error:`, err);
    }
  }

  // Update batch API status
  await sql`
    INSERT INTO enrichissement_batch_api (batch_id, api_name, statut, nb_total, nb_enrichis, completed_at)
    VALUES (${batchId}, 'pages_jaunes', 'done', ${rows.length}, ${inserted}, NOW())
    ON CONFLICT (batch_id, api_name) DO UPDATE SET
      statut = 'done', nb_enrichis = enrichissement_batch_api.nb_enrichis + ${inserted}, completed_at = NOW()
  `;

  return { inserted, skipped, errors: errCount };
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const batchId = parseInt(id, 10);
  if (!batchId) return NextResponse.json({ error: "ID invalide" }, { status: 400 });

  // Check batch exists
  const batch = await sql`SELECT * FROM enrichissement_batch WHERE id = ${batchId}`;
  if (batch.length === 0) {
    return NextResponse.json({ error: "Batch non trouve" }, { status: 404 });
  }

  try {
    const formData = await request.formData();
    const file = formData.get("file") as File | null;
    const source = formData.get("source") as string | null;

    if (!file) return NextResponse.json({ error: "Fichier manquant" }, { status: 400 });
    if (!source || !["google_places", "pages_jaunes"].includes(source)) {
      return NextResponse.json({ error: "Source invalide (google_places | pages_jaunes)" }, { status: 400 });
    }

    const text = await file.text();
    const rows = parseCSV(text);

    if (rows.length === 0) {
      return NextResponse.json({ error: "CSV vide ou format invalide" }, { status: 400 });
    }

    let result;
    if (source === "google_places") {
      result = await processGooglePlacesCSV(batchId, rows);
    } else {
      result = await processPagesJaunesCSV(batchId, rows);
    }

    return NextResponse.json({
      status: "done",
      source,
      total_rows: rows.length,
      ...result,
    });
  } catch (err) {
    console.error("[Upload CSV] Error:", err);
    return NextResponse.json(
      { error: "Erreur lors du traitement du CSV" },
      { status: 500 }
    );
  }
}
