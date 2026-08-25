import { apiErrorResponse, ok } from "@/server/http";
import { requireOrganizationPermission } from "@/server/organization/access";
import { listDepartments } from "@/server/organization/repository";
import { parseUuidParam } from "@/server/organization/validation";

export const dynamic = "force-dynamic";
type Context = { params: Promise<{ organizationId: string }> };

export async function GET(request: Request, { params }: Context) {
  try {
    const organizationId = parseUuidParam((await params).organizationId, "organizationId");
    await requireOrganizationPermission(request, organizationId, "organization:read");
    return ok(request, await listDepartments(organizationId));
  } catch (error) {
    return apiErrorResponse(request, error);
  }
}
