import prisma from "../config/db.js";
import { ROLES } from "../constants/rbac.js";
import { SecurityScopingError } from "./dataScopingService.js";

/**
 * Returns dashboard compliance analytics for a specific jurisdiction (district)
 * Used by CONTROLLER role (`dashboard:jurisdiction`).
 *
 * @param {import("../constants/rbac.js").AuthenticatedUserContext} user 
 */
export async function getJurisdictionDashboard(user) {
  if (!user.district) {
    throw new SecurityScopingError(
      "CONTROLLER has no assigned district. Jurisdiction dashboard unavailable."
    );
  }

  const district = user.district.trim();

  // Find all inspections in this controller's district
  const districtWhere = {
    inspector: {
      district: {
        equals: district,
        mode: "insensitive",
      },
    },
  };

  const [
    totalInspections,
    compliantCount,
    nonCompliantCount,
    totalViolations,
    inspectorsInDistrict,
    pendingComplaints,
    recentInspections,
  ] = await Promise.all([
    prisma.inspection.count({ where: districtWhere }),
    prisma.inspection.count({
      where: { ...districtWhere, status: "COMPLIANT" },
    }),
    prisma.inspection.count({
      where: { ...districtWhere, status: "NON_COMPLIANT" },
    }),
    prisma.violation.count({
      where: { inspection: districtWhere },
    }),
    prisma.user.findMany({
      where: {
        role: ROLES.INSPECTOR,
        district: { equals: district, mode: "insensitive" },
      },
      select: {
        id: true,
        fullName: true,
        email: true,
        badgeNumber: true,
        employeeId: true,
        _count: { select: { inspections: true } },
      },
    }),
    prisma.complaint.count({
      where: {
        district: { equals: district, mode: "insensitive" },
        status: "PENDING",
      },
    }),
    prisma.inspection.findMany({
      where: districtWhere,
      take: 5,
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        status: true,
        complianceScore: true,
        createdAt: true,
        inspector: { select: { fullName: true, badgeNumber: true } },
        product: { select: { brandName: true, commodityName: true } },
      },
    }),
  ]);

  const complianceRate =
    totalInspections > 0
      ? Number(((compliantCount / totalInspections) * 100).toFixed(2))
      : 100.0;

  return {
    scope: "JURISDICTION",
    district,
    state: user.state,
    metrics: {
      total_inspections: totalInspections,
      compliant_inspections: compliantCount,
      non_compliant_inspections: nonCompliantCount,
      compliance_rate_percent: complianceRate,
      total_violations_detected: totalViolations,
      active_inspectors_count: inspectorsInDistrict.length,
      pending_consumer_complaints: pendingComplaints,
    },
    inspectors: inspectorsInDistrict,
    recent_inspections: recentInspections,
  };
}

/**
 * Returns global nation-wide/state-wide compliance analytics
 * Used by DIRECTOR (`dashboard:global`).
 *
 * @param {import("../constants/rbac.js").AuthenticatedUserContext} user 
 */
export async function getGlobalDashboard(user) {
  const [
    totalInspections,
    compliantCount,
    nonCompliantCount,
    totalViolations,
    totalOfficers,
    totalComplaints,
    topViolationRules,
  ] = await Promise.all([
    prisma.inspection.count(),
    prisma.inspection.count({ where: { status: "COMPLIANT" } }),
    prisma.inspection.count({ where: { status: "NON_COMPLIANT" } }),
    prisma.violation.count(),
    prisma.user.count({
      where: {
        role: { in: [ROLES.INSPECTOR, ROLES.CONTROLLER, ROLES.REVIEWER] },
      },
    }),
    prisma.complaint.count(),
    prisma.violation.groupBy({
      by: ["ruleCode", "severity"],
      _count: { id: true },
      orderBy: { _count: { id: "desc" } },
      take: 5,
    }),
  ]);

  const complianceRate =
    totalInspections > 0
      ? Number(((compliantCount / totalInspections) * 100).toFixed(2))
      : 100.0;

  return {
    scope: "GLOBAL",
    metrics: {
      total_inspections: totalInspections,
      compliant_inspections: compliantCount,
      non_compliant_inspections: nonCompliantCount,
      overall_compliance_rate_percent: complianceRate,
      total_violations_recorded: totalViolations,
      total_active_enforcement_officers: totalOfficers,
      total_consumer_complaints: totalComplaints,
    },
    top_statutory_violations: topViolationRules.map((v) => ({
      rule_code: v.ruleCode,
      severity: v.severity,
      occurrences: v._count.id,
    })),
  };
}
