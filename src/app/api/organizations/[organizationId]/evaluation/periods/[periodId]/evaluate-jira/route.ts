import { assertTrustedMutationRequest, CrossSiteRequestError } from "@/server/auth/csrf";
import { parseServerEnv } from "@/server/env";
import { evaluatePeriodFromJira } from "@/server/evaluation/repository";
import { jiraEvaluationSchema } from "@/server/evaluation/validation";
import { apiErrorResponse, ApiError, ok, parseJson } from "@/server/http";
import { requireOrganizationPermission } from "@/server/organization/access";
import { parseUuidParam } from "@/server/organization/validation";

export const dynamic = "force-dynamic";
type Context = { params: Promise<{ organizationId: string; periodId: string }> };

export async function POST(request: Request, { params }: Context) {
  try {
    assertTrustedMutationRequest(request, parseServerEnv().APP_URL);
    const route = await params;
    const organizationId = parseUuidParam(route.organizationId, "organizationId");
    const periodId = parseUuidParam(route.periodId, "periodId");
    const { user } = await requireOrganizationPermission(request, organizationId, "evaluation:run");
    const payload = await parseJson(request, jiraEvaluationSchema);
    return ok(request, await evaluatePeriodFromJira({
      organizationId,
      periodId,
      actorUserId: user.id,
      memberIds: payload.memberIds,
    }));
  } catch (error) {
    if (error instanceof CrossSiteRequestError) return apiErrorResponse(request, new ApiError(403, "CROSS_SITE_REQUEST", "Request origin is not allowed."));
    return apiErrorResponse(request, error);
  }
}
