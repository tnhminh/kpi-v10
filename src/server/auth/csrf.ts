export class CrossSiteRequestError extends Error {}

export function assertTrustedMutationRequest(request: Request, appUrl: string): void {
  const fetchSite = request.headers.get("sec-fetch-site");
  if (fetchSite === "cross-site") throw new CrossSiteRequestError("Cross-site mutation request rejected.");

  const origin = request.headers.get("origin");
  if (!origin) return;

  let expectedOrigin: string;
  let actualOrigin: string;
  try {
    expectedOrigin = new URL(appUrl).origin;
    actualOrigin = new URL(origin).origin;
  } catch {
    throw new CrossSiteRequestError("Invalid request origin.");
  }
  if (actualOrigin !== expectedOrigin) throw new CrossSiteRequestError("Request origin is not trusted.");
}
