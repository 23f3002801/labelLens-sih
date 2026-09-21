import "dotenv/config";
import pg from "pg";

const connectionString = process.env.DIRECT_URL || process.env.DATABASE_URL;
if (!connectionString) {
  console.error("Missing DIRECT_URL or DATABASE_URL in environment");
  process.exit(1);
}

const client = new pg.Client({
  connectionString,
  ssl: { rejectUnauthorized: false },
});

async function migrate() {
  console.log("Connecting to PostgreSQL...");
  await client.connect();
  console.log("Connected successfully. Running schema migration...");

  try {
    // 1. Ensure UserRole enum values outside transaction (PostgreSQL requirement)
    console.log("1. Ensuring UserRole enum values...");
    await client.query(`
      DO $$ BEGIN
        CREATE TYPE "UserRole" AS ENUM ('DIRECTOR', 'CONTROLLER', 'REVIEWER', 'INSPECTOR', 'MANUFACTURER', 'CONSUMER');
      EXCEPTION
        WHEN duplicate_object THEN null;
      END $$;
    `);

    for (const val of ["DIRECTOR", "CONTROLLER", "REVIEWER", "INSPECTOR", "MANUFACTURER", "CONSUMER"]) {
      try {
        await client.query(`ALTER TYPE "UserRole" ADD VALUE IF NOT EXISTS '${val}';`);
      } catch (err) {
        // Ignored if already exists
      }
    }

    // Now run remaining migrations in a transaction
    await client.query("BEGIN;");

    // 2. Drop default constraint on users.role
    console.log("2. Adjusting users.role column...");
    await client.query(`ALTER TABLE "users" ALTER COLUMN "role" DROP DEFAULT;`);

    // 3. Map legacy role strings to new roles (column is currently varchar or text)
    await client.query(`
      UPDATE "users" SET "role" = 'INSPECTOR' WHERE "role"::text IN ('FIELD_INSPECTOR', 'inspector');
      UPDATE "users" SET "role" = 'CONTROLLER' WHERE "role"::text IN ('DISTRICT_OFFICER', 'controller');
      UPDATE "users" SET "role" = 'DIRECTOR' WHERE "role"::text IN ('STATE_CONTROLLER', 'ASSISTANT_DIRECTOR');
      UPDATE "users" SET "role" = 'DIRECTOR' WHERE "role"::text IN ('ADMIN', 'admin');
      UPDATE "users" SET "role" = 'CONSUMER' WHERE "role"::text NOT IN ('DIRECTOR', 'CONTROLLER', 'REVIEWER', 'INSPECTOR', 'MANUFACTURER', 'CONSUMER');
    `);

    // 4. Alter column type to UserRole enum with new default
    await client.query(`
      ALTER TABLE "users" ALTER COLUMN "role" TYPE "UserRole" USING "role"::text::"UserRole";
      ALTER TABLE "users" ALTER COLUMN "role" SET DEFAULT 'CONSUMER'::"UserRole";
    `);

    // 5. Add government identifier columns and organization reference on users
    console.log("3. Adding employee_id, badge_number, organization_id to users...");
    await client.query(`
      ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "employee_id" VARCHAR(50);
      ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "badge_number" VARCHAR(50);
      ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "organization_id" VARCHAR(36);
      CREATE UNIQUE INDEX IF NOT EXISTS "ix_users_employee_id" ON "users"("employee_id");
    `);

    // 6. Create organizations table
    console.log("4. Creating organizations table...");
    await client.query(`
      CREATE TABLE IF NOT EXISTS "organizations" (
        "id" VARCHAR(36) PRIMARY KEY,
        "name" VARCHAR(200) NOT NULL,
        "code" VARCHAR(50) UNIQUE,
        "type" VARCHAR(50) NOT NULL DEFAULT 'MANUFACTURER',
        "district" VARCHAR(100),
        "state" VARCHAR(100),
        "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // 7. Add scoped relation columns on inspections
    console.log("5. Updating inspections table with scoping columns...");
    await client.query(`
      ALTER TABLE "inspections" ADD COLUMN IF NOT EXISTS "reviewer_id" VARCHAR(36);
      ALTER TABLE "inspections" ADD COLUMN IF NOT EXISTS "manufacturer_id" VARCHAR(36);
      ALTER TABLE "inspections" ADD COLUMN IF NOT EXISTS "consumer_id" VARCHAR(36);
      CREATE INDEX IF NOT EXISTS "ix_inspections_reviewer_id" ON "inspections"("reviewer_id");
      CREATE INDEX IF NOT EXISTS "ix_inspections_manufacturer_id" ON "inspections"("manufacturer_id");
      CREATE INDEX IF NOT EXISTS "ix_inspections_consumer_id" ON "inspections"("consumer_id");
    `);

    // 8. Create complaints table
    console.log("6. Creating complaints table...");
    await client.query(`
      CREATE TABLE IF NOT EXISTS "complaints" (
        "id" VARCHAR(36) PRIMARY KEY,
        "consumer_id" VARCHAR(36) NOT NULL,
        "inspection_id" VARCHAR(36),
        "title" VARCHAR(200) NOT NULL,
        "description" VARCHAR(1000) NOT NULL,
        "status" VARCHAR(30) NOT NULL DEFAULT 'PENDING',
        "district" VARCHAR(100),
        "state" VARCHAR(100),
        "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT "fk_complaints_consumer" FOREIGN KEY ("consumer_id") REFERENCES "users"("id") ON DELETE CASCADE,
        CONSTRAINT "fk_complaints_inspection" FOREIGN KEY ("inspection_id") REFERENCES "inspections"("id") ON DELETE SET NULL
      );
      CREATE INDEX IF NOT EXISTS "ix_complaints_consumer_id" ON "complaints"("consumer_id");
      CREATE INDEX IF NOT EXISTS "ix_complaints_status" ON "complaints"("status");
    `);

    // 9. Foreign keys for relations
    console.log("7. Setting up foreign keys...");
    await client.query(`
      DO $$ BEGIN
        ALTER TABLE "users" ADD CONSTRAINT "fk_users_organization" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE SET NULL;
      EXCEPTION WHEN duplicate_object THEN null;
      END $$;

      DO $$ BEGIN
        ALTER TABLE "inspections" ADD CONSTRAINT "fk_inspections_reviewer" FOREIGN KEY ("reviewer_id") REFERENCES "users"("id") ON DELETE NO ACTION;
      EXCEPTION WHEN duplicate_object THEN null;
      END $$;

      DO $$ BEGIN
        ALTER TABLE "inspections" ADD CONSTRAINT "fk_inspections_manufacturer" FOREIGN KEY ("manufacturer_id") REFERENCES "organizations"("id") ON DELETE SET NULL;
      EXCEPTION WHEN duplicate_object THEN null;
      END $$;
    `);

    await client.query("COMMIT;");
    console.log("✓ Migration completed successfully!");
  } catch (err) {
    await client.query("ROLLBACK;");
    console.error("Migration failed, transaction rolled back:", err);
    process.exit(1);
  } finally {
    await client.end();
  }
}

migrate();
