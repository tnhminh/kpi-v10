const baseUrl = (process.env.APP_URL || "http://127.0.0.1:3712").replace(/\/$/, "");

async function get(path, init) {
  return fetch(`${baseUrl}${path}`, { cache: "no-store", ...init });
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const health = await get("/api/health");
assert(health.status === 200, `Expected /api/health 200, got ${health.status}`);
assert(Boolean(health.headers.get("x-request-id")), "Health response is missing x-request-id.");
assert(Boolean(health.headers.get("server-timing")), "Health response is missing Server-Timing.");

const ready = await get("/api/ready");
assert(ready.status === 200, `Expected /api/ready 200, got ${ready.status}`);
assert(Boolean(ready.headers.get("x-request-id")), "Readiness response is missing x-request-id.");
assert(Boolean(ready.headers.get("server-timing")), "Readiness response is missing Server-Timing.");

const unauthenticated = await get("/api/auth/me");
assert(unauthenticated.status === 401, `Expected unauthenticated /api/auth/me 401, got ${unauthenticated.status}`);

const metrics = await get("/api/metrics");
assert(metrics.status === 200, `Expected local /api/metrics 200, got ${metrics.status}`);
const body = await metrics.text();

for (const expected of [
  "# TYPE kpi_http_requests_total counter",
  "# TYPE kpi_http_request_duration_seconds histogram",
  "# TYPE kpi_http_errors_total counter",
  "# TYPE kpi_readiness_status gauge",
  "kpi_readiness_status 1",
  'kpi_http_errors_total{code="UNAUTHENTICATED",status="401"}',
  'route="/api/auth/me"',
]) {
  assert(body.includes(expected), `Metrics output is missing expected signal: ${expected}`);
}

console.log(JSON.stringify({
  status: "ok",
  baseUrl,
  health: {
    status: health.status,
    requestId: Boolean(health.headers.get("x-request-id")),
    serverTiming: health.headers.get("server-timing"),
  },
  readiness: {
    status: ready.status,
    requestId: Boolean(ready.headers.get("x-request-id")),
    serverTiming: ready.headers.get("server-timing"),
  },
  unauthenticatedProbe: unauthenticated.status,
  metrics: {
    status: metrics.status,
    requestCounter: body.includes("kpi_http_requests_total"),
    durationHistogram: body.includes("kpi_http_request_duration_seconds"),
    errorCounter: body.includes('kpi_http_errors_total{code="UNAUTHENTICATED",status="401"}'),
    readinessGauge: body.includes("kpi_readiness_status 1"),
  },
}, null, 2));
