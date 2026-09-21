import "dotenv/config";
import pg from "pg";

const connectionString = process.env.DIRECT_URL || process.env.DATABASE_URL;

const client = new pg.Client({
  connectionString,
  ssl: { rejectUnauthorized: false },
});

async function inspect() {
  await client.connect();

  console.log("=== CONNECTED TO:", client.host, client.database, "===");

  const tables = await client.query(
    "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name;"
  );
  console.log("\nTables in DB:", tables.rows.map((r) => r.table_name));

  const userCols = await client.query(
    "SELECT column_name, data_type, udt_name, is_nullable FROM information_schema.columns WHERE table_name = 'users' ORDER BY ordinal_position;"
  );
  console.log("\nColumns in 'users' table:");
  console.table(userCols.rows);

  const inspectionCols = await client.query(
    "SELECT column_name, data_type, udt_name, is_nullable FROM information_schema.columns WHERE table_name = 'inspections' ORDER BY ordinal_position;"
  );
  console.log("\nColumns in 'inspections' table:");
  console.table(inspectionCols.rows);

  const enumVals = await client.query(
    "SELECT enumlabel FROM pg_enum JOIN pg_type ON pg_enum.enumtypid = pg_type.oid WHERE typname = 'UserRole' ORDER BY enumsortorder;"
  );
  console.log("\nUserRole enum variants in DB:", enumVals.rows.map((r) => r.enumlabel));

  await client.end();
}

inspect().catch(console.error);
