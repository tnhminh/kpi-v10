import { listPeriodEvaluations } from "@/server/evaluation/repository";
import { apiErrorResponse, ok } from "@/server/http";
import { requireOrganizationPermission } from "@/server/organization/access";
import { parseUuidParam } from "@/server/organization/validation";

export const dynamic = "force-dynamic";
type Context = { params: Promise<{ organizationId: string; periodId: string }> };

export async function GET(request: Request, { params }: Context) {
  try {
    const route = await params;
    const organizationId = parseUuidParam(route.organizationId, "organizationId");
    const periodId = parseUuidParam(route.periodId, "periodId");
    await requireOrganizationPermission(request, organizationId, "evaluation:run");
    return ok(request, await listPeriodEvaluations(organizationId, periodId));
  } catch (error) {
    return apiErrorResponse(request, error);
  }
}
