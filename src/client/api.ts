export type AppRole = "MEMBER" | "TEAM_LEADER" | "DEPARTMENT_HEAD" | "ADMINISTRATOR";
export type KpiLifecycleStatus = "DRAFT" | "PUBLISHED" | "IN_USE" | "RETIRED";
export type EvaluationMethod = "AUTO" | "ASSISTED" | "MANUAL";
export type EvidenceSource = "JIRA" | "MANUAL" | "CUSTOM";
export type ComparisonOperator = ">" | ">=" | "<" | "<=" | "==" | "!=";

export interface SessionUser {
  id: string;
  email: string;
  displayName: string;
  role: AppRole;
  passwordChangeRequired: boolean;
  permissions: string[];
}

export interface OrganizationAccess {
  organizationId: string;
  organizationName: string;
  organizationSlug: string;
  role: AppRole;
}

export interface OrganizationUserDto {
  userId: string;
  displayName: string;
  email: string;
  userActive: boolean;
  role: AppRole;
  accessActive: boolean;
  passwordChangeRequired: boolean;
  memberId: string | null;
  memberName: string | null;
}

export interface DepartmentHeadAssignmentDto {
  id: string;
  departmentId: string;
  departmentName: string;
  userId: string;
  userDisplayName: string;
  userEmail: string;
  effectiveFrom: string;
  effectiveTo: string | null;
  createdAt: string;
}

export interface DepartmentDto {
  id: string;
  name: string;
  code: string;
  active: boolean;
}

export interface TeamDto {
  id: string;
  name: string;
  description: string | null;
  effectiveFrom: string;
  active: boolean;
  departmentId: string;
  departmentName: string;
  leaderMemberId: string | null;
}

export interface MemberDto {
  id: string;
  employeeId: string;
  name: string;
  email: string;
  active: boolean;
}

export interface KpiTemplateDto {
  id: string;
  name: string;
  kpiGroup: string | null;
  description: string | null;
  createdAt: string;
}

export interface MetricDefinitionDto {
  id: string;
  key: string;
  name: string;
  description: string | null;
  formulaKind: "COUNT" | "RATIO" | "DURATION" | "CUSTOM_FORMULA";
  formula: string | null;
  requiredFields: string[];
  supportedIssueTypes: string[];
  dataQualityRequirements: Record<string, unknown>;
  active: boolean;
}

export type ScoringRuleInput =
  | { type: "THRESHOLD"; bands: Array<{ operator: ComparisonOperator; value: number; score: number }>; fallback?: number | null }
  | { type: "RANGE"; ranges: Array<{ min?: number; max?: number; minInclusive?: boolean; maxInclusive?: boolean; score: number }>; fallback?: number | null }
  | { type: "FORMULA"; expression: string }
  | { type: "HYBRID"; branches: Array<{ all: Array<{ field: string; operator: ComparisonOperator; value: number }>; score: number }>; fallback?: number | null };

export type ScoringRuleDto = ScoringRuleInput & { id: string; position: number };

export interface RankSchemeDto {
  id: string;
  name: string;
  active: boolean;
  createdAt: string;
  updatedAt: string;
  bands: Array<{
    id: string;
    rank: string;
    minScore: number | null;
    maxScore: number | null;
    minInclusive: boolean;
    maxInclusive: boolean;
    coefficient: number;
    position: number;
  }>;
}

export interface KpiVersionSummaryDto {
  id: string;
  version: number;
  status: KpiLifecycleStatus;
  totalMaxScore: string;
  submittedAt: string | null;
  approvedAt: string | null;
  publishedAt: string | null;
  retiredAt: string | null;
  createdAt: string;
}

export interface KpiCriterionDto {
  id: string;
  kpiVersionId: string;
  name: string;
  description: string | null;
  position: number;
  maxScore: string;
  method: EvaluationMethod;
  evidencePolicy: { sources: EvidenceSource[]; config?: Record<string, unknown> };
  reviewRequired: boolean;
  requiredEvidence: boolean;
  adjustmentPolicy: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
  metricConfiguration: {
    id: string;
    metricDefinitionId: string;
    metricKey: string;
    metricName: string;
    parameters: Record<string, unknown>;
  } | null;
  rules: ScoringRuleDto[];
}

