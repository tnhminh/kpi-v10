import { NextResponse } from "next/server";
import { z, type ZodType } from "zod";
import { getRequestId, requestIdHeaders } from "./request-context";
import { logger } from "./logger";
import { recordApiResponse, serverTimingHeader } from "./observability/metrics";

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
  }
}

export async function parseJson<T>(request: Request, schema: ZodType<T>): Promise<T> {
  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    throw new ApiError(400, "INVALID_JSON", "Request body must be valid JSON.");
  }

  const parsed = schema.safeParse(payload);
  if (!parsed.success) {
    throw new ApiError(422, "VALIDATION_ERROR", "Request validation failed.", z.flattenError(parsed.error));
  }
  return parsed.data;
}

export function ok<T>(request: Request, data: T, status = 200, requestIdOverride?: string) {
  const requestId = requestIdOverride ?? getRequestId(request.headers);
  const elapsedMs = recordApiResponse({ request, requestId, status });
  return NextResponse.json(
    { data, requestId },
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

export function apiErrorResponse(request: Request, error: unknown) {
  const requestId = getRequestId(request.headers);
  if (error instanceof ApiError) {
    logger.warn("api_request_failed", { requestId, code: error.code, status: error.status });
    const elapsedMs = recordApiResponse({ request, requestId, status: error.status, code: error.code });
    return NextResponse.json(
      { error: { code: error.code, message: error.message, details: error.details }, requestId },
      {
        status: error.status,
        headers: {
          ...requestIdHeaders(requestId),
          ...serverTimingHeader(elapsedMs),
          "Cache-Control": "no-store",
        },
      },
    );
  }

  logger.error("api_request_failed", {
    requestId,
    code: "INTERNAL_ERROR",
    error: error instanceof Error ? error.message : "unknown_error",
  });
  const elapsedMs = recordApiResponse({ request, requestId, status: 500, code: "INTERNAL_ERROR" });
  return NextResponse.json(
    { error: { code: "INTERNAL_ERROR", message: "An unexpected error occurred." }, requestId },
    {
      status: 500,
      headers: {
        ...requestIdHeaders(requestId),
        ...serverTimingHeader(elapsedMs),
        "Cache-Control": "no-store",
      },
    },
  );
}
