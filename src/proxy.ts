import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

const REQUEST_ID_HEADER = "x-request-id";
const REQUEST_START_HEADER = "x-kpi-request-start-ms";

function requestId(request: NextRequest): string {
  const incoming = request.headers.get(REQUEST_ID_HEADER)?.trim();
  return incoming && incoming.length <= 128 ? incoming : randomUUID();
}

export function proxy(request: NextRequest) {
  const id = requestId(request);
  const headers = new Headers(request.headers);
  headers.set(REQUEST_ID_HEADER, id);
  headers.set(REQUEST_START_HEADER, String(Date.now()));

  const response = NextResponse.next({ request: { headers } });
  response.headers.set(REQUEST_ID_HEADER, id);
  return response;
}

export const config = {
  matcher: "/api/:path*",
};
