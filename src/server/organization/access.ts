import { and, eq } from "drizzle-orm";
import { getDb } from "@/server/db/client";
import { organizations, userOrganizationAccess } from "@/server/db/schema";
import { ApiError } from "@/server/http";
import { hasPermission } from "@/server/auth/rbac";
import { requireAuthenticated } from "@/server/auth/authorization";
import type { AppRole, AuthenticatedUser, Permission } from "@/server/auth/types";

export interface OrganizationAccess {
  organizationId: string;
  organizationName: string;
  organizationSlug: string;
  role: AppRole;
}

export async function listAccessibleOrganizations(userId: string): Promise<OrganizationAccess[]> {
  return getDb()
    .select({
      organizationId: organizations.id,
      organizationName: organizations.name,
      organizationSlug: organizations.slug,
      role: userOrganizationAccess.role,
    })
    .from(userOrganizationAccess)
    .innerJoin(organizations, eq(userOrganizationAccess.organizationId, organizations.id))
    .where(and(eq(userOrganizationAccess.userId, userId), eq(userOrganizationAccess.active, true)))
    .orderBy(organizations.name);
}

export async function getOrganizationAccess(userId: string, organizationId: string): Promise<OrganizationAccess | null> {
  const rows = await getDb()
    .select({
      organizationId: organizations.id,
      organizationName: organizations.name,
      organizationSlug: organizations.slug,
      role: userOrganizationAccess.role,
    })
    .from(userOrganizationAccess)
    .innerJoin(organizations, eq(userOrganizationAccess.organizationId, organizations.id))
    .where(and(
      eq(userOrganizationAccess.userId, userId),
      eq(userOrganizationAccess.organizationId, organizationId),
      eq(userOrganizationAccess.active, true),
    ))
    .limit(1);
  return rows[0] ?? null;
}

export function assertOrganizationRolePermission(role: AppRole, permission: Permission): void {
  if (!hasPermission(role, permission)) {
    throw new ApiError(403, "FORBIDDEN", "You do not have permission to perform this action in this organization.");
  }
}

export async function requireOrganizationPermission(
  request: Request,
  organizationId: string,
  permission: Permission,
): Promise<{ user: AuthenticatedUser; access: OrganizationAccess }> {
  const user = await requireAuthenticated(request);
  const access = await getOrganizationAccess(user.id, organizationId);
  if (!access) throw new ApiError(404, "ORGANIZATION_NOT_FOUND", "Organization was not found.");
  assertOrganizationRolePermission(access.role, permission);
  return { user, access };
}
