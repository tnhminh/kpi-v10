import { apiErrorResponse, ApiError, ok, parseJson } from "@/server/http";
import { parseServerEnv } from "@/server/env";
import { assertTrustedMutationRequest, CrossSiteRequestError } from "@/server/auth/csrf";
import { requireOrganizationPermission } from "@/server/organization/access";
import { assignMemberToTeam, listMemberMemberships } from "@/server/organization/repository";
import { createMembershipSchema, parseUuidParam } from "@/server/organization/validation";
import { getRequestId } from "@/server/request-context";

export const dynamic = "force-dynamic";
type Context = { params: Promise<{ organizationId: string; memberId: string }> };

export async function GET(request: Request, { params }: Context) {
  try {
    const routeParams = await params;
    const organizationId = parseUuidParam(routeParams.organizationId, "organizationId");
    const memberId = parseUuidParam(routeParams.memberId, "memberId");
    await requireOrganizationPermission(request, organizationId, "organization:read");
    return ok(request, await listMemberMemberships(organizationId, memberId));
  } catch (error) {
    return apiErrorResponse(request, error);
  }
}

export async function POST(request: Request, { params }: Context) {
  try {
    const env = parseServerEnv();
    assertTrustedMutationRequest(request, env.APP_URL);
    const routeParams = await params;
    const organizationId = parseUuidParam(routeParams.organizationId, "organizationId");
    const memberId = parseUuidParam(routeParams.memberId, "memberId");
    const { user } = await requireOrganizationPermission(request, organizationId, "organization:manage");
    const payload = await parseJson(request, createMembershipSchema);
    const requestId = getRequestId(request.headers);
    const created = await assignMemberToTeam({ organizationId, memberId, actorUserId: user.id, requestId, ...payload });
    return ok(request, created, 201, requestId);
  } catch (error) {
    if (error instanceof CrossSiteRequestError) return apiErrorResponse(request, new ApiError(403, "CROSS_SITE_REQUEST", "Request origin is not allowed."));
    return apiErrorResponse(request, error);
  }
}
