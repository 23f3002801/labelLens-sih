import { AuthenticatedUserContext } from "../constants/rbac.js";

export declare class SecurityScopingError extends Error {
  statusCode: number;
  details: Record<string, unknown>;
  constructor(message: string, details?: Record<string, unknown>);
}

export declare function getInspectionScope(
  user: AuthenticatedUserContext
): Record<string, unknown>;

export declare function getComplaintScope(
  user: AuthenticatedUserContext
): Record<string, unknown>;

export declare function getReportScope(
  user: AuthenticatedUserContext
): Record<string, unknown>;

export declare function mergeScope(
  securityScope: Record<string, unknown>,
  userWhere?: Record<string, unknown>
): Record<string, unknown>;

export declare function canAccessInspection(
  user: AuthenticatedUserContext,
  inspection: Record<string, unknown>
): boolean;

export declare function assertInspectionAccess(
  user: AuthenticatedUserContext,
  inspection: Record<string, unknown>
): void;
