import { apiErrorResponse, ApiError, ok, parseJson } from "@/server/http";
import { parseServerEnv } from "@/server/env";
import { assertTrustedMutationRequest, CrossSiteRequestError } from "@/server/auth/csrf";
import { requireOrganizationPermission } from "@/server/organization/access";
import { createKpiTemplate, listKpiTemplates } from "@/server/organization/repository";
import { createKpiTemplateSchema, parseUuidParam } from "@/server/organization/validation";
import { getRequestId } from "@/server/request-context";

export const dynamic = "force-dynamic";
type Context = { params: Promise<{ organizationId: string }> };

export async function GET(request: Request, { params }: Context) {
  try {
    const organizationId = parseUuidParam((await params).organizationId, "organizationId");
    await requireOrganizationPermission(request, organizationId, "kpi:read");
    return ok(request, await listKpiTemplates(organizationId));
  } catch (error) {
    return apiErrorResponse(request, error);
  }
}

export async function POST(request: Request, { params }: Context) {
  try {
    const env = parseServerEnv();
    assertTrustedMutationRequest(request, env.APP_URL);
    const organizationId = parseUuidParam((await params).organizationId, "organizationId");
    const { user } = await requireOrganizationPermission(request, organizationId, "kpi:manage");
    const payload = await parseJson(request, createKpiTemplateSchema);
    const requestId = getRequestId(request.headers);
    const created = await createKpiTemplate({ organizationId, actorUserId: user.id, requestId, ...payload });
    return ok(request, created, 201, requestId);
  } catch (error) {
    if (error instanceof CrossSiteRequestError) return apiErrorResponse(request, new ApiError(403, "CROSS_SITE_REQUEST", "Request origin is not allowed."));
    return apiErrorResponse(request, error);
  }
}
