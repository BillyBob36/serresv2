import postgres from "postgres";
import * as dotenv from "dotenv";
import { resolve } from "path";

dotenv.config({ path: resolve(__dirname, "../.env.local") });

const sql = postgres(process.env.DATABASE_URL || "postgresql://serres:SerresV2_2024!@65.21.146.193:5433/serresv2", { max: 3 });

async function main() {
  const rows = await sql`SELECT api_name, nb_total, nb_enrichis, statut FROM enrichissement_batch_api WHERE batch_id = 1 ORDER BY api_name`;
  for (const r of rows) {
    console.log(`${r.api_name}: ${r.nb_enrichis}/${r.nb_total} (${r.statut})`);
  }

  const countSerres = await sql`SELECT COUNT(DISTINCT siren) as c FROM serres WHERE siren IS NOT NULL AND siren != ''`;
  const countMatches = await sql`SELECT COUNT(DISTINCT siren) as c FROM serre_matches WHERE siren IS NOT NULL AND siren != ''`;
  const countUnion = await sql`SELECT COUNT(*) as c FROM (SELECT DISTINCT siren FROM serres WHERE siren IS NOT NULL AND siren != '' UNION SELECT DISTINCT siren FROM serre_matches WHERE siren IS NOT NULL AND siren != '') t`;

  console.log("\nSources SIREN:");
  console.log("  serres distinctes:", countSerres[0].c);
  console.log("  serre_matches distinctes:", countMatches[0].c);
  console.log("  UNION (total prospects):", countUnion[0].c);

  await sql.end();
}

main();
