/**
 * Script 2 : Import des entreprises agricoles
 *
 * Usage : npx tsx scripts/import-entreprises.ts
 *
 * Stratégie : tout fetch en mémoire d'abord, puis un seul batch insert à la fin.
 */

import postgres from "postgres";
import * as dotenv from "dotenv";
import { resolve } from "path";

dotenv.config({ path: resolve(__dirname, "../.env.local") });

const sql = postgres(
  process.env.DATABASE_URL ||
    "postgresql://serres:SerresV2_2024!@65.21.146.193:5433/serresv2",
  { max: 5, connect_timeout: 10 }
);

const CODES_NAF = ["01.13Z", "01.19Z", "01.30Z"];

interface EntrepriseRow {
  siren: string;
  siret_siege: string;
  nom: string;
  dirigeant_nom: string;
  dirigeant_prenom: string;
  latitude: number;
  longitude: number;
  commune: string;
  departement: string;
  naf: string;
}

async function fetchAllPages(dept: string, naf: string): Promise<EntrepriseRow[]> {
  const rows: EntrepriseRow[] = [];
  let page = 1;
  let totalPages = 1;

  while (page <= totalPages) {
    const url = `https://recherche-entreprises.api.gouv.fr/search?activite_principale=${naf}&departement=${dept}&etat_administratif=A&page=${page}&per_page=25`;

    try {
      const resp = await fetch(url);

      if (resp.status === 429) {
        await new Promise(r => setTimeout(r, 3000));
        continue;
      }
      if (!resp.ok) break;

      const data = await resp.json();
      totalPages = data.total_pages || 1;

      for (const e of data.results || []) {
        if (!e.siege?.latitude || !e.siege?.longitude) continue;
        const dir = e.dirigeants?.find((d: { type_dirigeant: string }) => d.type_dirigeant === "personne physique");
        rows.push({
          siren: e.siren,
          siret_siege: e.siege.siret || "",
          nom: e.nom_complet || "",
          dirigeant_nom: dir?.nom || "",
          dirigeant_prenom: dir?.prenoms || "",
          latitude: parseFloat(e.siege.latitude),
          longitude: parseFloat(e.siege.longitude),
          commune: e.siege.libelle_commune || "",
          departement: e.siege.departement || "",
          naf,
        });
      }

      page++;
      // Petit délai entre les pages
      await new Promise(r => setTimeout(r, 100));
    } catch {
      break;
    }
  }

  return rows;
}

async function main() {
  console.log("=== Import Entreprises Agricoles ===\n");

  const [{ count }] = await sql`SELECT COUNT(*) as count FROM serres`;
  console.log(`Serres en base : ${count}`);

  // Vider la table entreprises (re-import propre)
  await sql`TRUNCATE TABLE entreprises_agri`;
  console.log("Table entreprises_agri vidée\n");

  const depts = await sql`
    SELECT DISTINCT departement FROM serres
    WHERE departement IS NOT NULL AND departement != ''
    ORDER BY departement
  `;
  console.log(`Départements : ${depts.length}\n`);

  // Phase 1 : Tout fetcher en mémoire
  console.log("--- Phase 1 : Fetch de toutes les entreprises ---");
  const allRows = new Map<string, EntrepriseRow>(); // dédoublonnage par SIREN
  const t0 = Date.now();

  for (let i = 0; i < depts.length; i++) {
    const d = depts[i].departement as string;
    let deptCount = 0;

    for (const naf of CODES_NAF) {
      const rows = await fetchAllPages(d, naf);
      for (const r of rows) {
        if (!allRows.has(r.siren)) {
          allRows.set(r.siren, r);
          deptCount++;
        }
      }
    }

    if ((i + 1) % 10 === 0 || i === depts.length - 1) {
      const elapsed = ((Date.now() - t0) / 1000).toFixed(0);
      console.log(`  [${i + 1}/${depts.length}] dept ${d} : +${deptCount} | Total unique : ${allRows.size} | ${elapsed}s`);
    }
  }

  const fetchTime = ((Date.now() - t0) / 1000).toFixed(0);
  console.log(`\nFetch terminé : ${allRows.size} entreprises uniques en ${fetchTime}s\n`);

  // Phase 2 : Insertion batch
  console.log("--- Phase 2 : Insertion batch ---");
  const rows = Array.from(allRows.values());
  let inserted = 0;

  for (let i = 0; i < rows.length; i += 50) {
    const batch = rows.slice(i, i + 50);
    try {
      await sql`
        INSERT INTO entreprises_agri ${sql(batch, "siren", "siret_siege", "nom", "dirigeant_nom", "dirigeant_prenom", "latitude", "longitude", "commune", "departement", "naf")}
        ON CONFLICT (siren) DO NOTHING
      `;
      inserted += batch.length;
    } catch {
      // Fallback un par un
      for (const row of batch) {
        try {
          await sql`INSERT INTO entreprises_agri ${sql(row, "siren", "siret_siege", "nom", "dirigeant_nom", "dirigeant_prenom", "latitude", "longitude", "commune", "departement", "naf")} ON CONFLICT (siren) DO NOTHING`;
          inserted++;
        } catch { /* skip */ }
      }
    }

    if (inserted % 500 === 0 && inserted > 0) {
      console.log(`  ${inserted}/${rows.length} insérées...`);
    }
  }

  // Stats
  const [{ total }] = await sql`SELECT COUNT(*) as total FROM entreprises_agri`;
  const [{ withDir }] = await sql`SELECT COUNT(*) as "withDir" FROM entreprises_agri WHERE dirigeant_nom != ''`;

  console.log(`\n=== Résultat ===`);
  console.log(`Entreprises importées : ${total}`);
  console.log(`Avec dirigeant identifié : ${withDir}`);
  console.log(`Durée totale : ${((Date.now() - t0) / 1000).toFixed(0)}s`);

  await sql.end();
}

main().catch(e => { console.error("FATAL:", e); process.exit(1); });