export interface KpiVersionDetailDto {
  id: string;
  templateId: string;
  templateName: string;
  version: number;
  status: KpiLifecycleStatus;
  totalMaxScore: string;
  submittedAt: string | null;
  approvedAt: string | null;
  publishedAt: string | null;
  retiredAt: string | null;
  criteria: KpiCriterionDto[];
}

export interface CriterionInput {
  name: string;
  description?: string | null;
  position: number;
  maxScore: number;
  method: EvaluationMethod;
  evidencePolicy: { sources: EvidenceSource[]; config?: Record<string, unknown> };
  reviewRequired: boolean;
  requiredEvidence: boolean;
  adjustmentPolicy: Record<string, unknown>;
}

export type EvaluationPeriodStatus = "UPCOMING" | "COLLECTING" | "SYSTEM_EVALUATED" | "LEADER_REVIEW" | "HEAD_REVIEW" | "FINALIZED" | "LOCKED";
export type EvaluationStatus = "PENDING" | "SYSTEM_EVALUATED" | "LEADER_REVIEW" | "HEAD_REVIEW" | "FINALIZED" | "LOCKED";
export type ConfidenceLevel = "HIGH" | "MEDIUM" | "LOW" | "REVIEW_REQUIRED";

export interface EvaluationPeriodDto {
  id: string;
  key: string;
  startsOn: string;
  endsOn: string;
  status: EvaluationPeriodStatus;
  rankSchemeId: string | null;
  lockedAt: string | null;
  createdAt: string;
}

export interface PeriodAssignmentDto {
  id: string;
  teamId: string;
  teamName: string;
  kpiVersionId: string;
  templateName: string;
  version: number;
  status: KpiLifecycleStatus;
}

export interface CollectedEvidenceInput {
  type: EvidenceSource;
  sourceRef?: string | null;
  title: string;
  payload?: Record<string, unknown>;
}

export interface CollectedCriterionInput {
  criterionId: string;
  inputFacts?: Record<string, number | string | boolean | null>;
  metric?: { value: number | null; variables?: Record<string, number | null> };
  confidence?: ConfidenceLevel;
  evidence?: CollectedEvidenceInput[];
}

export interface PeriodEvaluationDto {
  id: string;
  memberId: string;
  memberName: string;
  employeeId: string;
  resolvedMembershipId: string | null;
  resolvedTeamId: string;
  teamName: string;
  kpiVersionId: string;
  templateName: string;
  version: number;
  status: EvaluationStatus;
  confidence: ConfidenceLevel;
  systemScore: number | null;
  leaderScore: number | null;
  headScore: number | null;
  finalScore: number | null;
  finalRank: string | null;
  finalCoefficient: number | null;
  finalizedAt: string | null;
  lockedAt: string | null;
  updatedAt: string;
  criteria: Array<{
    id: string;
    criterionId: string;
    criterionName: string;
    maxScore: number;
    metricValue: Record<string, unknown> | null;
    systemScore: number | null;
    leaderScore: number | null;
    headScore: number | null;
    finalScore: number | null;
    confidence: ConfidenceLevel;
    explanationTrace: Record<string, unknown>;
  }>;
  qualityIssues: Array<{
    id: string;
    criterionEvaluationId: string | null;
    code: string;
    missingField: string | null;
    affectedMetric: string | null;
    severity: "INFO" | "WARNING" | "CRITICAL";
    message: string;
    resolvedAt: string | null;
    resolutionDisposition: "RESOLVED" | "WAIVED" | null;
    resolutionReason: string | null;
    resolvedBy: string | null;
  }>;
}

export type JiraFactRuleInput =
  | { type: "FIELD"; field: string }
  | { type: "CONSTANT"; value: number | string | boolean | null }
  | { type: "EXISTS"; field: string }
  | { type: "DATE_LTE"; leftField: string; rightField: string }
  | { type: "LABEL_PRESENT"; field?: string; label: string }
  | { type: "STATUS_IN"; field?: string; values: string[] };

export interface JiraSyncConfigDto {
  jql: string;
  fields: string[];
  factMappings: Record<string, JiraFactRuleInput>;
}

