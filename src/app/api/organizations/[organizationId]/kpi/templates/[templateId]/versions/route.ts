import { assertTrustedMutationRequest, CrossSiteRequestError } from "@/server/auth/csrf";
import { parseServerEnv } from "@/server/env";
import { apiErrorResponse, ApiError, ok, parseJson } from "@/server/http";
import { createKpiVersion, listKpiVersions } from "@/server/kpi/repository";
import { createVersionSchema } from "@/server/kpi/validation";
import { requireOrganizationPermission } from "@/server/organization/access";
import { parseUuidParam } from "@/server/organization/validation";
import { getRequestId } from "@/server/request-context";

export const dynamic = "force-dynamic";
type Context = { params: Promise<{ organizationId: string; templateId: string }> };

export async function GET(request: Request, { params }: Context) {
  try {
    const route = await params;
    const organizationId = parseUuidParam(route.organizationId, "organizationId");
    const templateId = parseUuidParam(route.templateId, "templateId");
    await requireOrganizationPermission(request, organizationId, "kpi:read");
    return ok(request, await listKpiVersions(organizationId, templateId));
  } catch (error) {
    return apiErrorResponse(request, error);
  }
}

export async function POST(request: Request, { params }: Context) {
  try {
    assertTrustedMutationRequest(request, parseServerEnv().APP_URL);
    const route = await params;
    const organizationId = parseUuidParam(route.organizationId, "organizationId");
    const templateId = parseUuidParam(route.templateId, "templateId");
    const { user } = await requireOrganizationPermission(request, organizationId, "kpi:manage");
    const payload = await parseJson(request, createVersionSchema);
    const requestId = getRequestId(request.headers);
    return ok(request, await createKpiVersion({ organizationId, templateId, actorUserId: user.id, requestId, ...payload }), 201, requestId);
  } catch (error) {
    if (error instanceof CrossSiteRequestError) return apiErrorResponse(request, new ApiError(403, "CROSS_SITE_REQUEST", "Request origin is not allowed."));
    return apiErrorResponse(request, error);
  }
}
