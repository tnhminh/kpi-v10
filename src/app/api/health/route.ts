import { NextResponse } from "next/server";
import { getRequestId, requestIdHeaders } from "@/server/request-context";
import { recordApiResponse, serverTimingHeader } from "@/server/observability/metrics";

export const dynamic = "force-dynamic";

export function GET(request: Request) {
  const requestId = getRequestId(request.headers);
  const elapsedMs = recordApiResponse({ request, requestId, status: 200 });
  return NextResponse.json(
    { status: "ok", service: "kpi-performance-studio", timestamp: new Date().toISOString(), requestId },
    {
      headers: {
        ...requestIdHeaders(requestId),
        ...serverTimingHeader(elapsedMs),
        "Cache-Control": "no-store",
      },
    },
  );
}
