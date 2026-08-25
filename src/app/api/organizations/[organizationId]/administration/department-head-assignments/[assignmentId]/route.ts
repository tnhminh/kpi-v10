import { assertTrustedMutationRequest, CrossSiteRequestError } from "@/server/auth/csrf";
import { parseServerEnv } from "@/server/env";
import { ApiError, apiErrorResponse, ok, parseJson } from "@/server/http";
import { closeDepartmentHeadAssignment } from "@/server/organization/admin-repository";
import { requireOrganizationPermission } from "@/server/organization/access";
import { closeDepartmentHeadAssignmentSchema, parseUuidParam } from "@/server/organization/validation";
import { getRequestId } from "@/server/request-context";

export const dynamic = "force-dynamic";
type Context = { params: Promise<{ organizationId: string; assignmentId: string }> };

export async function PATCH(request: Request, { params }: Context) {
  try {
    assertTrustedMutationRequest(request, parseServerEnv().APP_URL);
    const route = await params;
    const organizationId = parseUuidParam(route.organizationId, "organizationId");
    const assignmentId = parseUuidParam(route.assignmentId, "assignmentId");
    const { user } = await requireOrganizationPermission(request, organizationId, "admin:manage");
    const payload = await parseJson(request, closeDepartmentHeadAssignmentSchema);
    const requestId = getRequestId(request.headers);
    return ok(request, await closeDepartmentHeadAssignment({ organizationId, assignmentId, actorUserId: user.id, requestId, effectiveTo: payload.effectiveTo }), 200, requestId);
  } catch (error) {
    if (error instanceof CrossSiteRequestError) return apiErrorResponse(request, new ApiError(403, "CROSS_SITE_REQUEST", "Request origin is not allowed."));
    return apiErrorResponse(request, error);
  }
}
