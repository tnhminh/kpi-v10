import { ApiError } from "@/server/http";
import { hasPermission, permissionsForRole } from "./rbac";
import { resolveRequestSession } from "./service";
import type { AuthenticatedUser, Permission } from "./types";

export async function requireAuthenticated(request: Request, options: { allowPasswordChangeRequired?: boolean } = {}): Promise<AuthenticatedUser> {
  const user = await resolveRequestSession(request);
  if (!user) throw new ApiError(401, "UNAUTHENTICATED", "Authentication is required.");
  if (user.passwordChangeRequired && !options.allowPasswordChangeRequired) {
    throw new ApiError(403, "PASSWORD_CHANGE_REQUIRED", "You must change the temporary password before accessing the application.");
  }
  return user;
}

export async function requirePermission(request: Request, permission: Permission): Promise<AuthenticatedUser> {
  const user = await requireAuthenticated(request);
  if (!hasPermission(user.role, permission)) throw new ApiError(403, "FORBIDDEN", "You do not have permission to perform this action.");
  return user;
}

export async function currentIdentity(request: Request) {
  const user = await requireAuthenticated(request, { allowPasswordChangeRequired: true });
  return { ...user, permissions: permissionsForRole(user.role) };
}
