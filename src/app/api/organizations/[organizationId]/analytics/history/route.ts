import { getHistoricalAnalytics } from "@/server/analytics/repository";
import { apiErrorResponse, ok } from "@/server/http";
import { requireOrganizationPermission } from "@/server/organization/access";
import { parseUuidParam } from "@/server/organization/validation";

export const dynamic = "force-dynamic";
type Context = { params: Promise<{ organizationId: string }> };

export async function GET(request: Request, { params }: Context) {
  try {
    const organizationId = parseUuidParam((await params).organizationId, "organizationId");
    const { user, access } = await requireOrganizationPermission(request, organizationId, "evaluation:self:read");
    return ok(request, await getHistoricalAnalytics({ organizationId, actorUserId: user.id, actorRole: access.role }));
  } catch (error) {
    return apiErrorResponse(request, error);
  }
}
