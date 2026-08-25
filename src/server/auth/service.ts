import { parseServerEnv } from "@/server/env";
import { getRequestId } from "@/server/request-context";
import { DUMMY_PASSWORD_HASH, hashPassword, verifyPassword } from "./password";
import {
  generateSessionToken,
  hashSessionToken,
  loginThrottleKey,
  normalizeEmail,
  parseSessionToken,
  sessionExpiry,
} from "./session";
import {
  changePasswordAndRevokeOtherSessions,
  clearLoginFailures,
  findUserForLogin,
  isLoginBlocked,
  persistSession,
  recordLoginFailure,
  resolveSession,
  revokeSession,
} from "./repository";
import type { AuthenticatedUser } from "./types";

export type AuthenticationFailureCode = "INVALID_CREDENTIALS" | "LOGIN_THROTTLED";

export class AuthenticationFailure extends Error {
  constructor(public readonly code: AuthenticationFailureCode) {
    super(code === "LOGIN_THROTTLED" ? "Too many login attempts." : "Invalid email or password.");
  }
}

export async function loginWithPassword(email: string, password: string): Promise<{
  user: AuthenticatedUser;
  sessionToken: string;
  expiresAt: Date;
}> {
  const env = parseServerEnv();
  const normalizedEmail = normalizeEmail(email);
  const throttleKey = loginThrottleKey(normalizedEmail, env.AUTH_SECRET);

  if (await isLoginBlocked(throttleKey)) throw new AuthenticationFailure("LOGIN_THROTTLED");

  const user = await findUserForLogin(normalizedEmail);
  const passwordMatches = await verifyPassword(password, user?.passwordHash ?? DUMMY_PASSWORD_HASH);
  if (!user || !user.active || !user.passwordHash || !passwordMatches) {
    await recordLoginFailure(throttleKey);
    throw new AuthenticationFailure("INVALID_CREDENTIALS");
  }

  await clearLoginFailures(throttleKey);
  const sessionToken = generateSessionToken();
  const expiresAt = sessionExpiry();
  await persistSession({ userId: user.id, tokenHash: hashSessionToken(sessionToken, env.AUTH_SECRET), expiresAt });

  return {
    user: { id: user.id, email: user.email, displayName: user.displayName, role: user.role, passwordChangeRequired: user.passwordChangeRequired },
    sessionToken,
    expiresAt,
  };
}

export async function resolveRequestSession(request: Request): Promise<AuthenticatedUser | null> {
  const token = parseSessionToken(request.headers.get("cookie"));
  if (!token) return null;
  const env = parseServerEnv();
  return resolveSession(hashSessionToken(token, env.AUTH_SECRET));
}

export class PasswordChangeFailure extends Error {
  constructor(public readonly code: "CURRENT_PASSWORD_INVALID" | "PASSWORD_REUSE") {
    super(code === "PASSWORD_REUSE" ? "New password must be different from the current password." : "Current password is invalid.");
  }
}

export async function changeRequestPassword(request: Request, currentPassword: string, newPassword: string): Promise<void> {
  const token = parseSessionToken(request.headers.get("cookie"));
  if (!token) throw new PasswordChangeFailure("CURRENT_PASSWORD_INVALID");
  const env = parseServerEnv();
  const tokenHash = hashSessionToken(token, env.AUTH_SECRET);
  const user = await resolveSession(tokenHash);
  if (!user) throw new PasswordChangeFailure("CURRENT_PASSWORD_INVALID");
  const loginUser = await findUserForLogin(normalizeEmail(user.email));
  if (!loginUser?.passwordHash || !(await verifyPassword(currentPassword, loginUser.passwordHash))) {
    throw new PasswordChangeFailure("CURRENT_PASSWORD_INVALID");
  }
  if (await verifyPassword(newPassword, loginUser.passwordHash)) throw new PasswordChangeFailure("PASSWORD_REUSE");
  const passwordHash = await hashPassword(newPassword);
  await changePasswordAndRevokeOtherSessions({ userId: user.id, passwordHash, currentTokenHash: tokenHash, requestId: getRequestId(request.headers) });
}

export async function revokeRequestSession(request: Request): Promise<void> {
  const token = parseSessionToken(request.headers.get("cookie"));
  if (!token) return;
  const env = parseServerEnv();
  await revokeSession(hashSessionToken(token, env.AUTH_SECRET));
}