export interface JiraSyncRunDto {
  id: string;
  connectionId: string;
  status: "RUNNING" | "SUCCEEDED" | "FAILED";
  initiatedBy: string | null;
  startedAt: string;
  completedAt: string | null;
  issuesSeen: number;
  issuesMapped: number;
  issuesUnmapped: number;
  pagesFetched: number;
  errorCode: string | null;
  errorMessage: string | null;
  metadata: Record<string, unknown>;
}

export interface JiraConnectionDto {
  id: string;
  workspaceUrl: string;
  active: boolean;
  lastSyncAt: string | null;
  syncConfig: JiraSyncConfigDto;
  secretConfigured: boolean;
  mappingCount: number;
  factCount: number;
  latestRun: JiraSyncRunDto | null;
}

export interface JiraMemberMappingDto {
  id: string;
  memberId: string;
  memberName: string;
  employeeId: string;
  jiraAccountId: string;
  jiraDisplayName: string | null;
  active: boolean;
}

export interface JiraIssueFactDto {
  id: string;
  jiraIssueId: string;
  issueKey: string;
  summary: string;
  memberId: string | null;
  memberName: string | null;
  facts: Record<string, unknown>;
  attribution: Record<string, unknown>;
  observedAt: string;
  sourceUpdatedAt: string | null;
}

export interface AuditEventDto {
  id: string;
  occurredAt: string;
  actorUserId: string | null;
  actorDisplayName: string | null;
  actorEmail: string | null;
  requestId: string | null;
  action: string;
  entityType: string;
  entityId: string;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  reason: string | null;
  metadata: Record<string, unknown>;
}

export interface HistoricalAnalyticsDto {
  scope: "SELF" | "ORGANIZATION";
  summary: { score: number | null; validCount: number; totalCount: number; coverageLabel: string };
  latest: { periodKey: string; score: number; rank: string | null; coefficient: number | null } | null;
  rankDistribution: Array<{ rank: string; count: number }>;
  series: Array<{
    periodId: string;
    periodKey: string;
    startsOn: string;
    endsOn: string;
    score: number | null;
    validCount: number;
    totalCount: number;
    coverageLabel: string;
  }>;
}

export interface EvaluatePeriodResponse {
  results: Array<{
    id: string;
    memberId: string;
    resolvedMembershipId: string;
    resolvedTeamId: string;
    kpiVersionId: string;
    status: "SYSTEM_EVALUATED";
    systemScore: number | null;
    confidence: ConfidenceLevel;
    coverage: number;
    qualityIssueCount: number;
  }>;
  progress: { eligibleMembers: number; evaluatedMembers: number; completed: boolean };
}

interface SuccessEnvelope<T> { data: T; requestId: string }
interface ErrorEnvelope { error: { code: string; message: string; details?: unknown }; requestId: string }

export class ClientApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly requestId: string | null,
    public readonly details?: unknown,
  ) {
    super(message);
  }
}

async function readEnvelope<T>(response: Response): Promise<T> {
  let payload: SuccessEnvelope<T> | ErrorEnvelope | null = null;
  try {
    payload = await response.json() as SuccessEnvelope<T> | ErrorEnvelope;
  } catch {
    throw new ClientApiError(response.status || 500, "INVALID_RESPONSE", "The server returned an invalid response.", null);
  }
  if (!response.ok || "error" in payload) {
    const error = "error" in payload ? payload.error : { code: "REQUEST_FAILED", message: `Request failed with status ${response.status}.` };
    throw new ClientApiError(response.status, error.code, error.message, payload.requestId ?? null, "details" in error ? error.details : undefined);
  }
  return payload.data;
}

export async function apiRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  if (init?.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  const response = await fetch(path, {
    ...init,
    headers,
    credentials: "same-origin",
    cache: "no-store",
  });
  return readEnvelope<T>(response);
}

