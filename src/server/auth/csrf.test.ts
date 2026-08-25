import { describe, expect, it } from "vitest";
import { assertTrustedMutationRequest, CrossSiteRequestError } from "./csrf";

const appUrl = "https://kpi.internal.example";

describe("browser mutation origin guard", () => {
  it("accepts the configured origin", () => {
    const request = new Request(`${appUrl}/api/auth/logout`, { headers: { origin: appUrl, "sec-fetch-site": "same-origin" } });
    expect(() => assertTrustedMutationRequest(request, appUrl)).not.toThrow();
  });

  it("rejects a cross-site browser request", () => {
    const request = new Request(`${appUrl}/api/auth/logout`, { headers: { origin: "https://evil.example", "sec-fetch-site": "cross-site" } });
    expect(() => assertTrustedMutationRequest(request, appUrl)).toThrow(CrossSiteRequestError);
  });

  it("rejects a mismatched origin even when fetch metadata is absent", () => {
    const request = new Request(`${appUrl}/api/auth/logout`, { headers: { origin: "https://other.example" } });
    expect(() => assertTrustedMutationRequest(request, appUrl)).toThrow(CrossSiteRequestError);
  });
});
