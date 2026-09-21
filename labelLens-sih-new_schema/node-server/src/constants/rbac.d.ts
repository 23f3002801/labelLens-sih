/**
 * TypeScript Type Definitions for Role-Based Access Control (RBAC)
 */

export type UserRole =
  | "DIRECTOR"
  | "CONTROLLER"
  | "REVIEWER"
  | "INSPECTOR"
  | "MANUFACTURER"
  | "CONSUMER";

export type Permission =
  | "user:manage"
  | "role:manage"
  | "rule:manage"
  | "audit:view"
  | "dashboard:global"
  | "dashboard:jurisdiction"
  | "report:approve"
  | "report:export"
  | "report:draft"
  | "scan:view_jurisdiction"
  | "scan:view_org"
  | "scan:view_own"
  | "scan:create"
  | "extraction:edit"
  | "violation:confirm"
  | "product:search"
  | "complaint:file"
  | "complaint:triage";

export interface AuthenticatedUserContext {
  id: string;
  email: string;
  role: UserRole;
  fullName: string;
  employeeId?: string | null;
  badgeNumber?: string | null;
  district?: string | null;
  state?: string | null;
  organizationId?: string | null;
}

export declare const ROLES: Readonly<Record<UserRole, UserRole>>;
export declare const ALL_ROLES: readonly UserRole[];
export declare const PERMISSIONS: Readonly<Record<string, Permission>>;
export declare const ALL_PERMISSIONS: readonly Permission[];
export declare const ROLE_PERMISSIONS: Readonly<Record<UserRole, readonly Permission[]>>;
export declare const GOVERNMENT_ROLES: readonly UserRole[];

export declare function isValidRole(role: unknown): role is UserRole;
export declare function isGovernmentRole(role: unknown): boolean;
export declare function getRolePermissions(role: string): readonly Permission[];
export declare function hasPermission(role: string, permission: Permission): boolean;
export declare function hasAllPermissions(role: string, permissions: Permission[]): boolean;
export declare function hasAnyPermission(role: string, permissions: Permission[]): boolean;
