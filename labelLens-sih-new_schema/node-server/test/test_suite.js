import "dotenv/config";
import assert from "assert";
import { buildServer } from "../src/server.js";
import prisma from "../src/config/db.js";

async function runTests() {
  console.log("=== Starting LabelLens Fastify Integration Test Suite ===\n");
  const app = await buildServer();
  await app.ready();

  let testUserToken = null;
  let testUserId = null;
  const testEmail = `test_inspector_${Date.now()}@example.com`;
  const testPassword = "Password123!";

  try {
    // 1. Health Check
    console.log("1. Testing GET /health ...");
    const healthRes = await app.inject({
      method: "GET",
      url: "/health",
    });
    assert.strictEqual(healthRes.statusCode, 200);
    const healthBody = JSON.parse(healthRes.payload);
    assert.strictEqual(healthBody.status, "ok");
    console.log("   ✓ /health returned 200 OK\n");

    // 2. Auth Register
    console.log("2. Testing POST /api/v1/auth/register ...");
    const registerRes = await app.inject({
      method: "POST",
      url: "/api/v1/auth/register",
      payload: {
        email: testEmail,
        password: testPassword,
        fullName: "Test Inspector Officer",
        role: "INSPECTOR",
        district: "Varanasi",
        state: "Uttar Pradesh",
        badgeNumber: "BADGE-9988",
      },
    });
    assert.strictEqual(registerRes.statusCode, 201);
    const registerBody = JSON.parse(registerRes.payload);
    assert.ok(registerBody.token, "Token should be returned");
    assert.strictEqual(registerBody.user.email, testEmail);
    assert.strictEqual(registerBody.user.role, "INSPECTOR");
    testUserToken = registerBody.token;
    testUserId = registerBody.user.id;
    console.log("   ✓ User registered successfully with JWT and bcrypt hash\n");

    // 3. Auth Login
    console.log("3. Testing POST /api/v1/auth/login ...");
    const loginRes = await app.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      payload: {
        email: testEmail,
        password: testPassword,
      },
    });
    assert.strictEqual(loginRes.statusCode, 200);
    const loginBody = JSON.parse(loginRes.payload);
    assert.ok(loginBody.token, "Token should be returned");
    assert.strictEqual(loginBody.user.id, testUserId);
    console.log("   ✓ Login successful with correct credentials\n");

    // 4. Invalid Login Attempt
    console.log("4. Testing POST /api/v1/auth/login with wrong password ...");
    const wrongLoginRes = await app.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      payload: {
        email: testEmail,
        password: "WrongPassword!",
      },
    });
    assert.strictEqual(wrongLoginRes.statusCode, 401);
    console.log("   ✓ Wrong password correctly rejected with 401 Unauthorized\n");

    // 5. Protected Profile GET /api/v1/auth/me
    console.log("5. Testing GET /api/v1/auth/me with Bearer token ...");
    const meRes = await app.inject({
      method: "GET",
      url: "/api/v1/auth/me",
      headers: {
        authorization: `Bearer ${testUserToken}`,
      },
    });
    assert.strictEqual(meRes.statusCode, 200);
    const meBody = JSON.parse(meRes.payload);
    assert.strictEqual(meBody.user.id, testUserId);
    assert.strictEqual(meBody.user.email, testEmail);
    console.log("   ✓ Profile retrieved successfully via JWT authentication\n");

    // 6. DB Query Verification
    console.log("6. Testing Database Records via Prisma ...");
    const dbUser = await prisma.user.findUnique({
      where: { id: testUserId },
    });
    assert.ok(dbUser);
    assert.strictEqual(dbUser.email, testEmail);
    console.log("   ✓ Prisma successfully queried User model in PostgreSQL\n");

    // 7. Inspections List
    console.log("7. Testing GET /api/v1/inspections ...");
    const listRes = await app.inject({
      method: "GET",
      url: "/api/v1/inspections",
    });
    assert.strictEqual(listRes.statusCode, 200);
    const listBody = JSON.parse(listRes.payload);
    assert.ok(Array.isArray(listBody.items));
    console.log(`   ✓ Found ${listBody.total} existing inspections in DB\n`);

    console.log("=== All Fastify & Database Integration Tests Passed Successfully! ===\n");
  } finally {
    // Cleanup test user
    if (testUserId) {
      await prisma.user.delete({ where: { id: testUserId } }).catch(() => {});
      console.log("Cleaned up test user record from DB.");
    }
    await prisma.$disconnect();
    await app.close();
  }
}

runTests().catch((err) => {
  console.error("Test Suite Failed:", err);
  process.exit(1);
});
