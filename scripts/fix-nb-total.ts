import postgres from "postgres";
import * as dotenv from "dotenv";
import { resolve } from "path";
dotenv.config({ path: resolve(__dirname, "../.env.local") });

const sql = postgres(process.env.DATABASE_URL || "postgresql://serres:SerresV2_2024!@65.21.146.193:5433/serresv2", { max: 3 });

async function main() {
  await sql`UPDATE enrichissement_batch_api SET nb_total = 16738, statut = 'pending' WHERE batch_id = 1 AND api_name = 'google_places'`;
  await sql`UPDATE enrichissement_batch_api SET nb_total = 16738, statut = 'pending' WHERE batch_id = 1 AND api_name = 'pages_jaunes'`;
  console.log("Updated google_places and pages_jaunes nb_total to 16738, statut to pending");

  const rows = await sql`SELECT api_name, nb_total, nb_enrichis, statut FROM enrichissement_batch_api WHERE batch_id = 1 ORDER BY api_name`;
  console.table(rows);
  await sql.end();
}
main();
