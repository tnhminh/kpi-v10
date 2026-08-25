import { timingSafeEqual } from "node:crypto";

export function isMetricsRequestAuthorized(request: Request, configuredToken = process.env.METRICS_TOKEN): boolean {
  if (!configuredToken) return process.env.NODE_ENV !== "production";
  const header = request.headers.get("authorization");
  if (!header?.startsWith("Bearer ")) return false;
  const supplied = header.slice("Bearer ".length);
  const expectedBuffer = Buffer.from(configuredToken);
  const suppliedBuffer = Buffer.from(supplied);
  if (suppliedBuffer.length !== expectedBuffer.length) return false;
  return timingSafeEqual(suppliedBuffer, expectedBuffer);
}
