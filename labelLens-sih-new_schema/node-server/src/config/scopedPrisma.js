import prisma from "./db.js";
import {
  getInspectionScope,
  getComplaintScope,
  getReportScope,
  mergeScope,
} from "../services/dataScopingService.js";

/**
 * Returns a Prisma client instance extended with row-level security scopes
 * automatically bound to the authenticated user's hierarchy and role.
 *
 * @param {import("../constants/rbac.js").AuthenticatedUserContext} user 
 * @returns {import("@prisma/client").PrismaClient}
 */
export function getScopedPrisma(user) {
  if (!user) {
    throw new Error("Cannot create scoped Prisma client without authenticated user context");
  }

  const inspectionScope = getInspectionScope(user);
  const complaintScope = getComplaintScope(user);
  const reportScope = getReportScope(user);

  return prisma.$extends({
    name: "rowLevelSecurityScoping",
    query: {
      inspection: {
        async findMany({ args, query }) {
          args.where = mergeScope(inspectionScope, args.where);
          return query(args);
        },
        async findFirst({ args, query }) {
          args.where = mergeScope(inspectionScope, args.where);
          return query(args);
        },
        async count({ args, query }) {
          args.where = mergeScope(inspectionScope, args.where);
          return query(args);
        },
        async updateMany({ args, query }) {
          args.where = mergeScope(inspectionScope, args.where);
          return query(args);
        },
        async deleteMany({ args, query }) {
          args.where = mergeScope(inspectionScope, args.where);
          return query(args);
        },
      },
      complaint: {
        async findMany({ args, query }) {
          args.where = mergeScope(complaintScope, args.where);
          return query(args);
        },
        async findFirst({ args, query }) {
          args.where = mergeScope(complaintScope, args.where);
          return query(args);
        },
        async count({ args, query }) {
          args.where = mergeScope(complaintScope, args.where);
          return query(args);
        },
      },
      report: {
        async findMany({ args, query }) {
          args.where = mergeScope(reportScope, args.where);
          return query(args);
        },
        async findFirst({ args, query }) {
          args.where = mergeScope(reportScope, args.where);
          return query(args);
        },
        async count({ args, query }) {
          args.where = mergeScope(reportScope, args.where);
          return query(args);
        },
      },
    },
  });
}

export default getScopedPrisma;
