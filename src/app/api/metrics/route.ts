import { renderPrometheusMetrics } from "@/server/observability/metrics";
import { isMetricsRequestAuthorized } from "@/server/observability/metrics-auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export function GET(request: Request) {
  if (!isMetricsRequestAuthorized(request)) {
    return new Response("Unauthorized\n", {
      status: 401,
      headers: {
        "Cache-Control": "no-store",
        "Content-Type": "text/plain; charset=utf-8",
        "WWW-Authenticate": "Bearer",
      },
    });
  }

  return new Response(renderPrometheusMetrics(), {
    status: 200,
    headers: {
      "Cache-Control": "no-store",
      "Content-Type": "text/plain; version=0.0.4; charset=utf-8",
    },
  });
}
