import { logger } from "@/server/logger";

export const REQUEST_START_HEADER = "x-kpi-request-start-ms";

const DURATION_BUCKETS_SECONDS = [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10] as const;
const UUID_SEGMENT = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type Histogram = {
  count: number;
  sumSeconds: number;
  buckets: number[];
};

type MetricsState = {
  startedAtSeconds: number;
  requests: Map<string, number>;
  durations: Map<string, Histogram>;
  errors: Map<string, number>;
  frameworkErrors: Map<string, number>;
  readinessChecks: Map<string, number>;
  readinessStatus: number;
  authLoginThrottled: number;
};

type GlobalWithMetrics = typeof globalThis & { __kpiMetricsState?: MetricsState };

function createState(): MetricsState {
  return {
    startedAtSeconds: Date.now() / 1000,
    requests: new Map(),
    durations: new Map(),
    errors: new Map(),
    frameworkErrors: new Map(),
    readinessChecks: new Map(),
    readinessStatus: 0,
    authLoginThrottled: 0,
  };
}

function state(): MetricsState {
  const root = globalThis as GlobalWithMetrics;
  root.__kpiMetricsState ??= createState();
  return root.__kpiMetricsState;
}

function increment(map: Map<string, number>, key: string) {
  map.set(key, (map.get(key) ?? 0) + 1);
}

function escapeLabel(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/\n/g, "\\n").replace(/"/g, '\\"');
}

function labels(values: Record<string, string>): string {
  return `{${Object.entries(values).map(([key, value]) => `${key}="${escapeLabel(value)}"`).join(",")}}`;
}

function parseComposite(key: string, names: string[]): Record<string, string> {
  const parts = key.split("\u001f");
  return Object.fromEntries(names.map((name, index) => [name, parts[index] ?? "unknown"]));
}

function durationMs(request: Request): number | null {
  const raw = request.headers.get(REQUEST_START_HEADER);
  if (!raw) return null;
  const started = Number(raw);
  if (!Number.isFinite(started) || started <= 0) return null;
  const duration = Date.now() - started;
  if (!Number.isFinite(duration) || duration < 0 || duration > 60 * 60 * 1000) return null;
  return duration;
}

export function normalizeMetricPath(pathname: string): string {
  const clean = pathname.split("?")[0] || "/";
  return clean
    .split("/")
    .map((segment) => UUID_SEGMENT.test(segment) ? ":id" : /^\d+$/.test(segment) ? ":number" : segment)
    .join("/") || "/";
}

export function recordApiResponse(input: {
  request: Request;
  requestId: string;
  status: number;
  code?: string | null;
  logCompletion?: boolean;
}): number | null {
  const metrics = state();
  const method = input.request.method.toUpperCase();
  const route = normalizeMetricPath(new URL(input.request.url).pathname);
  const status = String(input.status);
  const elapsedMs = durationMs(input.request);

  increment(metrics.requests, [method, route, status].join("\u001f"));
  if (elapsedMs !== null) {
    const key = [method, route].join("\u001f");
    const histogram = metrics.durations.get(key) ?? {
      count: 0,
      sumSeconds: 0,
      buckets: DURATION_BUCKETS_SECONDS.map(() => 0),
    };
    const seconds = elapsedMs / 1000;
    histogram.count += 1;
    histogram.sumSeconds += seconds;
    DURATION_BUCKETS_SECONDS.forEach((bucket, index) => {
      if (seconds <= bucket) histogram.buckets[index] += 1;
    });
    metrics.durations.set(key, histogram);
  }

  if (input.status >= 400) {
    const code = input.code?.trim() || (input.status >= 500 ? "INTERNAL_ERROR" : "HTTP_ERROR");
    increment(metrics.errors, [code, status].join("\u001f"));
    if (code === "LOGIN_THROTTLED") metrics.authLoginThrottled += 1;
  }

  if (input.logCompletion !== false) {
    logger.info("api_request_completed", {
      requestId: input.requestId,
      method,
      route,
      status: input.status,
      durationMs: elapsedMs,
      outcome: input.status >= 500 ? "server_error" : input.status >= 400 ? "client_error" : "success",
      ...(input.code ? { code: input.code } : {}),
    });
  }

  return elapsedMs;
}

