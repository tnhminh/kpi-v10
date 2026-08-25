import { assertTrustedMutationRequest, CrossSiteRequestError } from "@/server/auth/csrf";
import { parseServerEnv } from "@/server/env";
import { listPeriodAssignments, replacePeriodAssignments } from "@/server/evaluation/repository";
import { replacePeriodAssignmentsSchema } from "@/server/evaluation/validation";
import { apiErrorResponse, ApiError, ok, parseJson } from "@/server/http";
import { requireOrganizationPermission } from "@/server/organization/access";
import { parseUuidParam } from "@/server/organization/validation";
import { getRequestId } from "@/server/request-context";

export const dynamic = "force-dynamic";
type Context = { params: Promise<{ organizationId: string; periodId: string }> };

export async function GET(request: Request, { params }: Context) {
  try {
    const route = await params;
    const organizationId = parseUuidParam(route.organizationId, "organizationId");
    const periodId = parseUuidParam(route.periodId, "periodId");
    await requireOrganizationPermission(request, organizationId, "evaluation:run");
    return ok(request, await listPeriodAssignments(organizationId, periodId));
  } catch (error) {
    return apiErrorResponse(request, error);
  }
}

export async function PUT(request: Request, { params }: Context) {
  try {
    assertTrustedMutationRequest(request, parseServerEnv().APP_URL);
    const route = await params;
    const organizationId = parseUuidParam(route.organizationId, "organizationId");
    const periodId = parseUuidParam(route.periodId, "periodId");
    const { user } = await requireOrganizationPermission(request, organizationId, "organization:manage");
    const payload = await parseJson(request, replacePeriodAssignmentsSchema);
    const requestId = getRequestId(request.headers);
    const result = await replacePeriodAssignments({ organizationId, periodId, actorUserId: user.id, requestId, assignments: payload.assignments });
    return ok(request, result, 200, requestId);
  } catch (error) {
    if (error instanceof CrossSiteRequestError) return apiErrorResponse(request, new ApiError(403, "CROSS_SITE_REQUEST", "Request origin is not allowed."));
    return apiErrorResponse(request, error);
  }
}
