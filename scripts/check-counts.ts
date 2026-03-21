import postgres from "postgres";
import * as dotenv from "dotenv";
import { resolve } from "path";
dotenv.config({ path: resolve(__dirname, "../.env.local") });

const sql = postgres(process.env.DATABASE_URL || "postgresql://serres:SerresV2_2024!@65.21.146.193:5433/serresv2", { max: 3 });

async function main() {
  const insee = await sql`SELECT COUNT(*) as c FROM data_insee WHERE batch_id = 1`;
  const inseeWithData = await sql`SELECT COUNT(*) as c FROM data_insee WHERE batch_id = 1 AND periodes_historique IS NOT NULL`;
  console.log("data_insee total:", insee[0].c);
  console.log("data_insee avec periodes_historique:", inseeWithData[0].c);

  const apiGouv = await sql`SELECT COUNT(*) as c FROM data_api_gouv WHERE batch_id = 1`;
  console.log("data_api_gouv total:", apiGouv[0].c);

  const bodacc = await sql`SELECT COUNT(*) as c FROM data_bodacc WHERE batch_id = 1`;
  console.log("data_bodacc total:", bodacc[0].c);

  const google = await sql`SELECT COUNT(*) as c FROM data_google_places WHERE batch_id = 1`;
  console.log("data_google_places total:", google[0].c);

  await sql.end();
}
main();
