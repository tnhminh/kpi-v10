import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  normalizeMetricPath,
  recordApiResponse,
  recordFrameworkRequestError,
  recordReadiness,
  renderPrometheusMetrics,
  REQUEST_START_HEADER,
  resetMetricsForTest,
} from "./metrics";
import { isMetricsRequestAuthorized } from "./metrics-auth";

beforeEach(() => {
  resetMetricsForTest();
  vi.stubEnv("LOG_LEVEL", "error");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("observability metrics", () => {
  it("normalizes dynamic identifiers to bounded-cardinality route labels", () => {
    expect(normalizeMetricPath("/api/organizations/0bc35883-0229-4895-92dc-223a2313676c/members/42?view=full")).toBe(
      "/api/organizations/:id/members/:number",
    );
  });

  it("records request counts, duration histograms, stable errors and readiness", () => {
    const request = new Request("http://localhost/api/organizations/0bc35883-0229-4895-92dc-223a2313676c/teams", {
      method: "GET",
      headers: { [REQUEST_START_HEADER]: String(Date.now() - 50) },
    });
    recordApiResponse({ request, requestId: "req-success", status: 200, logCompletion: false });

    const throttled = new Request("http://localhost/api/auth/login", {
      method: "POST",
      headers: { [REQUEST_START_HEADER]: String(Date.now() - 10) },
    });
    recordApiResponse({ request: throttled, requestId: "req-throttled", status: 429, code: "LOGIN_THROTTLED", logCompletion: false });
    recordReadiness("ready");
    recordFrameworkRequestError("/api/organizations/0bc35883-0229-4895-92dc-223a2313676c/teams", "route");

    const output = renderPrometheusMetrics();
    expect(output).toContain('kpi_http_requests_total{method="GET",route="/api/organizations/:id/teams",status="200"} 1');
    expect(output).toContain('kpi_http_request_duration_seconds_count{method="GET",route="/api/organizations/:id/teams"} 1');
    expect(output).toContain('kpi_http_errors_total{code="LOGIN_THROTTLED",status="429"} 1');
    expect(output).toContain("kpi_auth_login_throttled_total 1");
    expect(output).toContain("kpi_readiness_status 1");
    expect(output).toContain('kpi_readiness_checks_total{result="ready"} 1');
    expect(output).toContain('kpi_framework_request_errors_total{route="/api/organizations/:id/teams",route_type="route"} 1');
  });

  it("allows open local scraping but requires a timing-safe bearer token when configured", () => {
    vi.stubEnv("NODE_ENV", "development");
    expect(isMetricsRequestAuthorized(new Request("http://localhost/api/metrics"), undefined)).toBe(true);

    vi.stubEnv("NODE_ENV", "production");
    expect(isMetricsRequestAuthorized(new Request("http://localhost/api/metrics"), undefined)).toBe(false);

    const token = "metrics-token-value-that-is-at-least-32-characters";
    expect(isMetricsRequestAuthorized(new Request("http://localhost/api/metrics", {
      headers: { authorization: `Bearer ${token}` },
    }), token)).toBe(true);
    expect(isMetricsRequestAuthorized(new Request("http://localhost/api/metrics", {
      headers: { authorization: "Bearer wrong" },
    }), token)).toBe(false);
  });
});
