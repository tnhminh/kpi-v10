import { assertTrustedMutationRequest, CrossSiteRequestError } from "@/server/auth/csrf";
import { parseServerEnv } from "@/server/env";
import { ApiError, apiErrorResponse, ok, parseJson } from "@/server/http";
import { requireOrganizationPermission } from "@/server/organization/access";
import { parseUuidParam } from "@/server/organization/validation";
import { getRequestId } from "@/server/request-context";
import { completeReview } from "@/server/review/repository";
import { completeReviewSchema } from "@/server/review/validation";

export const dynamic = "force-dynamic";
type Context = { params: Promise<{ organizationId: string; evaluationId: string }> };

export async function POST(request: Request, { params }: Context) {
  try {
    assertTrustedMutationRequest(request, parseServerEnv().APP_URL);
    const route = await params;
    const organizationId = parseUuidParam(route.organizationId, "organizationId");
    const evaluationId = parseUuidParam(route.evaluationId, "evaluationId");
    const { user, access } = await requireOrganizationPermission(request, organizationId, "evaluation:team:review");
    const payload = await parseJson(request, completeReviewSchema);
    const requestId = getRequestId(request.headers);
    const result = await completeReview({ organizationId, evaluationId, actorUserId: user.id, actorRole: access.role, requestId, layer: "LEADER", adjustments: payload.adjustments });
    return ok(request, result, 200, requestId);
  } catch (error) {
    if (error instanceof CrossSiteRequestError) return apiErrorResponse(request, new ApiError(403, "CROSS_SITE_REQUEST", "Request origin is not allowed."));
    return apiErrorResponse(request, error);
  }
}
