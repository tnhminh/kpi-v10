import { apiErrorResponse, ok } from "@/server/http";
import { listJiraSyncRuns } from "@/server/jira/repository";
import { requireOrganizationPermission } from "@/server/organization/access";
import { parseUuidParam } from "@/server/organization/validation";

export const dynamic = "force-dynamic";
type Context = { params: Promise<{ organizationId: string; connectionId: string }> };

export async function GET(request: Request, { params }: Context) {
  try {
    const route = await params;
    const organizationId = parseUuidParam(route.organizationId, "organizationId");
    const connectionId = parseUuidParam(route.connectionId, "connectionId");
    await requireOrganizationPermission(request, organizationId, "integration:manage");
    return ok(request, await listJiraSyncRuns(organizationId, connectionId));
  } catch (error) {
    return apiErrorResponse(request, error);
  }
}