export function recordReadiness(result: "ready" | "configuration_invalid" | "database_unavailable") {
  const metrics = state();
  metrics.readinessStatus = result === "ready" ? 1 : 0;
  increment(metrics.readinessChecks, result);
}

export function recordFrameworkRequestError(pathname: string, routeType: string) {
  increment(state().frameworkErrors, [normalizeMetricPath(pathname), routeType].join("\u001f"));
}

export function serverTimingHeader(elapsedMs: number | null): Record<string, string> {
  return elapsedMs === null ? {} : { "Server-Timing": `app;dur=${elapsedMs.toFixed(1)}` };
}

export function renderPrometheusMetrics(): string {
  const metrics = state();
  const lines: string[] = [
    "# HELP kpi_process_start_time_seconds Unix timestamp when this application process initialized metrics.",
    "# TYPE kpi_process_start_time_seconds gauge",
    `kpi_process_start_time_seconds ${metrics.startedAtSeconds}`,
    "# HELP kpi_http_requests_total HTTP responses emitted by the application process.",
    "# TYPE kpi_http_requests_total counter",
  ];

  for (const [key, value] of [...metrics.requests.entries()].sort(([left], [right]) => left.localeCompare(right))) {
    lines.push(`kpi_http_requests_total${labels(parseComposite(key, ["method", "route", "status"]))} ${value}`);
  }

  lines.push(
    "# HELP kpi_http_request_duration_seconds Application API response duration measured from Proxy entry to response creation.",
    "# TYPE kpi_http_request_duration_seconds histogram",
  );
  for (const [key, histogram] of [...metrics.durations.entries()].sort(([left], [right]) => left.localeCompare(right))) {
    const base = parseComposite(key, ["method", "route"]);
    DURATION_BUCKETS_SECONDS.forEach((bucket, index) => {
      lines.push(`kpi_http_request_duration_seconds_bucket${labels({ ...base, le: String(bucket) })} ${histogram.buckets[index]}`);
    });
    lines.push(`kpi_http_request_duration_seconds_bucket${labels({ ...base, le: "+Inf" })} ${histogram.count}`);
    lines.push(`kpi_http_request_duration_seconds_sum${labels(base)} ${histogram.sumSeconds}`);
    lines.push(`kpi_http_request_duration_seconds_count${labels(base)} ${histogram.count}`);
  }

  lines.push(
    "# HELP kpi_http_errors_total HTTP error responses grouped by stable application error code and status.",
    "# TYPE kpi_http_errors_total counter",
  );
  for (const [key, value] of [...metrics.errors.entries()].sort(([left], [right]) => left.localeCompare(right))) {
    lines.push(`kpi_http_errors_total${labels(parseComposite(key, ["code", "status"]))} ${value}`);
  }

  lines.push(
    "# HELP kpi_framework_request_errors_total Server request errors captured by Next.js instrumentation.",
    "# TYPE kpi_framework_request_errors_total counter",
  );
  for (const [key, value] of [...metrics.frameworkErrors.entries()].sort(([left], [right]) => left.localeCompare(right))) {
    lines.push(`kpi_framework_request_errors_total${labels(parseComposite(key, ["route", "route_type"]))} ${value}`);
  }

  lines.push(
    "# HELP kpi_readiness_status Last readiness result for this application process (1 ready, 0 not ready/unknown).",
    "# TYPE kpi_readiness_status gauge",
    `kpi_readiness_status ${metrics.readinessStatus}`,
    "# HELP kpi_readiness_checks_total Readiness checks grouped by outcome.",
    "# TYPE kpi_readiness_checks_total counter",
  );
  for (const [result, value] of [...metrics.readinessChecks.entries()].sort(([left], [right]) => left.localeCompare(right))) {
    lines.push(`kpi_readiness_checks_total${labels({ result })} ${value}`);
  }

  lines.push(
    "# HELP kpi_auth_login_throttled_total Login attempts rejected by the shared authentication throttle.",
    "# TYPE kpi_auth_login_throttled_total counter",
    `kpi_auth_login_throttled_total ${metrics.authLoginThrottled}`,
  );

  return `${lines.join("\n")}\n`;
}

export function resetMetricsForTest() {
  (globalThis as GlobalWithMetrics).__kpiMetricsState = createState();
}
