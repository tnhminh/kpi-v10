import { assertTrustedMutationRequest, CrossSiteRequestError } from "@/server/auth/csrf";
import { parseServerEnv } from "@/server/env";
import { ApiError, apiErrorResponse, ok, parseJson } from "@/server/http";
import { requireOrganizationPermission } from "@/server/organization/access";
import { parseUuidParam } from "@/server/organization/validation";
import { getRequestId } from "@/server/request-context";
import { resolveQualityIssue } from "@/server/review/repository";
import { qualityResolutionSchema } from "@/server/review/validation";

export const dynamic = "force-dynamic";
type Context = { params: Promise<{ organizationId: string; issueId: string }> };

export async function POST(request: Request, { params }: Context) {
  try {
    assertTrustedMutationRequest(request, parseServerEnv().APP_URL);
    const route = await params;
    const organizationId = parseUuidParam(route.organizationId, "organizationId");
    const issueId = parseUuidParam(route.issueId, "issueId");
    const { user, access } = await requireOrganizationPermission(request, organizationId, "evaluation:department:review");
    const payload = await parseJson(request, qualityResolutionSchema);
    const requestId = getRequestId(request.headers);
    const result = await resolveQualityIssue({ organizationId, issueId, actorUserId: user.id, actorRole: access.role, requestId, ...payload });
    return ok(request, result, 200, requestId);
  } catch (error) {
    if (error instanceof CrossSiteRequestError) return apiErrorResponse(request, new ApiError(403, "CROSS_SITE_REQUEST", "Request origin is not allowed."));
    return apiErrorResponse(request, error);
  }
}
