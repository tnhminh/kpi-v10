import { assertTrustedMutationRequest, CrossSiteRequestError } from "@/server/auth/csrf";
import { parseServerEnv } from "@/server/env";
import { apiErrorResponse, ApiError, ok, parseJson } from "@/server/http";
import { createJiraConnection, listJiraConnections } from "@/server/jira/repository";
import { createJiraConnectionSchema } from "@/server/jira/validation";
import { requireOrganizationPermission } from "@/server/organization/access";
import { parseUuidParam } from "@/server/organization/validation";
import { getRequestId } from "@/server/request-context";

export const dynamic = "force-dynamic";
type Context = { params: Promise<{ organizationId: string }> };

export async function GET(request: Request, { params }: Context) {
  try {
    const organizationId = parseUuidParam((await params).organizationId, "organizationId");
    await requireOrganizationPermission(request, organizationId, "integration:manage");
    return ok(request, await listJiraConnections(organizationId));
  } catch (error) {
    return apiErrorResponse(request, error);
  }
}

export async function POST(request: Request, { params }: Context) {
  try {
    assertTrustedMutationRequest(request, parseServerEnv().APP_URL);
    const organizationId = parseUuidParam((await params).organizationId, "organizationId");
    const { user } = await requireOrganizationPermission(request, organizationId, "integration:manage");
    const payload = await parseJson(request, createJiraConnectionSchema);
    const requestId = getRequestId(request.headers);
    const created = await createJiraConnection({ organizationId, actorUserId: user.id, requestId, ...payload });
    return ok(request, created, 201, requestId);
  } catch (error) {
    if (error instanceof CrossSiteRequestError) return apiErrorResponse(request, new ApiError(403, "CROSS_SITE_REQUEST", "Request origin is not allowed."));
    return apiErrorResponse(request, error);
  }
}
