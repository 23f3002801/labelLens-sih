import prisma from "../config/db.js";
import {
  getInspectionScope,
  mergeScope,
  assertInspectionAccess,
  SecurityScopingError,
} from "./dataScopingService.js";
import { ROLES } from "../constants/rbac.js";

/**
 * Lists inspections scoped to the caller's governmental hierarchy and role.
 *
 * @param {import("../constants/rbac.js").AuthenticatedUserContext} user 
 * @param {Object} [queryOptions]
 * @param {number} [queryOptions.page=1]
 * @param {number} [queryOptions.limit=20]
 * @param {string} [queryOptions.status]
 * @param {string} [queryOptions.district] Optional district filter (for global users)
 * @param {string} [queryOptions.productId]
 */
export async function listScopedInspections(user, queryOptions = {}) {
  const page = Math.max(1, parseInt(queryOptions.page) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(queryOptions.limit) || 20));
  const skip = (page - 1) * limit;

  // Base scope mandated by security matrix
  const securityScope = getInspectionScope(user);

  // Additional user filters
  const userWhere = {};
  if (queryOptions.status) {
    userWhere.status = String(queryOptions.status).toUpperCase();
  }
  if (queryOptions.productId) {
    userWhere.productId = queryOptions.productId;
  }
  if (queryOptions.district && user.role === ROLES.DIRECTOR) {
    // Only global roles can freely filter by arbitrary district
    userWhere.inspector = {
      district: {
        equals: String(queryOptions.district).trim(),
        mode: "insensitive",
      },
    };
  }

  const where = mergeScope(securityScope, userWhere);

  const [total, items] = await Promise.all([
    prisma.inspection.count({ where }),
    prisma.inspection.findMany({
      where,
      skip,
      take: limit,
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        productId: true,
        inspectorId: true,
        reviewerId: true,
        manufacturerId: true,
        consumerId: true,
        status: true,
        imagePath: true,
        annotatedImagePath: true,
        complianceScore: true,
        createdAt: true,
        inspector: {
          select: {
            id: true,
            fullName: true,
            email: true,
            district: true,
            state: true,
            badgeNumber: true,
          },
        },
        reviewer: {
          select: {
            id: true,
            fullName: true,
            email: true,
          },
        },
        product: {
          select: {
            id: true,
            brandName: true,
            commodityName: true,
            category: true,
          },
        },
        violations: {
          select: {
            id: true,
            ruleCode: true,
            severity: true,
            title: true,
          },
        },
      },
    }),
  ]);

  return {
    page,
    limit,
    total,
    total_pages: Math.ceil(total / limit),
    items,
  };
}

/**
 * Retrieves a single inspection by ID while enforcing row-level security scoping.
 *
 * @param {import("../constants/rbac.js").AuthenticatedUserContext} user 
 * @param {string} inspectionId 
 */
export async function getScopedInspectionById(user, inspectionId) {
  if (!inspectionId) {
    throw new Error("Inspection ID is required");
  }

  // Check if inspection exists without scope first, to distinguish 404 from 403
  const rawInspection = await prisma.inspection.findUnique({
    where: { id: inspectionId },
    include: {
      inspector: {
        select: {
          id: true,
          fullName: true,
          email: true,
          district: true,
          state: true,
          badgeNumber: true,
          employeeId: true,
        },
      },
      reviewer: {
        select: {
          id: true,
          fullName: true,
          email: true,
          badgeNumber: true,
        },
      },
      product: true,
      violations: true,
      reports: true,
    },
  });

  if (!rawInspection) {
    return null;
  }

  // Enforce Row-Level Security Scoping
  assertInspectionAccess(user, rawInspection);

  return rawInspection;
}

/**
 * Creates an inspection with automated attribution according to caller's role.
 *
 * @param {import("../constants/rbac.js").AuthenticatedUserContext} user 
 * @param {Object} data 
 */
