import pg from "pg";
import "dotenv/config";

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL || process.env.DIRECT_URL,
  ssl: { rejectUnauthorized: false },
});

async function main() {
  const client = await pool.connect();
  try {
    // Widen violation title from varchar(150) to varchar(500)
    await client.query(`ALTER TABLE violations ALTER COLUMN title TYPE varchar(500)`);
    console.log("✅ violations.title widened to varchar(500)");

    // Widen violation description from varchar(500) to text
    await client.query(`ALTER TABLE violations ALTER COLUMN description TYPE text`);
    console.log("✅ violations.description widened to text");

    console.log("\nDone — all column alterations applied.");
  } catch (err) {
    console.error("Error:", err.message);
  } finally {
    client.release();
    await pool.end();
  }
}

main();
