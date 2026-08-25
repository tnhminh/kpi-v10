import { assertTrustedMutationRequest, CrossSiteRequestError } from "@/server/auth/csrf";
import { parseServerEnv } from "@/server/env";
import { apiErrorResponse, ApiError, ok, parseJson } from "@/server/http";
import { deleteCriterion, updateCriterion } from "@/server/kpi/repository";
import { updateCriterionSchema } from "@/server/kpi/validation";
import { requireOrganizationPermission } from "@/server/organization/access";
import { parseUuidParam } from "@/server/organization/validation";
import { getRequestId } from "@/server/request-context";

export const dynamic = "force-dynamic";
type Context = { params: Promise<{ organizationId: string; criterionId: string }> };

export async function PATCH(request: Request, { params }: Context) {
  try {
    assertTrustedMutationRequest(request, parseServerEnv().APP_URL);
    const route = await params;
    const organizationId = parseUuidParam(route.organizationId, "organizationId");
    const criterionId = parseUuidParam(route.criterionId, "criterionId");
    const { user } = await requireOrganizationPermission(request, organizationId, "kpi:manage");
    const patch = await parseJson(request, updateCriterionSchema);
    const requestId = getRequestId(request.headers);
    return ok(request, await updateCriterion({ organizationId, criterionId, actorUserId: user.id, requestId, patch }), 200, requestId);
  } catch (error) {
    if (error instanceof CrossSiteRequestError) return apiErrorResponse(request, new ApiError(403, "CROSS_SITE_REQUEST", "Request origin is not allowed."));
    return apiErrorResponse(request, error);
  }
}

export async function DELETE(request: Request, { params }: Context) {
  try {
    assertTrustedMutationRequest(request, parseServerEnv().APP_URL);
    const route = await params;
    const organizationId = parseUuidParam(route.organizationId, "organizationId");
    const criterionId = parseUuidParam(route.criterionId, "criterionId");
    const { user } = await requireOrganizationPermission(request, organizationId, "kpi:manage");
    const requestId = getRequestId(request.headers);
    return ok(request, await deleteCriterion({ organizationId, criterionId, actorUserId: user.id, requestId }), 200, requestId);
  } catch (error) {
    if (error instanceof CrossSiteRequestError) return apiErrorResponse(request, new ApiError(403, "CROSS_SITE_REQUEST", "Request origin is not allowed."));
    return apiErrorResponse(request, error);
  }
}
