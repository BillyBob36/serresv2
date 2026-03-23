import postgres from "postgres";
import * as dotenv from "dotenv";
import { resolve } from "path";

dotenv.config({ path: resolve(__dirname, "../.env.local") });

const sql = postgres(
  process.env.DATABASE_URL || "postgresql://serres:SerresV2_2024!@65.21.146.193:5433/serresv2",
  { max: 3 }
);

async function main() {
  console.log("Adding missing columns to data_pages_jaunes...");

  await sql`ALTER TABLE data_pages_jaunes ADD COLUMN IF NOT EXISTS email text`;
  console.log("  + email");

  await sql`ALTER TABLE data_pages_jaunes ADD COLUMN IF NOT EXISTS horaires text`;
  console.log("  + horaires");

  await sql`ALTER TABLE data_pages_jaunes ADD COLUMN IF NOT EXISTS note_pj numeric`;
  console.log("  + note_pj");

  await sql`ALTER TABLE data_pages_jaunes ADD COLUMN IF NOT EXISTS nb_avis integer`;
  console.log("  + nb_avis");

  await sql`ALTER TABLE data_pages_jaunes ADD COLUMN IF NOT EXISTS match_confidence text`;
  console.log("  + match_confidence");

  await sql`ALTER TABLE data_pages_jaunes ADD COLUMN IF NOT EXISTS source_personne text`;
  console.log("  + source_personne");

  console.log("Done!");
  await sql.end();
}

main();
