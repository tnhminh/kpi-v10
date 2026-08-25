import { NextResponse } from "next/server";
import { isServerEnvReady } from "@/server/env";
import { checkDatabase } from "@/server/db/client";
import { getRequestId, requestIdHeaders } from "@/server/request-context";
import { recordApiResponse, recordReadiness, serverTimingHeader } from "@/server/observability/metrics";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const requestId = getRequestId(request.headers);

  if (!isServerEnvReady()) {
    recordReadiness("configuration_invalid");
    const elapsedMs = recordApiResponse({ request, requestId, status: 503, code: "CONFIGURATION_NOT_READY" });
    return NextResponse.json(
      {
        status: "not_ready",
        checks: { configuration: "invalid", database: "skipped" },
        timestamp: new Date().toISOString(),
        requestId,
      },
      {
        status: 503,
        headers: {
          ...requestIdHeaders(requestId),
          ...serverTimingHeader(elapsedMs),
          "Cache-Control": "no-store",
        },
      },
    );
  }

  const database = await checkDatabase();
  const status = database ? 200 : 503;
  const code = database ? undefined : "DATABASE_UNAVAILABLE";
  recordReadiness(database ? "ready" : "database_unavailable");
  const elapsedMs = recordApiResponse({ request, requestId, status, code });

  return NextResponse.json(
    {
      status: database ? "ready" : "not_ready",
      checks: { configuration: "ok", database: database ? "ok" : "unavailable" },
      timestamp: new Date().toISOString(),
      requestId,
    },
    {
      status,
      headers: {
        ...requestIdHeaders(requestId),
        ...serverTimingHeader(elapsedMs),
        "Cache-Control": "no-store",
      },
    },
  );
}
