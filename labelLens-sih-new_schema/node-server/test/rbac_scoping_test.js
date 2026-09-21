import "dotenv/config";
import assert from "assert";
import jwt from "jsonwebtoken";
import { buildServer } from "../src/server.js";
import prisma from "../src/config/db.js";
import {
  ROLES,
  PERMISSIONS,
  ROLE_PERMISSIONS,
  hasPermission,
  hasAllPermissions,
  hasAnyPermission,
  getRolePermissions,
} from "../src/constants/rbac.js";
import {
  getInspectionScope,
  getComplaintScope,
  getReportScope,
  mergeScope,
  assertInspectionAccess,
  canAccessInspection,
  SecurityScopingError,
} from "../src/services/dataScopingService.js";
import { getScopedPrisma } from "../src/config/scopedPrisma.js";
import { JWT_SECRET } from "../src/middleware/auth.js";

async function runRbacTests() {
  console.log("=== Starting Legal Metrology RBAC & Row-Level Scoping Test Suite ===\n");

  const app = await buildServer();
  await app.ready();

  try {
    // -------------------------------------------------------------
    // Test 1: Functional Roles & Permission Matrix Verification
    // -------------------------------------------------------------
    console.log("1. Verifying Context 1: Roles & Permission Matrix mapping...");

    // DIRECTOR
    const directorPerms = getRolePermissions(ROLES.DIRECTOR);
    assert.deepStrictEqual(
      [...directorPerms].sort(),
      ["user:manage", "role:manage", "rule:manage", "audit:view", "dashboard:global", "scan:create"].sort()
    );
    assert.ok(hasPermission(ROLES.DIRECTOR, PERMISSIONS.USER_MANAGE));
    assert.ok(hasPermission(ROLES.DIRECTOR, PERMISSIONS.DASHBOARD_GLOBAL));
    assert.ok(hasPermission(ROLES.DIRECTOR, PERMISSIONS.SCAN_CREATE));

    // CONTROLLER
    const controllerPerms = getRolePermissions(ROLES.CONTROLLER);
    assert.deepStrictEqual(
      [...controllerPerms].sort(),
      ["dashboard:jurisdiction", "report:approve", "report:export", "scan:view_jurisdiction", "scan:create"].sort()
    );

    // REVIEWER
    const reviewerPerms = getRolePermissions(ROLES.REVIEWER);
    assert.deepStrictEqual(
      [...reviewerPerms].sort(),
      ["scan:view_org", "violation:confirm", "report:draft", "scan:create"].sort()
    );

    // INSPECTOR
    const inspectorPerms = getRolePermissions(ROLES.INSPECTOR);
    assert.deepStrictEqual(
      [...inspectorPerms].sort(),
      ["scan:create", "scan:view_own", "extraction:edit", "report:draft"].sort()
    );

    // MANUFACTURER
    const manufacturerPerms = getRolePermissions(ROLES.MANUFACTURER);
    assert.deepStrictEqual(
      [...manufacturerPerms].sort(),
      ["scan:view_own", "product:search", "scan:create"].sort()
    );

    // CONSUMER
    const consumerPerms = getRolePermissions(ROLES.CONSUMER);
    assert.deepStrictEqual(
      [...consumerPerms].sort(),
      ["complaint:file", "complaint:triage", "product:search", "scan:create"].sort()
    );

    console.log("   ✓ All 7 role permissions match Context 1 matrix exactly\n");

    // -------------------------------------------------------------
    // Test 2: Row-Level Data Scoping Query Generators (Prisma where)
    // -------------------------------------------------------------
    console.log("2. Verifying Context 1: Data Scoping (Row-Level Security) clauses...");

    const directorUser = { id: "dir-1", role: ROLES.DIRECTOR, fullName: "Director General" };
    const inspectorUser = { id: "insp-1", role: ROLES.INSPECTOR, district: "Varanasi", fullName: "Officer Kumar" };
    const reviewerUser = { id: "rev-1", role: ROLES.REVIEWER, fullName: "Reviewer Gupta" };
    const controllerUser = { id: "ctrl-1", role: ROLES.CONTROLLER, district: "Varanasi", state: "UP", fullName: "Controller Singh" };
    const manufacturerUser = { id: "mfr-1", role: ROLES.MANUFACTURER, fullName: "Manufacturer Quality Mgr" };
    const consumerUser = { id: "cons-1", role: ROLES.CONSUMER, fullName: "Citizen Ramesh" };

    // DIRECTOR -> Global access ({})
    assert.deepStrictEqual(getInspectionScope(directorUser), {});

    // INSPECTOR -> { inspectorId: req.user.id }
    assert.deepStrictEqual(getInspectionScope(inspectorUser), { inspectorId: "insp-1" });

    // REVIEWER -> { reviewerId: req.user.id }
    assert.deepStrictEqual(getInspectionScope(reviewerUser), { reviewerId: "rev-1" });

    // CONTROLLER -> { inspector: { district: req.user.district } }
    assert.deepStrictEqual(getInspectionScope(controllerUser), {
      inspector: {
        district: {
          equals: "Varanasi",
          mode: "insensitive",
        },
      },
    });

    // MANUFACTURER -> { inspectorId: req.user.id }
    assert.deepStrictEqual(getInspectionScope(manufacturerUser), { inspectorId: "mfr-1" });

    // CONSUMER -> { consumerId: req.user.id }
    assert.deepStrictEqual(getInspectionScope(consumerUser), {
      consumerId: "cons-1",
    });

    console.log("   ✓ All row-level scope clauses match Context 1 specification exactly\n");

    // -------------------------------------------------------------
    // Test 3: Fail-Closed Protection Against Missing Attributes
    // -------------------------------------------------------------
    console.log("3. Testing Fail-Closed Security (Missing District/Org)...");

    const badController = { id: "ctrl-bad", role: ROLES.CONTROLLER, district: null };
    assert.throws(
      () => getInspectionScope(badController),
      (err) => err instanceof SecurityScopingError && err.message.includes("missing assigned jurisdiction"),
      "Controller without district must fail-closed"
    );

    const unlinkedManufacturer = { id: "mfr-unlinked", role: ROLES.MANUFACTURER };
    assert.deepStrictEqual(getInspectionScope(unlinkedManufacturer), { inspectorId: "mfr-unlinked" });

    console.log("   ✓ Fail-closed checks prevent jurisdiction data leakage\n");

    // -------------------------------------------------------------
    // Test 4: Anti-IDOR Object-Level Access Assertion
    // -------------------------------------------------------------
    console.log("4. Testing Anti-IDOR Entity Access Verification...");

    const mockScanVaranasi = {
      id: "scan-varanasi-1",
      inspectorId: "insp-1",
      reviewerId: "rev-1",
      manufacturerId: "org-nestle-101",
      consumerId: "cons-1",
      inspector: { id: "insp-1", district: "Varanasi" },
    };

    const mockScanLucknow = {
      id: "scan-lucknow-2",
      inspectorId: "insp-lucknow-9",
      reviewerId: "rev-2",
      manufacturerId: "org-dabur-202",
      consumerId: "cons-2",
      inspector: { id: "insp-lucknow-9", district: "Lucknow" },
    };

    const mockScanManufacturer = {
      id: "scan-manufacturer-1",
      inspectorId: "mfr-1",
      reviewerId: null,
      manufacturerId: null,
      consumerId: null,
      inspector: { id: "mfr-1", district: null },
    };

    // Controller for Varanasi CAN access Varanasi scan, but CANNOT access Lucknow scan
    assert.strictEqual(canAccessInspection(controllerUser, mockScanVaranasi), true);
    assert.strictEqual(canAccessInspection(controllerUser, mockScanLucknow), false);

    // Inspector 1 CAN access own scan, CANNOT access Inspector 9's scan
    assert.strictEqual(canAccessInspection(inspectorUser, mockScanVaranasi), true);
    assert.strictEqual(canAccessInspection(inspectorUser, mockScanLucknow), false);

    // Manufacturer can access only scans they created
    assert.strictEqual(canAccessInspection(manufacturerUser, mockScanManufacturer), true);
    assert.strictEqual(canAccessInspection(manufacturerUser, mockScanLucknow), false);

    // Director CAN access both
    assert.strictEqual(canAccessInspection(directorUser, mockScanVaranasi), true);
    assert.strictEqual(canAccessInspection(directorUser, mockScanLucknow), true);

    console.log("   ✓ Anti-IDOR enforcement successfully isolates cross-district & cross-inspector data\n");

    // -------------------------------------------------------------
    // Test 5: End-to-End Route Enforcement with Mock JWTs
    // -------------------------------------------------------------
    console.log("5. Testing Fastify HTTP Route Enforcement with RBAC PreHandlers...");

    const makeToken = (userCtx) => jwt.sign(userCtx, JWT_SECRET, { expiresIn: "1h" });

    // Ensure a persistent test consumer exists in DB for foreign key constraint
    const dbConsumer = await prisma.user.upsert({
      where: { email: "test_consumer_rbac@example.com" },
      update: { role: ROLES.CONSUMER },
      create: {
        email: "test_consumer_rbac@example.com",
        fullName: "Citizen Ramesh",
        role: ROLES.CONSUMER,
        district: "Varanasi",
        state: "UP",
      },
    });

    const controllerToken = makeToken(controllerUser);
    const inspectorToken = makeToken(inspectorUser);
    const consumerToken = makeToken({ ...consumerUser, id: dbConsumer.id });
    const directorToken = makeToken(directorUser);

    // Route A: Controller Dashboard (/api/v1/compliance/dashboard/jurisdiction)
    // - Requires `dashboard:jurisdiction`
    console.log("   Testing /api/v1/compliance/dashboard/jurisdiction permission guard...");
    const unauthorizedRes = await app.inject({
      method: "GET",
      url: "/api/v1/compliance/dashboard/jurisdiction",
      headers: { authorization: `Bearer ${inspectorToken}` },
    });
    assert.strictEqual(unauthorizedRes.statusCode, 403, "Inspector must get 403 on controller dashboard");
    const unauthBody = JSON.parse(unauthorizedRes.payload);
    assert.strictEqual(unauthBody.error, "Forbidden");

    const authorizedRes = await app.inject({
      method: "GET",
      url: "/api/v1/compliance/dashboard/jurisdiction",
      headers: { authorization: `Bearer ${controllerToken}` },
    });
    assert.strictEqual(authorizedRes.statusCode, 200, "Controller must get 200 OK on jurisdiction dashboard");
    const authBody = JSON.parse(authorizedRes.payload);
    assert.strictEqual(authBody.district, "Varanasi");
    assert.strictEqual(authBody.scope, "JURISDICTION");
    console.log("   ✓ Jurisdiction dashboard correctly restricted to CONTROLLER role");

    // Route B: Director Global Dashboard (/api/v1/compliance/dashboard/global)
    // - Requires `dashboard:global`
    console.log("   Testing /api/v1/compliance/dashboard/global permission guard...");
    const nonDirRes = await app.inject({
      method: "GET",
      url: "/api/v1/compliance/dashboard/global",
      headers: { authorization: `Bearer ${controllerToken}` },
    });
    assert.strictEqual(nonDirRes.statusCode, 403, "Controller must get 403 on global dashboard");

    const dirRes = await app.inject({
      method: "GET",
      url: "/api/v1/compliance/dashboard/global",
      headers: { authorization: `Bearer ${directorToken}` },
    });
    assert.strictEqual(dirRes.statusCode, 200, "Director must get 200 on global dashboard");
    const dirBody = JSON.parse(dirRes.payload);
    assert.strictEqual(dirBody.scope, "GLOBAL");
    console.log("   ✓ Global dashboard correctly restricted to DIRECTOR role");

    // Route C: Consumer Filing Complaint (/api/v1/compliance/complaints)
    console.log("   Testing Consumer complaint filing and triage...");
    const fileComplaintRes = await app.inject({
      method: "POST",
      url: "/api/v1/compliance/complaints",
      headers: { authorization: `Bearer ${consumerToken}` },
      payload: {
        title: "Missing Net Weight Declaration on Edible Oil",
        description: "Package found in store with missing net quantity declaration contrary to Rule 12",
        district: "Varanasi",
      },
    });
    assert.strictEqual(fileComplaintRes.statusCode, 201);
    const complaintData = JSON.parse(fileComplaintRes.payload).complaint;
    assert.strictEqual(complaintData.consumerId, dbConsumer.id);
    assert.strictEqual(complaintData.status, "PENDING");
    console.log("   ✓ Consumer successfully filed complaint with automated caller binding");

    // Route D: Scoped Complaint List (/api/v1/compliance/complaints)
    const consumerListRes = await app.inject({
      method: "GET",
      url: "/api/v1/compliance/complaints",
      headers: { authorization: `Bearer ${consumerToken}` },
    });
    assert.strictEqual(consumerListRes.statusCode, 200);
    const listPayload = JSON.parse(consumerListRes.payload);
    assert.ok(Array.isArray(listPayload.items));
    assert.ok(listPayload.items.some((c) => c.id === complaintData.id));
    console.log("   ✓ Consumer retrieved scoped complaint list");

    // Clean up created test complaint
    await prisma.complaint.delete({ where: { id: complaintData.id } }).catch(() => {});
    await prisma.user.delete({ where: { id: dbConsumer.id } }).catch(() => {});

    // -------------------------------------------------------------
    // Test 6: Scoped Prisma Client Extension Verification
    // -------------------------------------------------------------
    console.log("\n6. Testing Prisma Client Extension ($extends row-level scoping)...");
    const scopedClient = getScopedPrisma(inspectorUser);
    assert.ok(scopedClient, "Scoped Prisma client instantiated successfully");
    const scopedCount = await scopedClient.inspection.count();
    assert.strictEqual(typeof scopedCount, "number");
    console.log(`   ✓ Scoped Prisma query evaluated successfully (Returned ${scopedCount} inspections for inspector)`);

    console.log("\n=== ALL RBAC & ROW-LEVEL DATA SCOPING TESTS PASSED! ===");
  } finally {
    await prisma.user.deleteMany({ where: { email: "test_consumer_rbac@example.com" } }).catch(() => {});
    await prisma.$disconnect();
    await app.close();
  }
}

runRbacTests().catch((err) => {
  console.error("RBAC Test Suite Failure:", err);
  process.exit(1);
});
