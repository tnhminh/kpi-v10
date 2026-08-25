import { apiErrorResponse, ok } from "@/server/http";
import { getKpiVersionDetail } from "@/server/kpi/repository";
import { requireOrganizationPermission } from "@/server/organization/access";
import { parseUuidParam } from "@/server/organization/validation";

export const dynamic = "force-dynamic";
type Context = { params: Promise<{ organizationId: string; versionId: string }> };

export async function GET(request: Request, { params }: Context) {
  try {
    const route = await params;
    const organizationId = parseUuidParam(route.organizationId, "organizationId");
    const versionId = parseUuidParam(route.versionId, "versionId");
    await requireOrganizationPermission(request, organizationId, "kpi:read");
    return ok(request, await getKpiVersionDetail(organizationId, versionId));
  } catch (error) {
    return apiErrorResponse(request, error);
  }
}
