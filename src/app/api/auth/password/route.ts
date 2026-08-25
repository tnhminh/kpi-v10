import { z } from "zod";
import { assertTrustedMutationRequest, CrossSiteRequestError } from "@/server/auth/csrf";
import { PasswordChangeFailure, changeRequestPassword } from "@/server/auth/service";
import { parseServerEnv } from "@/server/env";
import { ApiError, apiErrorResponse, ok, parseJson } from "@/server/http";

export const dynamic = "force-dynamic";

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1).max(256),
  newPassword: z.string().min(12).max(256),
});

export async function POST(request: Request) {
  try {
    const env = parseServerEnv();
    assertTrustedMutationRequest(request, env.APP_URL);
    const payload = await parseJson(request, changePasswordSchema);
    await changeRequestPassword(request, payload.currentPassword, payload.newPassword);
    return ok(request, { changed: true });
  } catch (error) {
    if (error instanceof CrossSiteRequestError) return apiErrorResponse(request, new ApiError(403, "CROSS_SITE_REQUEST", "Request origin is not allowed."));
    if (error instanceof PasswordChangeFailure) {
      return apiErrorResponse(request, new ApiError(error.code === "PASSWORD_REUSE" ? 422 : 401, error.code, error.message));
    }
    return apiErrorResponse(request, error);
  }
}
