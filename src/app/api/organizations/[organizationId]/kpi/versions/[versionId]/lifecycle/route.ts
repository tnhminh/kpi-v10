import { assertTrustedMutationRequest, CrossSiteRequestError } from "@/server/auth/csrf";
import { parseServerEnv } from "@/server/env";
import { apiErrorResponse, ApiError, ok, parseJson } from "@/server/http";
import { transitionKpiVersion } from "@/server/kpi/repository";
import { lifecycleActionSchema } from "@/server/kpi/validation";
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
    const payload = await parseJson(request, lifecycleActionSchema);
    const permission = payload.action === "APPROVE" ? "kpi:approve" : "kpi:manage";
    const { user } = await requireOrganizationPermission(request, organizationId, permission);
    const requestId = getRequestId(request.headers);
    const result = await transitionKpiVersion({ organizationId, versionId, actorUserId: user.id, requestId, action: payload.action });
    return ok(request, result, 200, requestId);
  } catch (error) {
    if (error instanceof CrossSiteRequestError) return apiErrorResponse(request, new ApiError(403, "CROSS_SITE_REQUEST", "Request origin is not allowed."));
    return apiErrorResponse(request, error);
  }
}
