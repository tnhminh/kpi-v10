import { assertTrustedMutationRequest, CrossSiteRequestError } from "@/server/auth/csrf";
import { parseServerEnv } from "@/server/env";
import { apiErrorResponse, ApiError, ok, parseJson } from "@/server/http";
import { addCriterion } from "@/server/kpi/repository";
import { criterionInputSchema } from "@/server/kpi/validation";
import { requireOrganizationPermission } from "@/server/organization/access";
import { parseUuidParam } from "@/server/organization/validation";
import { getRequestId } from "@/server/request-context";

export const dynamic = "force-dynamic";
type Context = { params: Promise<{ organizationId: string; versionId: string }> };

export async function POST(request: Request, { params }: Context) {
  try {
    assertTrustedMutationRequest(request, parseServerEnv().APP_URL);
    const route = await params;
    const organizationId = parseUuidParam(route.organizationId, "organizationId");
    const versionId = parseUuidParam(route.versionId, "versionId");
    const { user } = await requireOrganizationPermission(request, organizationId, "kpi:manage");
    const payload = await parseJson(request, criterionInputSchema);
    const requestId = getRequestId(request.headers);
    return ok(request, await addCriterion({ organizationId, versionId, actorUserId: user.id, requestId, ...payload }), 201, requestId);
  } catch (error) {
    if (error instanceof CrossSiteRequestError) return apiErrorResponse(request, new ApiError(403, "CROSS_SITE_REQUEST", "Request origin is not allowed."));
    return apiErrorResponse(request, error);
  }
}
