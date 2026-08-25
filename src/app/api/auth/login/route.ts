import { z } from "zod";
import { apiErrorResponse, ApiError, ok, parseJson } from "@/server/http";
import { parseServerEnv } from "@/server/env";
import { assertTrustedMutationRequest, CrossSiteRequestError } from "@/server/auth/csrf";
import { AuthenticationFailure, loginWithPassword } from "@/server/auth/service";
import { serializeSessionCookie } from "@/server/auth/session";
import { permissionsForRole } from "@/server/auth/rbac";

export const dynamic = "force-dynamic";

const loginSchema = z.object({
  email: z.string().trim().email().max(254),
  password: z.string().min(1).max(256),
});

export async function POST(request: Request) {
  try {
    const env = parseServerEnv();
    assertTrustedMutationRequest(request, env.APP_URL);
    const payload = await parseJson(request, loginSchema);
    const authenticated = await loginWithPassword(payload.email, payload.password);
    const response = ok(request, {
      user: authenticated.user,
      permissions: permissionsForRole(authenticated.user.role),
      expiresAt: authenticated.expiresAt.toISOString(),
    });
    response.headers.append("Set-Cookie", serializeSessionCookie(authenticated.sessionToken, authenticated.expiresAt, env.NODE_ENV === "production"));
    return response;
  } catch (error) {
    if (error instanceof CrossSiteRequestError) return apiErrorResponse(request, new ApiError(403, "CROSS_SITE_REQUEST", "Request origin is not allowed."));
    if (error instanceof AuthenticationFailure) {
      const throttled = error.code === "LOGIN_THROTTLED";
      return apiErrorResponse(request, new ApiError(throttled ? 429 : 401, throttled ? "LOGIN_THROTTLED" : "INVALID_CREDENTIALS", throttled ? "Too many login attempts. Try again later." : "Invalid email or password."));
    }
    return apiErrorResponse(request, error);
  }
}
