"use client";

import { useMemo, useState } from "react";
import { useQueries, useQuery } from "@tanstack/react-query";
import { AlertTriangle, CheckCircle2, CircleGauge, Gauge, LoaderCircle, ShieldAlert } from "lucide-react";
import { api, ClientApiError, type KpiVersionDetailDto, type OrganizationAccess, type PeriodEvaluationDto, type ScoringRuleDto } from "@/client/api";

function Panel({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <section className={`rounded-xl border border-slate-200 bg-white shadow-[0_1px_2px_rgba(15,23,42,.04)] ${className}`}>{children}</section>;
}

function Header({ eyebrow, title, subtitle }: { eyebrow: string; title: string; subtitle: string }) {
  return <div className="mb-5"><div className="mb-1 text-[11px] font-bold uppercase tracking-[.12em] text-blue-600">{eyebrow}</div><h1 className="text-[24px] font-semibold tracking-tight text-slate-950">{title}</h1><p className="mt-1 max-w-3xl text-sm text-slate-500">{subtitle}</p></div>;
}

function errorMessage(error: unknown) {
  return error instanceof ClientApiError ? `${error.message}${error.requestId ? ` · ${error.requestId}` : ""}` : error instanceof Error ? error.message : "The request could not be completed.";
}

function Restricted({ message }: { message: string }) {
  return <Panel className="p-8"><div className="flex gap-3"><ShieldAlert size={20} className="mt-0.5 text-slate-500"/><div><div className="font-semibold">Access restricted</div><div className="mt-1 text-sm text-slate-500">{message}</div></div></div></Panel>;
}

function Loading({ label }: { label: string }) {
  return <Panel className="p-8 text-center text-sm text-slate-500"><LoaderCircle size={16} className="mr-2 inline animate-spin"/>{label}</Panel>;
}

function ErrorPanel({ error }: { error: unknown }) {
  return <Panel className="border-rose-200 p-5 text-sm text-rose-700"><AlertTriangle size={15} className="mr-2 inline"/>{errorMessage(error)}</Panel>;
}

function canReadKpi(role: OrganizationAccess["role"]) { return role !== "MEMBER"; }
function canReadQuality(role: OrganizationAccess["role"]) { return role === "TEAM_LEADER" || role === "DEPARTMENT_HEAD" || role === "ADMINISTRATOR"; }

export function MetricLibraryWorkspace({ organization }: { organization: OrganizationAccess }) {
  const canRead = canReadKpi(organization.role);
  const query = useQuery({ queryKey: ["kpi-metrics", organization.organizationId], queryFn: () => api.kpi.metrics(organization.organizationId), enabled: canRead });
  if (!canRead) return <Restricted message="Metric definitions are available to Team Leader, Department Head and Administrator organization roles."/>;
  if (query.isPending) return <Loading label="Loading metric definitions…"/>;
  if (query.error) return <ErrorPanel error={query.error}/>;
  const metrics = query.data ?? [];
  return <div><Header eyebrow="KPI Configuration" title="Metric Library" subtitle="Reusable metric definitions are loaded from the organization-scoped PostgreSQL catalog. Formula kind, required fields and quality requirements shown here are runtime configuration, not display-only examples."/>
    {metrics.length === 0 ? <Panel className="p-10 text-center text-sm text-slate-500">No metric definitions are configured for this organization.</Panel> : <div className="grid gap-3 xl:grid-cols-3">{metrics.map((metric) => <Panel key={metric.id} className="p-4"><div className="flex items-start justify-between"><div className="grid h-9 w-9 place-items-center rounded-lg bg-blue-50 text-blue-700"><Gauge size={17}/></div><span className={`rounded-md px-2 py-1 text-[10px] font-bold ${metric.active ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-500"}`}>{metric.active ? "ACTIVE" : "INACTIVE"}</span></div><h3 className="mt-3 text-sm font-semibold">{metric.name}</h3><div className="mt-1 font-mono text-[10px] text-blue-700">{metric.key}</div><p className="mt-2 min-h-10 text-xs leading-5 text-slate-500">{metric.description || "No description."}</p><div className="mt-4 grid grid-cols-2 gap-2 text-[10px]"><div className="rounded-lg bg-slate-50 p-2"><span className="text-slate-400">Formula kind</span><div className="mt-1 font-semibold">{metric.formulaKind}</div></div><div className="rounded-lg bg-slate-50 p-2"><span className="text-slate-400">Required fields</span><div className="mt-1 font-semibold">{metric.requiredFields.length}</div></div></div>{metric.formula && <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50 p-2 font-mono text-[10px] text-slate-600">{metric.formula}</div>}<div className="mt-3 flex flex-wrap gap-1">{metric.requiredFields.map((field) => <span key={field} className="rounded bg-slate-100 px-2 py-1 text-[9px] font-semibold text-slate-600">{field}</span>)}</div></Panel>)}</div>}
  </div>;
}

type VersionRef = { templateName: string; versionId: string; version: number; status: string };

function ruleSummary(rule: ScoringRuleDto) {
  if (rule.type === "THRESHOLD") return `${rule.bands.length} threshold band(s)${rule.fallback == null ? " · no fallback" : ` · fallback ${rule.fallback}`}`;
  if (rule.type === "RANGE") return `${rule.ranges.length} range(s)${rule.fallback == null ? " · no fallback" : ` · fallback ${rule.fallback}`}`;
  if (rule.type === "FORMULA") return rule.expression;
  return `${rule.branches.length} hybrid branch(es)${rule.fallback == null ? " · no fallback" : ` · fallback ${rule.fallback}`}`;
}

export function ScoringRulesWorkspace({ organization }: { organization: OrganizationAccess }) {
  const canRead = canReadKpi(organization.role);
  const templatesQuery = useQuery({ queryKey: ["kpi-templates", organization.organizationId], queryFn: () => api.organizations.templates(organization.organizationId), enabled: canRead });
  const versionQueries = useQueries({ queries: (templatesQuery.data ?? []).map((template) => ({ queryKey: ["kpi-versions", organization.organizationId, template.id], queryFn: () => api.kpi.versions(organization.organizationId, template.id), enabled: canRead })) });
  const versionRefs: VersionRef[] = useMemo(() => (templatesQuery.data ?? []).flatMap((template, index) => (versionQueries[index]?.data ?? []).map((version) => ({ templateName: template.name, versionId: version.id, version: version.version, status: version.status }))), [templatesQuery.data, versionQueries]);
  const detailQueries = useQueries({ queries: versionRefs.map((ref) => ({ queryKey: ["kpi-version", organization.organizationId, ref.versionId], queryFn: () => api.kpi.version(organization.organizationId, ref.versionId), enabled: canRead })) });
  if (!canRead) return <Restricted message="Scoring-rule configuration is available to roles with KPI read access."/>;
  if (templatesQuery.isPending || versionQueries.some((query) => query.isPending) || detailQueries.some((query) => query.isPending)) return <Loading label="Loading persisted scoring rules…"/>;
  const error = templatesQuery.error || versionQueries.find((query) => query.error)?.error || detailQueries.find((query) => query.error)?.error;
  if (error) return <ErrorPanel error={error}/>;
  const rows = detailQueries.flatMap((query, index) => {
    const detail = query.data as KpiVersionDetailDto | undefined;
    const ref = versionRefs[index];
    if (!detail || !ref) return [];
    return detail.criteria.flatMap((criterion) => criterion.rules.map((rule) => ({ ref, criterion, rule })));
  });
  return <div><Header eyebrow="KPI Configuration" title="Scoring Rules" subtitle="Inventory of scoring rules persisted inside versioned KPI criteria. Rule editing remains in KPI Builder so lifecycle immutability and criterion maximum validation stay on the existing protected mutation path."/>
    <Panel>{rows.length === 0 ? <div className="p-10 text-center text-sm text-slate-500">No persisted scoring rules are configured.</div> : <div className="overflow-x-auto"><table className="w-full text-left text-xs"><thead className="bg-slate-50 text-slate-500"><tr>{["KPI version","Criterion","Type","Position","Configuration","Max score"].map((heading) => <th key={heading} className="px-4 py-2.5">{heading}</th>)}</tr></thead><tbody>{rows.map(({ ref, criterion, rule }) => <tr key={rule.id} className="border-t border-slate-100"><td className="px-4 py-3"><div className="font-semibold">{ref.templateName} · v{ref.version}</div><div className="text-[10px] text-slate-400">{ref.status}</div></td><td className="px-4 py-3 font-semibold">{criterion.name}</td><td className="px-4 py-3"><span className="rounded bg-blue-50 px-2 py-1 text-[10px] font-bold text-blue-700">{rule.type}</span></td><td className="px-4 py-3">{rule.position + 1}</td><td className="max-w-xl px-4 py-3 text-slate-600">{ruleSummary(rule)}</td><td className="px-4 py-3 font-semibold">{Number(criterion.maxScore).toFixed(1)}</td></tr>)}</tbody></table></div>}</Panel>
  </div>;
}

export function DataQualityWorkspace({ organization }: { organization: OrganizationAccess }) {
  const allowed = canReadQuality(organization.role);
  const [selectedPeriodId, setSelectedPeriodId] = useState<string | null>(null);
  const periodsQuery = useQuery({ queryKey: ["evaluation-periods", organization.organizationId], queryFn: () => api.evaluation.periods(organization.organizationId), enabled: allowed });
  const periods = periodsQuery.data ?? [];
  const activePeriod = periods.find((period) => period.id === selectedPeriodId) ?? periods[0] ?? null;
  const layer = organization.role === "TEAM_LEADER" ? "LEADER" as const : "DEPARTMENT_HEAD" as const;
  const evaluationsQuery = useQuery({ queryKey: ["quality-evaluations", organization.organizationId, activePeriod?.id, layer], queryFn: () => api.evaluation.reviewQueue(organization.organizationId, activePeriod!.id, layer), enabled: Boolean(allowed && activePeriod) });
  if (!allowed) return <Restricted message="Data Quality is role-scoped to Team Leader, Department Head and Administrator because it exposes evaluation evidence health."/>;
  if (periodsQuery.isPending) return <Loading label="Loading evaluation periods…"/>;
  if (periodsQuery.error) return <ErrorPanel error={periodsQuery.error}/>;
  const evaluations = evaluationsQuery.data ?? [];
  const issues = evaluations.flatMap((evaluation: PeriodEvaluationDto) => evaluation.qualityIssues.map((issue) => ({ evaluation, issue })));
  const unresolved = issues.filter(({ issue }) => !issue.resolvedAt);
  const critical = unresolved.filter(({ issue }) => issue.severity === "CRITICAL").length;
  return <div><div className="mb-5 flex items-start justify-between gap-4"><Header eyebrow="Insights" title="Data Quality" subtitle="Persisted evaluation-quality issues in the server-authorized review scope. Missing data is uncertainty and never converted to poor-performance score zero."/>{activePeriod && <select value={activePeriod.id} onChange={(event) => setSelectedPeriodId(event.target.value)} className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold">{periods.map((period) => <option key={period.id} value={period.id}>{period.key} · {period.status.replaceAll("_", " ")}</option>)}</select>}</div>
    {activePeriod && <div className="mb-4 grid grid-cols-4 gap-3"><Panel className="p-4"><div className="text-xs text-slate-500">Visible evaluations</div><div className="mt-2 text-2xl font-semibold">{evaluations.length}</div></Panel><Panel className="p-4"><div className="text-xs text-slate-500">Quality issues</div><div className="mt-2 text-2xl font-semibold">{issues.length}</div></Panel><Panel className="p-4"><div className="text-xs text-slate-500">Unresolved</div><div className="mt-2 text-2xl font-semibold">{unresolved.length}</div></Panel><Panel className="p-4"><div className="text-xs text-slate-500">Critical unresolved</div><div className="mt-2 text-2xl font-semibold text-rose-700">{critical}</div></Panel></div>}
    {evaluationsQuery.isPending && activePeriod ? <Loading label="Loading persisted quality issues…"/> : evaluationsQuery.error ? <ErrorPanel error={evaluationsQuery.error}/> : !activePeriod ? <Panel className="p-10 text-center text-sm text-slate-500">No evaluation period exists.</Panel> : <Panel>{issues.length === 0 ? <div className="p-10 text-center"><CheckCircle2 size={24} className="mx-auto text-emerald-500"/><div className="mt-2 text-sm font-semibold">No persisted quality issues in this scope</div></div> : <div className="overflow-x-auto"><table className="w-full text-left text-xs"><thead className="bg-slate-50 text-slate-500"><tr>{["Member","Team","Code","Missing field","Affected metric","Severity","Disposition","Message"].map((heading) => <th key={heading} className="px-4 py-2.5">{heading}</th>)}</tr></thead><tbody>{issues.map(({ evaluation, issue }) => <tr key={issue.id} className="border-t border-slate-100"><td className="px-4 py-3"><div className="font-semibold">{evaluation.memberName}</div><div className="text-[10px] text-slate-400">{evaluation.employeeId}</div></td><td className="px-4 py-3">{evaluation.teamName}</td><td className="px-4 py-3 font-mono text-[10px]">{issue.code}</td><td className="px-4 py-3">{issue.missingField ?? "—"}</td><td className="px-4 py-3">{issue.affectedMetric ?? "—"}</td><td className="px-4 py-3"><span className={`rounded px-2 py-1 text-[10px] font-bold ${issue.severity === "CRITICAL" ? "bg-rose-50 text-rose-700" : issue.severity === "WARNING" ? "bg-amber-50 text-amber-700" : "bg-blue-50 text-blue-700"}`}>{issue.severity}</span></td><td className="px-4 py-3">{issue.resolutionDisposition ?? (issue.resolvedAt ? "RESOLVED" : "OPEN")}</td><td className="max-w-md px-4 py-3 text-slate-600">{issue.message}</td></tr>)}</tbody></table></div>}</Panel>}
  </div>;
}

function boundary(value: number | null, inclusive: boolean, side: "min" | "max") {
  if (value === null) return side === "min" ? "−∞" : "+∞";
  return `${inclusive ? (side === "min" ? "≥" : "≤") : (side === "min" ? ">" : "<")} ${value.toFixed(2)}`;
}

export function RankSchemesWorkspace({ organization }: { organization: OrganizationAccess }) {
  const canRead = canReadKpi(organization.role);
  const query = useQuery({ queryKey: ["rank-schemes", organization.organizationId], queryFn: () => api.kpi.rankSchemes(organization.organizationId), enabled: canRead });
  if (!canRead) return <Restricted message="Rank schemes are KPI configuration and require KPI read access."/>;
  if (query.isPending) return <Loading label="Loading rank schemes…"/>;
  if (query.error) return <ErrorPanel error={query.error}/>;
  const schemes = query.data ?? [];
  return <div><Header eyebrow="Administration" title="Rank Schemes" subtitle="Rank bands are loaded from PostgreSQL and validated by the same deterministic domain validator used during finalization. Invalid overlaps or gaps are rejected rather than rendered as trusted configuration."/>
    {schemes.length === 0 ? <Panel className="p-10 text-center text-sm text-slate-500">No rank schemes are configured.</Panel> : <div className="space-y-4">{schemes.map((scheme) => <Panel key={scheme.id}><div className="flex items-center justify-between border-b border-slate-100 px-5 py-4"><div className="flex items-center gap-3"><div className="grid h-9 w-9 place-items-center rounded-lg bg-blue-50 text-blue-700"><CircleGauge size={17}/></div><div><div className="font-semibold">{scheme.name}</div><div className="text-[10px] text-slate-400">{scheme.bands.length} validated bands</div></div></div><span className={`rounded px-2 py-1 text-[10px] font-bold ${scheme.active ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-500"}`}>{scheme.active ? "ACTIVE" : "INACTIVE"}</span></div><table className="w-full text-left text-xs"><thead className="bg-slate-50 text-slate-500"><tr>{["Rank","Lower boundary","Upper boundary","Coefficient","Position","Validation"].map((heading) => <th key={heading} className="px-4 py-2.5">{heading}</th>)}</tr></thead><tbody>{scheme.bands.map((band) => <tr key={band.id} className="border-t border-slate-100"><td className="px-4 py-3 font-bold">{band.rank}</td><td className="px-4 py-3">{boundary(band.minScore, band.minInclusive, "min")}</td><td className="px-4 py-3">{boundary(band.maxScore, band.maxInclusive, "max")}</td><td className="px-4 py-3">{band.coefficient.toFixed(3)}</td><td className="px-4 py-3">{band.position + 1}</td><td className="px-4 py-3 text-emerald-700"><CheckCircle2 size={13} className="mr-1 inline"/>No gap/overlap</td></tr>)}</tbody></table></Panel>)}</div>}
  </div>;
}