export const api = {
  auth: {
    me: () => apiRequest<SessionUser>("/api/auth/me"),
    login: (email: string, password: string) => apiRequest<{ user: Omit<SessionUser, "permissions">; permissions: string[]; expiresAt: string }>("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    }),
    logout: () => apiRequest<{ loggedOut: boolean }>("/api/auth/logout", { method: "POST", body: JSON.stringify({}) }),
    changePassword: (currentPassword: string, newPassword: string) => apiRequest<{ changed: boolean }>("/api/auth/password", { method: "POST", body: JSON.stringify({ currentPassword, newPassword }) }),
  },
  organizations: {
    list: () => apiRequest<OrganizationAccess[]>("/api/organizations"),
    departments: (organizationId: string) => apiRequest<DepartmentDto[]>(`/api/organizations/${organizationId}/departments`),
    teams: (organizationId: string) => apiRequest<TeamDto[]>(`/api/organizations/${organizationId}/teams`),
    createTeam: (organizationId: string, input: { departmentId: string; name: string; description?: string | null; effectiveFrom: string; leaderMemberId?: string | null }) =>
      apiRequest<TeamDto>(`/api/organizations/${organizationId}/teams`, { method: "POST", body: JSON.stringify(input) }),
    members: (organizationId: string) => apiRequest<MemberDto[]>(`/api/organizations/${organizationId}/members`),
    createMember: (organizationId: string, input: { employeeId: string; name: string; email: string }) =>
      apiRequest<MemberDto>(`/api/organizations/${organizationId}/members`, { method: "POST", body: JSON.stringify(input) }),
    templates: (organizationId: string) => apiRequest<KpiTemplateDto[]>(`/api/organizations/${organizationId}/kpi/templates`),
    createTemplate: (organizationId: string, input: { name: string; kpiGroup?: string | null; description?: string | null }) =>
      apiRequest<{ template: KpiTemplateDto; version: { id: string; version: number; status: string } }>(`/api/organizations/${organizationId}/kpi/templates`, { method: "POST", body: JSON.stringify(input) }),
  },
  kpi: {
    metrics: (organizationId: string) => apiRequest<MetricDefinitionDto[]>(`/api/organizations/${organizationId}/kpi/metrics`),
    createMetric: (organizationId: string, input: { key: string; name: string; description?: string | null; formulaKind: MetricDefinitionDto["formulaKind"]; formula?: string | null; requiredFields: string[]; supportedIssueTypes: string[]; dataQualityRequirements: Record<string, unknown> }) =>
      apiRequest<MetricDefinitionDto>(`/api/organizations/${organizationId}/kpi/metrics`, { method: "POST", body: JSON.stringify(input) }),
    rankSchemes: (organizationId: string) => apiRequest<RankSchemeDto[]>(`/api/organizations/${organizationId}/kpi/rank-schemes`),
    versions: (organizationId: string, templateId: string) => apiRequest<KpiVersionSummaryDto[]>(`/api/organizations/${organizationId}/kpi/templates/${templateId}/versions`),
    version: (organizationId: string, versionId: string) => apiRequest<KpiVersionDetailDto>(`/api/organizations/${organizationId}/kpi/versions/${versionId}`),
    createVersion: (organizationId: string, templateId: string, sourceVersionId?: string | null) =>
      apiRequest<KpiVersionSummaryDto>(`/api/organizations/${organizationId}/kpi/templates/${templateId}/versions`, {
        method: "POST",
        body: JSON.stringify({ sourceVersionId: sourceVersionId ?? null }),
      }),
    addCriterion: (organizationId: string, versionId: string, input: CriterionInput) =>
      apiRequest<KpiCriterionDto>(`/api/organizations/${organizationId}/kpi/versions/${versionId}/criteria`, { method: "POST", body: JSON.stringify(input) }),
    updateCriterion: (organizationId: string, criterionId: string, patch: Partial<CriterionInput>) =>
      apiRequest<KpiCriterionDto>(`/api/organizations/${organizationId}/kpi/criteria/${criterionId}`, { method: "PATCH", body: JSON.stringify(patch) }),
    deleteCriterion: (organizationId: string, criterionId: string) =>
      apiRequest<{ deleted: boolean }>(`/api/organizations/${organizationId}/kpi/criteria/${criterionId}`, { method: "DELETE" }),
    setCriterionMetric: (organizationId: string, criterionId: string, metricDefinitionId: string, parameters: Record<string, unknown>) =>
      apiRequest<{ id: string; criterionId: string; metricDefinitionId: string; parameters: Record<string, unknown> }>(`/api/organizations/${organizationId}/kpi/criteria/${criterionId}/metric`, {
        method: "PUT",
        body: JSON.stringify({ metricDefinitionId, parameters }),
      }),
    setCriterionRules: (organizationId: string, criterionId: string, rules: ScoringRuleInput[]) =>
      apiRequest<ScoringRuleDto[]>(`/api/organizations/${organizationId}/kpi/criteria/${criterionId}/rules`, { method: "PUT", body: JSON.stringify({ rules }) }),
    lifecycle: (organizationId: string, versionId: string, action: "SUBMIT" | "APPROVE" | "PUBLISH" | "RETIRE") =>
      apiRequest<KpiVersionSummaryDto>(`/api/organizations/${organizationId}/kpi/versions/${versionId}/lifecycle`, { method: "POST", body: JSON.stringify({ action }) }),
  },
  jira: {
    connections: (organizationId: string) => apiRequest<JiraConnectionDto[]>(`/api/organizations/${organizationId}/jira/connections`),
    createConnection: (organizationId: string, input: { workspaceUrl: string; secretRef: string; syncConfig: JiraSyncConfigDto }) =>
      apiRequest<JiraConnectionDto>(`/api/organizations/${organizationId}/jira/connections`, { method: "POST", body: JSON.stringify(input) }),
    mappings: (organizationId: string, connectionId: string) => apiRequest<JiraMemberMappingDto[]>(`/api/organizations/${organizationId}/jira/connections/${connectionId}/mappings`),
    replaceMappings: (organizationId: string, connectionId: string, mappings: Array<{ memberId: string; jiraAccountId: string; jiraDisplayName?: string | null }>) =>
      apiRequest<JiraMemberMappingDto[]>(`/api/organizations/${organizationId}/jira/connections/${connectionId}/mappings`, { method: "PUT", body: JSON.stringify({ mappings }) }),
    sync: (organizationId: string, connectionId: string) => apiRequest<JiraSyncRunDto>(`/api/organizations/${organizationId}/jira/connections/${connectionId}/sync`, { method: "POST", body: JSON.stringify({}) }),
    runs: (organizationId: string, connectionId: string) => apiRequest<JiraSyncRunDto[]>(`/api/organizations/${organizationId}/jira/connections/${connectionId}/runs`),
    facts: (organizationId: string, connectionId: string) => apiRequest<JiraIssueFactDto[]>(`/api/organizations/${organizationId}/jira/connections/${connectionId}/facts`),
  },
  audit: {
    list: (organizationId: string, limit = 100) => apiRequest<AuditEventDto[]>(`/api/organizations/${organizationId}/audit?limit=${limit}`),
  },
  analytics: {
    history: (organizationId: string) => apiRequest<HistoricalAnalyticsDto>(`/api/organizations/${organizationId}/analytics/history`),
  },
  administration: {
    users: (organizationId: string) => apiRequest<OrganizationUserDto[]>(`/api/organizations/${organizationId}/administration/users`),
    provisionUser: (organizationId: string, input: { email: string; displayName: string; role: AppRole; temporaryPassword: string; memberId?: string | null }) =>
      apiRequest<OrganizationUserDto>(`/api/organizations/${organizationId}/administration/users`, { method: "POST", body: JSON.stringify(input) }),
    departmentHeadAssignments: (organizationId: string) => apiRequest<DepartmentHeadAssignmentDto[]>(`/api/organizations/${organizationId}/administration/department-head-assignments`),
    createDepartmentHeadAssignment: (organizationId: string, input: { departmentId: string; userId: string; effectiveFrom: string; effectiveTo?: string | null }) =>
      apiRequest<DepartmentHeadAssignmentDto>(`/api/organizations/${organizationId}/administration/department-head-assignments`, { method: "POST", body: JSON.stringify(input) }),
    closeDepartmentHeadAssignment: (organizationId: string, assignmentId: string, effectiveTo: string) =>
      apiRequest<DepartmentHeadAssignmentDto>(`/api/organizations/${organizationId}/administration/department-head-assignments/${assignmentId}`, { method: "PATCH", body: JSON.stringify({ effectiveTo }) }),
  },
  evaluation: {
    periods: (organizationId: string) => apiRequest<EvaluationPeriodDto[]>(`/api/organizations/${organizationId}/evaluation/periods`),
    createPeriod: (organizationId: string, input: { key: string; startsOn: string; endsOn: string; rankSchemeId?: string | null }) =>
      apiRequest<EvaluationPeriodDto>(`/api/organizations/${organizationId}/evaluation/periods`, { method: "POST", body: JSON.stringify(input) }),
    assignments: (organizationId: string, periodId: string) => apiRequest<PeriodAssignmentDto[]>(`/api/organizations/${organizationId}/evaluation/periods/${periodId}/assignments`),
    replaceAssignments: (organizationId: string, periodId: string, assignments: Array<{ teamId: string; kpiVersionId: string }>) =>
      apiRequest<Array<{ teamId: string; kpiVersionId: string }>>(`/api/organizations/${organizationId}/evaluation/periods/${periodId}/assignments`, { method: "PUT", body: JSON.stringify({ assignments }) }),
    startCollection: (organizationId: string, periodId: string) =>
      apiRequest<EvaluationPeriodDto>(`/api/organizations/${organizationId}/evaluation/periods/${periodId}/lifecycle`, { method: "POST", body: JSON.stringify({ action: "START_COLLECTION" }) }),
    run: (organizationId: string, periodId: string, members: Array<{ memberId: string; criteria: CollectedCriterionInput[] }>) =>
      apiRequest<EvaluatePeriodResponse>(`/api/organizations/${organizationId}/evaluation/periods/${periodId}/evaluate`, { method: "POST", body: JSON.stringify({ members }) }),
    runJira: (organizationId: string, periodId: string, memberIds: string[] = []) =>
      apiRequest<EvaluatePeriodResponse & { source: "JIRA" }>(`/api/organizations/${organizationId}/evaluation/periods/${periodId}/evaluate-jira`, { method: "POST", body: JSON.stringify({ memberIds }) }),
    evaluations: (organizationId: string, periodId: string) => apiRequest<PeriodEvaluationDto[]>(`/api/organizations/${organizationId}/evaluation/periods/${periodId}/evaluations`),
    reviewQueue: (organizationId: string, periodId: string, layer: "LEADER" | "DEPARTMENT_HEAD") =>
      apiRequest<PeriodEvaluationDto[]>(`/api/organizations/${organizationId}/evaluation/periods/${periodId}/review-queue?layer=${layer}`),
    completeLeaderReview: (organizationId: string, evaluationId: string, adjustments: Array<{ criterionEvaluationId: string; score: number; reason?: string }>) =>
      apiRequest<{ evaluationId: string; layer: "LEADER"; score: number; status: "LEADER_REVIEW"; periodStatus: EvaluationPeriodStatus }>(`/api/organizations/${organizationId}/evaluation/evaluations/${evaluationId}/leader-review`, { method: "POST", body: JSON.stringify({ adjustments }) }),
    completeHeadReview: (organizationId: string, evaluationId: string, adjustments: Array<{ criterionEvaluationId: string; score: number; reason?: string }>) =>
      apiRequest<{ evaluationId: string; layer: "DEPARTMENT_HEAD"; score: number; status: "HEAD_REVIEW"; periodStatus: EvaluationPeriodStatus }>(`/api/organizations/${organizationId}/evaluation/evaluations/${evaluationId}/head-review`, { method: "POST", body: JSON.stringify({ adjustments }) }),
    resolveQualityIssue: (organizationId: string, issueId: string, disposition: "RESOLVED" | "WAIVED", reason: string) =>
      apiRequest<{ id: string; resolvedAt: string; resolutionDisposition: "RESOLVED" | "WAIVED"; resolutionReason: string; resolvedBy: string }>(`/api/organizations/${organizationId}/evaluation/quality-issues/${issueId}/resolve`, { method: "POST", body: JSON.stringify({ disposition, reason }) }),
    finalize: (organizationId: string, evaluationId: string) =>
      apiRequest<{ evaluationId: string; status: "FINALIZED"; finalScore: number; finalRank: string | null; finalCoefficient: number | null; periodStatus: EvaluationPeriodStatus }>(`/api/organizations/${organizationId}/evaluation/evaluations/${evaluationId}/finalize`, { method: "POST", body: JSON.stringify({}) }),
    lock: (organizationId: string, evaluationId: string) =>
      apiRequest<{ evaluationId: string; status: "LOCKED"; snapshotId: string; checksum: string; lockedAt: string; periodStatus: EvaluationPeriodStatus }>(`/api/organizations/${organizationId}/evaluation/evaluations/${evaluationId}/lock`, { method: "POST", body: JSON.stringify({}) }),
  },
};