export async function createScopedInspection(user, data) {
  const role = (user.role || "").toUpperCase();
  const createData = {
    imagePath: data.imagePath || null,
    annotatedImagePath: data.annotatedImagePath || null,
    rawOcrOutput: data.rawOcrOutput || null,
    extractedDeclarations: data.extractedDeclarations || null,
    complianceScore: typeof data.complianceScore === "number" ? data.complianceScore : 100.0,
    status: data.status || "COMPLIANT",
    locationLat: data.locationLat || null,
    locationLng: data.locationLng || null,
    productId: data.productId || null,
  };

  // Attribute ownership based on role
  if (role === ROLES.INSPECTOR) {
    createData.inspectorId = user.id;
  } else if (role === ROLES.CONSUMER) {
    createData.consumerId = user.id;
  } else if (role === ROLES.MANUFACTURER) {
    createData.inspectorId = user.id;
  } else if (role === ROLES.REVIEWER) {
    createData.reviewerId = user.id;
  } else if (data.inspectorId && (role === ROLES.DIRECTOR || role === ROLES.CONTROLLER)) {
    createData.inspectorId = data.inspectorId;
  } else {
    createData.inspectorId = user.id;
  }

  // Handle nested violations if provided
  if (Array.isArray(data.violations) && data.violations.length > 0) {
    createData.violations = {
      create: data.violations.map((v) => ({
        ruleCode: v.ruleCode || "RULE_VIOLATION",
        severity: v.severity || "MAJOR",
        title: v.title || "Legal Metrology Violation",
        description: v.description || "",
        evidenceBbox: v.evidenceBbox || null,
        citation: v.citation || null,
        detectedOnPackage: v.detectedOnPackage || null,
        expectedOnPackage: v.expectedOnPackage || null,
        packageElement: v.packageElement || null,
      })),
    };
  }

  return prisma.inspection.create({
    data: createData,
    include: {
      inspector: {
        select: {
          id: true,
          fullName: true,
          email: true,
          district: true,
          state: true,
        },
      },
      product: true,
      violations: true,
    },
  });
}

/**
 * Assigns a Reviewer to an Inspection (Controller/Director only)
 *
 * @param {import("../constants/rbac.js").AuthenticatedUserContext} user 
 * @param {string} inspectionId 
 * @param {string} reviewerId 
 */
export async function assignReviewer(user, inspectionId, reviewerId) {
  const inspection = await getScopedInspectionById(user, inspectionId);
  if (!inspection) {
    throw new Error("Inspection not found or inaccessible");
  }

  // Verify that the assigned user is actually a REVIEWER
  const reviewer = await prisma.user.findUnique({
    where: { id: reviewerId },
    select: { id: true, role: true, fullName: true },
  });

  if (!reviewer || reviewer.role !== ROLES.REVIEWER) {
    throw new Error("Target user is not a valid Reviewer");
  }

  return prisma.inspection.update({
    where: { id: inspectionId },
    data: { reviewerId: reviewer.id },
    include: { reviewer: true },
  });
}

/**
 * Confirms or modifies a violation on an inspection (Reviewer role)
 *
 * @param {import("../constants/rbac.js").AuthenticatedUserContext} user 
 * @param {string} inspectionId 
 * @param {string} violationId 
 * @param {Object} updates 
 */
export async function confirmViolation(user, inspectionId, violationId, updates = {}) {
  const inspection = await getScopedInspectionById(user, inspectionId);
  if (!inspection) {
    throw new Error("Inspection not found or inaccessible");
  }

  const existingViolation = await prisma.violation.findFirst({
    where: { id: violationId, inspectionId },
  });

  if (!existingViolation) {
    throw new Error(`Violation with id '${violationId}' not found on inspection '${inspectionId}'`);
  }

  const updatedViolation = await prisma.violation.update({
    where: { id: violationId },
    data: {
      severity: updates.severity || existingViolation.severity,
      title: updates.title || existingViolation.title,
      description: updates.description || existingViolation.description,
    },
  });

  // Automatically stamp reviewer onto the inspection if not already set
  if (user.role === ROLES.REVIEWER && !inspection.reviewerId) {
    await prisma.inspection.update({
      where: { id: inspectionId },
      data: { reviewerId: user.id },
    });
  }

  return updatedViolation;
}
