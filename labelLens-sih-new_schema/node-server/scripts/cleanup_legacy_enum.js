import "dotenv/config";
import pg from "pg";

const connectionString = process.env.DIRECT_URL || process.env.DATABASE_URL;

const client = new pg.Client({
  connectionString,
  ssl: { rejectUnauthorized: false },
});

async function cleanupEnum() {
  await client.connect();
  console.log("Connected to PostgreSQL. Recreating clean UserRole enum...");

  try {
    await client.query("BEGIN;");

    // 1. Create clean enum type with the six supported roles.
    await client.query(`
      CREATE TYPE "UserRole_clean" AS ENUM (
        'DIRECTOR',
        'CONTROLLER',
        'REVIEWER',
        'INSPECTOR',
        'MANUFACTURER',
        'CONSUMER'
      );
    `);

    // 2. Drop default temporarily
    await client.query(`ALTER TABLE "users" ALTER COLUMN "role" DROP DEFAULT;`);

    // 3. Make sure any lingering legacy string is updated
    await client.query(`
      UPDATE "users" SET "role" = 'INSPECTOR' WHERE "role"::text IN ('FIELD_INSPECTOR', 'inspector');
      UPDATE "users" SET "role" = 'CONTROLLER' WHERE "role"::text IN ('DISTRICT_OFFICER', 'controller');
      UPDATE "users" SET "role" = 'DIRECTOR' WHERE "role"::text IN ('STATE_CONTROLLER', 'ASSISTANT_DIRECTOR');
      UPDATE "users" SET "role" = 'DIRECTOR' WHERE "role"::text IN ('ADMIN', 'admin');
    `);

    // 4. Switch users.role to the clean enum
    await client.query(`
      ALTER TABLE "users" ALTER COLUMN "role" TYPE "UserRole_clean" USING "role"::text::"UserRole_clean";
    `);

    // 5. Drop old enum and rename clean enum to UserRole
    await client.query(`DROP TYPE "UserRole";`);
    await client.query(`ALTER TYPE "UserRole_clean" RENAME TO "UserRole";`);

    // 6. Restore default
    await client.query(`ALTER TABLE "users" ALTER COLUMN "role" SET DEFAULT 'CONSUMER'::"UserRole";`);

    await client.query("COMMIT;");
    console.log("✓ Successfully cleaned up UserRole enum. Only the 7 official roles remain!");

    // Verify
    const res = await client.query(`SELECT enum_range(NULL::"UserRole");`);
    console.log("Current UserRole variants in DB:", res.rows[0].enum_range);
  } catch (err) {
    await client.query("ROLLBACK;");
    console.error("Failed to clean enum:", err);
  } finally {
    await client.end();
  }
}

cleanupEnum();
