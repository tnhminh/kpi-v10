import { ApiError, apiErrorResponse, ok } from "@/server/http";
import { requireOrganizationPermission } from "@/server/organization/access";
import { parseUuidParam } from "@/server/organization/validation";
import { listReviewQueue } from "@/server/review/repository";
import { reviewQueueLayerSchema } from "@/server/review/validation";

export const dynamic = "force-dynamic";
type Context = { params: Promise<{ organizationId: string; periodId: string }> };

export async function GET(request: Request, { params }: Context) {
  try {
    const route = await params;
    const organizationId = parseUuidParam(route.organizationId, "organizationId");
    const periodId = parseUuidParam(route.periodId, "periodId");
    const parsedLayer = reviewQueueLayerSchema.safeParse(new URL(request.url).searchParams.get("layer"));
    if (!parsedLayer.success) throw new ApiError(422, "VALIDATION_ERROR", "Review queue layer must be LEADER or DEPARTMENT_HEAD.");
    const permission = parsedLayer.data === "LEADER" ? "evaluation:team:review" as const : "evaluation:department:review" as const;
    const { user, access } = await requireOrganizationPermission(request, organizationId, permission);
    return ok(request, await listReviewQueue({ organizationId, periodId, actorUserId: user.id, actorRole: access.role, layer: parsedLayer.data }));
  } catch (error) {
    return apiErrorResponse(request, error);
  }
}
