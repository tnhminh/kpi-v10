import { apiErrorResponse, ok } from "@/server/http";
import { listAuditEvents } from "@/server/audit/repository";
import { requireOrganizationPermission } from "@/server/organization/access";
import { parseUuidParam } from "@/server/organization/validation";

export const dynamic = "force-dynamic";
type Context = { params: Promise<{ organizationId: string }> };

export async function GET(request: Request, { params }: Context) {
  try {
    const organizationId = parseUuidParam((await params).organizationId, "organizationId");
    await requireOrganizationPermission(request, organizationId, "audit:read");
    const requested = Number(new URL(request.url).searchParams.get("limit") ?? "100");
    const limit = Number.isInteger(requested) ? requested : 100;
    return ok(request, await listAuditEvents({ organizationId, limit }));
  } catch (error) {
    return apiErrorResponse(request, error);
  }
}
