import { apiErrorResponse, ApiError, ok } from "@/server/http";
import { parseServerEnv } from "@/server/env";
import { assertTrustedMutationRequest, CrossSiteRequestError } from "@/server/auth/csrf";
import { revokeRequestSession } from "@/server/auth/service";
import { clearSessionCookie } from "@/server/auth/session";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const env = parseServerEnv();
    assertTrustedMutationRequest(request, env.APP_URL);
    await revokeRequestSession(request);
    const response = ok(request, { loggedOut: true });
    response.headers.append("Set-Cookie", clearSessionCookie(env.NODE_ENV === "production"));
    return response;
  } catch (error) {
    if (error instanceof CrossSiteRequestError) return apiErrorResponse(request, new ApiError(403, "CROSS_SITE_REQUEST", "Request origin is not allowed."));
    return apiErrorResponse(request, error);
  }
}
