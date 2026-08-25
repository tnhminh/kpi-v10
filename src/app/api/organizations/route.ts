import { apiErrorResponse, ok } from "@/server/http";
import { requireAuthenticated } from "@/server/auth/authorization";
import { listAccessibleOrganizations } from "@/server/organization/access";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const user = await requireAuthenticated(request);
    return ok(request, await listAccessibleOrganizations(user.id));
  } catch (error) {
    return apiErrorResponse(request, error);
  }
}
