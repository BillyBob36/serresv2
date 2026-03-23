import postgres from "postgres";
import * as dotenv from "dotenv";
import { resolve } from "path";

dotenv.config({ path: resolve(__dirname, "../.env.local") });

const sql = postgres(process.env.DATABASE_URL || "postgresql://serres:SerresV2_2024!@65.21.146.193:5433/serresv2", { max: 3 });

async function main() {
  const cols = await sql`SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'data_pages_jaunes' ORDER BY ordinal_position`;
  for (const c of cols) console.log(`${c.column_name}: ${c.data_type}`);
  await sql.end();
}
main();
