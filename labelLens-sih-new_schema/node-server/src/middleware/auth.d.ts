import { FastifyRequest, FastifyReply } from "fastify";
import { AuthenticatedUserContext, Permission, UserRole } from "../constants/rbac.js";

declare module "fastify" {
  interface FastifyRequest {
    user?: AuthenticatedUserContext;
  }
}

export declare const JWT_SECRET: string;

export declare function authenticateToken(
  req: FastifyRequest,
  reply: FastifyReply
): Promise<void>;

export declare function optionalAuth(
  req: FastifyRequest,
  reply: FastifyReply
): Promise<void>;

export declare function requireFreshUser(
  req: FastifyRequest,
  reply: FastifyReply
): Promise<void>;

export declare function requirePermission(
  ...requiredPermissions: Permission[]
): (req: FastifyRequest, reply: FastifyReply) => Promise<void>;

export declare function requireAnyPermission(
  ...allowedPermissions: Permission[]
): (req: FastifyRequest, reply: FastifyReply) => Promise<void>;

export declare function requireRoles(
  ...allowedRoles: UserRole[]
): (req: FastifyRequest, reply: FastifyReply) => Promise<void>;
