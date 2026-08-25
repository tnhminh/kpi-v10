import type { Instrumentation } from "next";
import { logger } from "@/server/logger";
import { normalizeMetricPath, recordFrameworkRequestError } from "@/server/observability/metrics";

export function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    logger.info("server_instance_started", {
      runtime: "nodejs",
      nodeVersion: process.version,
      environment: process.env.NODE_ENV ?? "unknown",
    });
  }
}

export const onRequestError: Instrumentation.onRequestError = async (error, request, context) => {
  const pathname = request.path.split("?")[0] || "/";
  const message = error instanceof Error ? error.message : "unknown_server_error";
  const digest = typeof error === "object" && error !== null && "digest" in error ? String(error.digest) : null;
  recordFrameworkRequestError(pathname, context.routeType);
  logger.error("server_request_uncaught_error", {
    method: request.method,
    route: normalizeMetricPath(pathname),
    routePath: context.routePath,
    routeType: context.routeType,
    routerKind: context.routerKind,
    digest,
    error: message,
  });
};
