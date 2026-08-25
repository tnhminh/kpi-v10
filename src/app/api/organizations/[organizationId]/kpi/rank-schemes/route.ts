import { apiErrorResponse, ok } from "@/server/http";
import { listRankSchemes } from "@/server/kpi/rank-repository";
import { requireOrganizationPermission } from "@/server/organization/access";
import { parseUuidParam } from "@/server/organization/validation";

export const dynamic = "force-dynamic";
type Context = { params: Promise<{ organizationId: string }> };

export async function GET(request: Request, { params }: Context) {
  try {
    const organizationId = parseUuidParam((await params).organizationId, "organizationId");
    await requireOrganizationPermission(request, organizationId, "kpi:read");
    return ok(request, await listRankSchemes(organizationId));
  } catch (error) {
    return apiErrorResponse(request, error);
  }
}
