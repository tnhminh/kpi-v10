import { randomUUID } from "node:crypto";

const REQUEST_ID_HEADER = "x-request-id";

export function getRequestId(headers: Headers): string {
  const incoming = headers.get(REQUEST_ID_HEADER)?.trim();
  return incoming && incoming.length <= 128 ? incoming : randomUUID();
}

export function requestIdHeaders(requestId: string): HeadersInit {
  return { [REQUEST_ID_HEADER]: requestId };
}
