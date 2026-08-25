import { apiErrorResponse, ok } from "@/server/http";
import { currentIdentity } from "@/server/auth/authorization";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    return ok(request, await currentIdentity(request));
  } catch (error) {
    return apiErrorResponse(request, error);
  }
}
