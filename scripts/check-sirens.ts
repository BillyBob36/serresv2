import postgres from "postgres";
import * as dotenv from "dotenv";
import { resolve } from "path";
dotenv.config({ path: resolve(__dirname, "../.env.local") });

const sql = postgres(process.env.DATABASE_URL || "postgresql://serres:SerresV2_2024!@65.21.146.193:5433/serresv2", { max: 3 });

async function main() {
  const s1 = await sql`SELECT COUNT(DISTINCT siren) as c FROM serres WHERE siren IS NOT NULL AND siren != ''`;
  const s2 = await sql`SELECT COUNT(DISTINCT siren) as c FROM serre_matches WHERE siren IS NOT NULL AND siren != ''`;
  const union = await sql`SELECT COUNT(*) as c FROM (SELECT DISTINCT siren FROM serres WHERE siren IS NOT NULL AND siren != '' UNION SELECT DISTINCT siren FROM serre_matches WHERE siren IS NOT NULL AND siren != '') x`;

  console.log("serres distinct SIREN:", s1[0].c);
  console.log("serre_matches distinct SIREN:", s2[0].c);
  console.log("UNION total:", union[0].c);

  // Check how many API Gouv are missing
  const apiGouv = await sql`SELECT COUNT(*) as c FROM data_api_gouv WHERE batch_id = 1`;
  const insee = await sql`SELECT COUNT(*) as c FROM data_insee WHERE batch_id = 1`;
  const bodacc = await sql`SELECT COUNT(*) as c FROM data_bodacc WHERE batch_id = 1`;

  console.log("\n--- Enrichment counts ---");
  console.log("data_api_gouv:", apiGouv[0].c);
  console.log("data_insee:", insee[0].c);
  console.log("data_bodacc:", bodacc[0].c);

  // SIRENs in BODACC but not in API Gouv
  const missing = await sql`
    SELECT COUNT(*) as c FROM (
      SELECT DISTINCT siren FROM data_bodacc WHERE batch_id = 1
      EXCEPT
      SELECT DISTINCT siren FROM data_api_gouv WHERE batch_id = 1
    ) x
  `;
  console.log("\nSIRENs dans BODACC mais pas dans API Gouv:", missing[0].c);

  await sql.end();
}
main();
