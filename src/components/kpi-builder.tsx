"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, CheckCircle2, ChevronRight, CopyPlus, LoaderCircle, LockKeyhole, Plus, Save, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import {
  api,
  ClientApiError,
  type ComparisonOperator,
  type CriterionInput,
  type EvidenceSource,
  type KpiCriterionDto,
  type KpiTemplateDto,
  type MetricDefinitionDto,
  type OrganizationAccess,
  type ScoringRuleInput,
} from "@/client/api";
import { mergeThresholdRule, nextCriterionMaxScore } from "@/client/kpi-builder-state";

type BuilderProps = {
  organization: OrganizationAccess;
  selectedTemplateId: string | null;
  onTemplateChange: (templateId: string) => void;
};

type ThresholdBand = { operator: ComparisonOperator; value: number; score: number };

const operators: ComparisonOperator[] = [">=", ">", "<=", "<", "==", "!="];
const evidenceSources: Array<{ value: EvidenceSource; label: string }> = [
  { value: "JIRA", label: "Jira" },
  { value: "MANUAL", label: "Manual evidence" },
  { value: "CUSTOM", label: "Custom source" },
];

function message(error: unknown) {
  return error instanceof ClientApiError
    ? `${error.message}${error.requestId ? ` · Request ${error.requestId}` : ""}`
    : error instanceof Error ? error.message : "The request could not be completed.";
}

function roleLabel(role: OrganizationAccess["role"]) {
  return role === "ADMINISTRATOR" ? "Administrator" : role === "DEPARTMENT_HEAD" ? "Department Head" : role === "TEAM_LEADER" ? "Team Leader" : "Member";
}

function canManage(role: OrganizationAccess["role"]) {
  return role === "ADMINISTRATOR";
}

function canApprove(role: OrganizationAccess["role"]) {
  return role === "ADMINISTRATOR" || role === "DEPARTMENT_HEAD";
}

function Panel({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <section className={`rounded-xl border border-slate-200 bg-white shadow-[0_1px_2px_rgba(15,23,42,.04)] ${className}`}>{children}</section>;
}

function StatusBadge({ children }: { children: React.ReactNode }) {
  return <span className="inline-flex rounded-md bg-slate-100 px-2 py-1 text-[10px] font-bold uppercase tracking-wide text-slate-600 ring-1 ring-inset ring-slate-200">{children}</span>;
}

function InlineError({ error }: { error: unknown }) {
  if (!error) return null;
  return <div className="mt-3 flex gap-2 rounded-lg border border-rose-200 bg-rose-50 p-3 text-xs text-rose-700"><AlertTriangle size={14} className="mt-0.5 shrink-0"/><span>{message(error)}</span></div>;
}

function SuccessHint({ show, children }: { show: boolean; children: React.ReactNode }) {
  if (!show) return null;
  return <div className="mt-3 flex items-center gap-2 text-xs font-semibold text-emerald-700"><CheckCircle2 size={14}/>{children}</div>;
}

function CriterionEditor({
  organization,
  criterion,
  metrics,
  mutable,
  onDeleted,
}: {
  organization: OrganizationAccess;
  criterion: KpiCriterionDto;
  metrics: MetricDefinitionDto[];
  mutable: boolean;
  onDeleted: () => void;
}) {
  const queryClient = useQueryClient();
  const [name, setName] = useState(criterion.name);
  const [description, setDescription] = useState(criterion.description ?? "");
  const [maxScore, setMaxScore] = useState(Number(criterion.maxScore));
  const [method, setMethod] = useState(criterion.method);
  const [reviewRequired, setReviewRequired] = useState(criterion.reviewRequired);
  const [requiredEvidence, setRequiredEvidence] = useState(criterion.requiredEvidence);
  const [sources, setSources] = useState<EvidenceSource[]>(criterion.evidencePolicy?.sources ?? []);
  const [meaningfulDelta, setMeaningfulDelta] = useState<number>(() => {
    const value = criterion.adjustmentPolicy?.meaningfulDelta;
    return typeof value === "number" && Number.isFinite(value) ? value : 0.3;
  });
  const [metricDefinitionId, setMetricDefinitionId] = useState(criterion.metricConfiguration?.metricDefinitionId ?? metrics[0]?.id ?? "");

  const currentThreshold = criterion.rules.find((rule) => rule.type === "THRESHOLD");
  const [bands, setBands] = useState<ThresholdBand[]>(currentThreshold?.type === "THRESHOLD" ? currentThreshold.bands : [
    { operator: ">=", value: 80, score: Math.min(maxScore, Math.max(0.1, maxScore * 0.8)) },
  ]);
  const [fallback, setFallback] = useState<string>(currentThreshold?.type === "THRESHOLD" && currentThreshold.fallback != null ? String(currentThreshold.fallback) : "");

  const detailMutation = useMutation({
    mutationFn: () => api.kpi.updateCriterion(organization.organizationId, criterion.id, {
      name: name.trim(),
      description: description.trim() || null,
      maxScore,
      method,
      evidencePolicy: { sources, config: criterion.evidencePolicy?.config },
      reviewRequired,
      requiredEvidence,
      adjustmentPolicy: { ...criterion.adjustmentPolicy, meaningfulDelta },
    }),
    onSuccess: async () => queryClient.invalidateQueries({ queryKey: ["kpi-version", organization.organizationId, criterion.kpiVersionId] }),
  });

  const metricMutation = useMutation({
    mutationFn: () => api.kpi.setCriterionMetric(
      organization.organizationId,
      criterion.id,
      metricDefinitionId,
      criterion.metricConfiguration?.parameters ?? {},
    ),
    onSuccess: async () => queryClient.invalidateQueries({ queryKey: ["kpi-version", organization.organizationId, criterion.kpiVersionId] }),
  });

  const ruleMutation = useMutation({
    mutationFn: () => {
      const threshold: ScoringRuleInput = {
        type: "THRESHOLD",
        bands: bands.map((band) => ({ ...band, score: Math.min(maxScore, band.score) })),
        fallback: fallback.trim() === "" ? null : Math.min(maxScore, Number(fallback)),
      };
      return api.kpi.setCriterionRules(organization.organizationId, criterion.id, mergeThresholdRule(criterion.rules, threshold));
    },
    onSuccess: async () => queryClient.invalidateQueries({ queryKey: ["kpi-version", organization.organizationId, criterion.kpiVersionId] }),
  });

  const deleteMutation = useMutation({
    mutationFn: () => api.kpi.deleteCriterion(organization.organizationId, criterion.id),
    onSuccess: async () => {
      onDeleted();
      await queryClient.invalidateQueries({ queryKey: ["kpi-version", organization.organizationId, criterion.kpiVersionId] });
    },
  });

  const toggleSource = (source: EvidenceSource) => setSources((current) => current.includes(source) ? current.filter((item) => item !== source) : [...current, source]);
  const invalidDetails = !name.trim() || !Number.isFinite(maxScore) || maxScore <= 0 || maxScore > 10 || meaningfulDelta < 0 || meaningfulDelta > 10;
  const invalidRules = bands.length === 0 || bands.some((band) => !Number.isFinite(band.value) || !Number.isFinite(band.score) || band.score < 0 || band.score > maxScore) || (fallback.trim() !== "" && (!Number.isFinite(Number(fallback)) || Number(fallback) < 0 || Number(fallback) > maxScore));

  return <div className="space-y-4">
    <Panel className="p-5">
      <div className="flex items-start justify-between gap-4">
        <div><h2 className="font-semibold text-slate-950">Criterion configuration</h2><p className="mt-1 text-xs text-slate-500">Changes are saved through the authenticated KPI API and remain period/version reproducible.</p></div>
        {mutable && <button disabled={deleteMutation.isPending} onClick={() => deleteMutation.mutate()} className="flex items-center gap-1.5 text-xs font-semibold text-rose-600 disabled:opacity-50"><Trash2 size={14}/> Delete</button>}
      </div>
      <div className="mt-4 grid gap-3 sm:grid-cols-[1fr_130px]">
        <div><label className="text-xs font-semibold">Criterion name</label><input disabled={!mutable} value={name} onChange={(event) => setName(event.target.value)} maxLength={160} className="mt-1.5 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm disabled:bg-slate-50 disabled:text-slate-500"/></div>
        <div><label className="text-xs font-semibold">Maximum score</label><input disabled={!mutable} type="number" step="0.1" min="0.1" max="10" value={maxScore} onChange={(event) => setMaxScore(Number(event.target.value))} className="mt-1.5 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm disabled:bg-slate-50"/></div>
      </div>
      <div className="mt-3"><label className="text-xs font-semibold">Description</label><textarea disabled={!mutable} value={description} onChange={(event) => setDescription(event.target.value)} rows={2} maxLength={2000} className="mt-1.5 w-full resize-none rounded-lg border border-slate-200 px-3 py-2 text-sm disabled:bg-slate-50"/></div>
      <div className="mt-4 grid gap-2 sm:grid-cols-3">{(["AUTO", "ASSISTED", "MANUAL"] as const).map((value) => <button disabled={!mutable} key={value} onClick={() => setMethod(value)} className={`rounded-lg border p-3 text-left disabled:cursor-not-allowed ${method === value ? "border-blue-400 bg-blue-50" : "border-slate-200"}`}><div className="text-xs font-bold">{value}</div><div className="mt-1 text-[10px] leading-4 text-slate-500">{value === "AUTO" ? "Metric → deterministic rule":value === "ASSISTED" ? "Suggested score → human review":"Evidence → human score"}</div></button>)}</div>
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <label className="flex items-center gap-2 rounded-lg border border-slate-200 p-3 text-xs"><input disabled={!mutable} type="checkbox" checked={reviewRequired} onChange={(event) => setReviewRequired(event.target.checked)}/><span><b>Review required</b><span className="block text-[10px] text-slate-500">Keep a human checkpoint visible.</span></span></label>
        <label className="flex items-center gap-2 rounded-lg border border-slate-200 p-3 text-xs"><input disabled={!mutable} type="checkbox" checked={requiredEvidence} onChange={(event) => setRequiredEvidence(event.target.checked)}/><span><b>Evidence required</b><span className="block text-[10px] text-slate-500">Submission requires a source.</span></span></label>
      </div>
      <div className="mt-4"><div className="text-xs font-semibold">Evidence sources</div><div className="mt-2 flex flex-wrap gap-2">{evidenceSources.map((source) => <label key={source.value} className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-xs ${sources.includes(source.value) ? "border-blue-300 bg-blue-50 text-blue-800" : "border-slate-200"}`}><input disabled={!mutable} type="checkbox" checked={sources.includes(source.value)} onChange={() => toggleSource(source.value)}/>{source.label}</label>)}</div></div>
      <div className="mt-4 max-w-xs"><label className="text-xs font-semibold">Meaningful adjustment delta</label><input disabled={!mutable} type="number" min="0" max="10" step="0.1" value={meaningfulDelta} onChange={(event) => setMeaningfulDelta(Number(event.target.value))} className="mt-1.5 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm disabled:bg-slate-50"/></div>
      {mutable && <button disabled={detailMutation.isPending || invalidDetails} onClick={() => detailMutation.mutate()} className="mt-5 flex items-center gap-2 rounded-lg bg-slate-950 px-3.5 py-2 text-xs font-semibold text-white disabled:opacity-50">{detailMutation.isPending ? <LoaderCircle size={14} className="animate-spin"/> : <Save size={14}/>} Save criterion</button>}
      <InlineError error={detailMutation.error || deleteMutation.error}/><SuccessHint show={detailMutation.isSuccess}>Criterion saved to the selected KPI version.</SuccessHint>
    </Panel>

    {method !== "MANUAL" && <Panel className="p-5">
      <div className="flex items-start justify-between"><div><h3 className="text-sm font-semibold">Metric configuration</h3><p className="mt-1 text-xs text-slate-500">Select a persisted organization metric. Existing parameter JSON is preserved.</p></div>{criterion.metricConfiguration && <StatusBadge>{criterion.metricConfiguration.metricKey}</StatusBadge>}</div>
      {metrics.length === 0 ? <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">No active metric definitions are available. Add one through the Metric Library API before submission.</div> : <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-end"><div className="flex-1"><label className="text-xs font-semibold">Metric definition</label><select disabled={!mutable} value={metricDefinitionId} onChange={(event) => setMetricDefinitionId(event.target.value)} className="mt-1.5 w-full rounded-lg border border-slate-200 bg-white p-2.5 text-sm disabled:bg-slate-50">{metrics.map((metric) => <option key={metric.id} value={metric.id}>{metric.name} · {metric.key}</option>)}</select></div>{mutable && <button disabled={metricMutation.isPending || !metricDefinitionId} onClick={() => metricMutation.mutate()} className="flex items-center gap-2 rounded-lg bg-blue-600 px-3.5 py-2.5 text-xs font-semibold text-white disabled:opacity-50">{metricMutation.isPending ? <LoaderCircle size={14} className="animate-spin"/> : <Save size={14}/>} Save metric</button>}</div>}
      <InlineError error={metricMutation.error}/><SuccessHint show={metricMutation.isSuccess}>Metric configuration persisted.</SuccessHint>
    </Panel>}

    {method !== "MANUAL" && <Panel className="p-5">
      <div className="flex items-start justify-between gap-3"><div><h3 className="text-sm font-semibold">Threshold scoring rule</h3><p className="mt-1 text-xs text-slate-500">Edit the threshold rule without discarding RANGE / FORMULA / HYBRID rules already stored on this criterion.</p></div><StatusBadge>{criterion.rules.length} rules</StatusBadge></div>
      <div className="mt-4 space-y-2">{bands.map((band, index) => <div key={index} className="grid grid-cols-[72px_minmax(0,1fr)_24px_minmax(0,1fr)_34px] items-center gap-2">
        <select disabled={!mutable} value={band.operator} onChange={(event) => setBands((rows) => rows.map((row, rowIndex) => rowIndex === index ? { ...row, operator: event.target.value as ComparisonOperator } : row))} className="rounded-lg border border-slate-200 p-2 text-xs disabled:bg-slate-50">{operators.map((operator) => <option key={operator}>{operator}</option>)}</select>
        <input disabled={!mutable} type="number" value={band.value} onChange={(event) => setBands((rows) => rows.map((row, rowIndex) => rowIndex === index ? { ...row, value: Number(event.target.value) } : row))} className="rounded-lg border border-slate-200 px-3 py-2 text-sm disabled:bg-slate-50"/>
        <ChevronRight size={15} className="text-slate-300"/>
        <input disabled={!mutable} type="number" min="0" max={maxScore} step="0.1" value={band.score} onChange={(event) => setBands((rows) => rows.map((row, rowIndex) => rowIndex === index ? { ...row, score: Number(event.target.value) } : row))} className="rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-sm font-semibold text-blue-800 disabled:bg-slate-50"/>
        {mutable ? <button disabled={bands.length <= 1} onClick={() => setBands((rows) => rows.filter((_, rowIndex) => rowIndex !== index))} className="grid h-8 w-8 place-items-center rounded-md border border-slate-200 text-slate-400 disabled:opacity-30"><Trash2 size={13}/></button> : <span/>}
      </div>)}</div>
      {mutable && <button onClick={() => setBands((rows) => [...rows, { operator: ">=", value: 0, score: 0 }])} className="mt-3 flex items-center gap-1.5 text-xs font-semibold text-blue-700"><Plus size={13}/> Add threshold band</button>}
      <div className="mt-4 max-w-xs"><label className="text-xs font-semibold">Fallback score <span className="font-normal text-slate-400">(blank = review/not evaluated)</span></label><input disabled={!mutable} value={fallback} onChange={(event) => setFallback(event.target.value)} type="number" min="0" max={maxScore} step="0.1" className="mt-1.5 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm disabled:bg-slate-50"/></div>
      {mutable && <button disabled={ruleMutation.isPending || invalidRules} onClick={() => ruleMutation.mutate()} className="mt-5 flex items-center gap-2 rounded-lg bg-blue-600 px-3.5 py-2 text-xs font-semibold text-white disabled:opacity-50">{ruleMutation.isPending ? <LoaderCircle size={14} className="animate-spin"/> : <Save size={14}/>} Save scoring rules</button>}
      <InlineError error={ruleMutation.error}/><SuccessHint show={ruleMutation.isSuccess}>Scoring rules persisted and revalidated server-side.</SuccessHint>
    </Panel>}
  </div>;
}

export default function PersistedKpiBuilder({ organization, selectedTemplateId, onTemplateChange }: BuilderProps) {
  const queryClient = useQueryClient();
  const [selectedVersionId, setSelectedVersionId] = useState<string | null>(null);
  const [selectedCriterionId, setSelectedCriterionId] = useState<string | null>(null);
  const canRead = organization.role !== "MEMBER";

  const templatesQuery = useQuery({
    queryKey: ["kpi-templates", organization.organizationId],
    queryFn: () => api.organizations.templates(organization.organizationId),
    enabled: canRead,
  });
  const templates = templatesQuery.data ?? [];
  const activeTemplateId = selectedTemplateId && templates.some((item) => item.id === selectedTemplateId) ? selectedTemplateId : templates[0]?.id ?? null;
  const activeTemplate = templates.find((item) => item.id === activeTemplateId) ?? null;

  const versionsQuery = useQuery({
    queryKey: ["kpi-versions", organization.organizationId, activeTemplateId],
    queryFn: () => api.kpi.versions(organization.organizationId, activeTemplateId!),
    enabled: Boolean(activeTemplateId),
  });
  const versions = versionsQuery.data ?? [];
  const activeVersionId = selectedVersionId && versions.some((item) => item.id === selectedVersionId) ? selectedVersionId : versions[0]?.id ?? null;

  const detailQuery = useQuery({
    queryKey: ["kpi-version", organization.organizationId, activeVersionId],
    queryFn: () => api.kpi.version(organization.organizationId, activeVersionId!),
    enabled: Boolean(activeVersionId),
  });
  const metricsQuery = useQuery({
    queryKey: ["kpi-metrics", organization.organizationId],
    queryFn: () => api.kpi.metrics(organization.organizationId),
    enabled: canRead,
  });

  const detail = detailQuery.data;
  const criteria = detail?.criteria ?? [];
  const activeCriterion = criteria.find((item) => item.id === selectedCriterionId) ?? criteria[0] ?? null;
  const total = Number(detail?.totalMaxScore ?? 0);
  const versionMutable = Boolean(detail && detail.status === "DRAFT" && !detail.submittedAt && canManage(organization.role));

  const createVersion = useMutation({
    mutationFn: () => api.kpi.createVersion(organization.organizationId, activeTemplateId!, activeVersionId),
    onSuccess: async (created) => {
      setSelectedVersionId(created.id);
      setSelectedCriterionId(null);
      await queryClient.invalidateQueries({ queryKey: ["kpi-versions", organization.organizationId, activeTemplateId] });
    },
  });

  const addCriterion = useMutation({
    mutationFn: () => {
      const nextScore = nextCriterionMaxScore(total);
      if (nextScore === null) throw new Error("KPI maximum is already 10. Reduce an existing criterion before adding another one.");
      const input: CriterionInput = {
        name: `Criterion ${criteria.length + 1}`,
        description: "Describe the management intent and evidence expected for this criterion.",
        position: criteria.length,
        maxScore: nextScore,
        method: "ASSISTED",
        evidencePolicy: { sources: ["MANUAL"] },
        reviewRequired: true,
        requiredEvidence: true,
        adjustmentPolicy: { meaningfulDelta: 0.3 },
      };
      return api.kpi.addCriterion(organization.organizationId, detail!.id, input);
    },
    onSuccess: async (created) => {
      setSelectedCriterionId(created.id);
      await queryClient.invalidateQueries({ queryKey: ["kpi-version", organization.organizationId, detail!.id] });
      await queryClient.invalidateQueries({ queryKey: ["kpi-versions", organization.organizationId, activeTemplateId] });
    },
  });

  const lifecycle = useMutation({
    mutationFn: (action: "SUBMIT" | "APPROVE" | "PUBLISH" | "RETIRE") => api.kpi.lifecycle(organization.organizationId, detail!.id, action),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["kpi-version", organization.organizationId, detail!.id] }),
        queryClient.invalidateQueries({ queryKey: ["kpi-versions", organization.organizationId, activeTemplateId] }),
      ]);
    },
  });

  const lifecycleAction = useMemo(() => {
    if (!detail) return null;
    if (detail.status === "PUBLISHED" && !detail.retiredAt && canManage(organization.role)) return { action: "RETIRE" as const, label: "Retire version" };
    if (detail.status !== "DRAFT") return null;
    if (!detail.submittedAt && canManage(organization.role)) return { action: "SUBMIT" as const, label: "Submit for approval" };
    if (detail.submittedAt && !detail.approvedAt && canApprove(organization.role)) return { action: "APPROVE" as const, label: "Approve version" };
    if (detail.approvedAt && !detail.publishedAt && canManage(organization.role)) return { action: "PUBLISH" as const, label: "Publish version" };
    return null;
  }, [detail, organization.role]);

  if (!canRead) return <Panel className="p-8"><div className="flex items-start gap-3"><LockKeyhole size={20} className="mt-0.5 text-slate-500"/><div><h2 className="font-semibold">KPI configuration access is restricted</h2><p className="mt-1 text-sm text-slate-500">Your {roleLabel(organization.role)} organization role does not grant KPI configuration access.</p></div></div></Panel>;
  if (templatesQuery.isPending) return <Panel className="p-8"><div className="flex items-center justify-center gap-2 text-sm text-slate-500"><LoaderCircle size={16} className="animate-spin"/> Loading KPI templates…</div></Panel>;
  if (templatesQuery.error) return <Panel className="border-rose-200 p-6"><InlineError error={templatesQuery.error}/></Panel>;
  if (!templates.length) return <Panel className="p-8 text-center"><div className="text-sm font-semibold">No KPI templates available</div><p className="mt-1 text-xs text-slate-500">Create a persistent KPI template first, then open its builder.</p></Panel>;

  return <div className="-m-3 flex min-h-[calc(100vh-65px)] flex-col sm:-m-5 xl:-m-7 xl:h-[calc(100vh-65px)] xl:overflow-hidden">
    <div className="border-b border-slate-200 bg-white px-3 py-3 sm:px-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 flex-wrap items-center gap-2 sm:gap-3">
          <select aria-label="KPI template" value={activeTemplateId ?? ""} onChange={(event) => { setSelectedVersionId(null); setSelectedCriterionId(null); onTemplateChange(event.target.value); }} className="max-w-64 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold">{templates.map((template: KpiTemplateDto) => <option key={template.id} value={template.id}>{template.name}</option>)}</select>
          {versionsQuery.isPending ? <span className="text-xs text-slate-400">Loading versions…</span> : versions.length > 0 && <select aria-label="KPI version" value={activeVersionId ?? ""} onChange={(event) => { setSelectedVersionId(event.target.value); setSelectedCriterionId(null); }} className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold">{versions.map((version) => <option key={version.id} value={version.id}>v{version.version} · {version.status}{version.submittedAt && version.status === "DRAFT" ? " · submitted" : ""}</option>)}</select>}
          {detail && <StatusBadge>{detail.status}{detail.submittedAt && detail.status === "DRAFT" ? " · frozen" : ""}</StatusBadge>}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {detail && <div className={`rounded-lg px-3 py-2 text-xs font-bold ${Math.abs(total - 10) < 0.001 ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700"}`}>Total {total.toFixed(1)} / 10</div>}
          {canManage(organization.role) && activeTemplateId && activeVersionId && <button disabled={createVersion.isPending} onClick={() => createVersion.mutate()} className="flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-2 text-xs font-semibold disabled:opacity-50">{createVersion.isPending ? <LoaderCircle size={14} className="animate-spin"/> : <CopyPlus size={14}/>} New draft</button>}
          {lifecycleAction && <button disabled={lifecycle.isPending} onClick={() => lifecycle.mutate(lifecycleAction.action)} className="flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-2 text-xs font-semibold text-white disabled:opacity-50">{lifecycle.isPending && <LoaderCircle size={14} className="animate-spin"/>}{lifecycleAction.label}</button>}
        </div>
      </div>
      <div className="mt-2 flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between sm:gap-3"><p className="truncate text-[11px] text-slate-500">{activeTemplate?.description || "Authenticated, organization-scoped versioned KPI configuration."}</p><span className="shrink-0 text-[10px] font-semibold text-slate-400">Authority: protected API + PostgreSQL</span></div>
      <InlineError error={createVersion.error || lifecycle.error}/>
    </div>

    {versionsQuery.error ? <div className="p-6"><Panel className="border-rose-200 p-5"><InlineError error={versionsQuery.error}/></Panel></div> : !versionsQuery.isPending && versions.length === 0 ? <div className="p-6"><Panel className="p-8 text-center"><h2 className="font-semibold">No KPI version exists</h2><p className="mt-1 text-xs text-slate-500">Create a draft version to begin configuration.</p>{canManage(organization.role) && <button disabled={createVersion.isPending} onClick={() => createVersion.mutate()} className="mt-4 rounded-lg bg-slate-950 px-4 py-2 text-xs font-semibold text-white">Create first draft</button>}</Panel></div> : detailQuery.isPending ? <div className="grid flex-1 place-items-center"><div className="flex items-center gap-2 text-sm text-slate-500"><LoaderCircle size={16} className="animate-spin"/> Loading version configuration…</div></div> : detailQuery.error ? <div className="p-6"><Panel className="border-rose-200 p-5"><InlineError error={detailQuery.error}/></Panel></div> : detail && <div className="grid min-h-0 flex-1 grid-cols-1 bg-slate-100 xl:grid-cols-[260px_minmax(520px,1fr)_300px]">
      <aside className="kpi-scroll border-b border-slate-200 bg-white p-3 xl:overflow-y-auto xl:border-b-0 xl:border-r">
        <div className="mb-2 flex items-center justify-between px-1"><span className="text-[11px] font-bold uppercase tracking-wide text-slate-400">Criteria</span>{versionMutable && total < 10 && <button disabled={addCriterion.isPending} onClick={() => addCriterion.mutate()} className="rounded-md p-1 hover:bg-slate-100 disabled:opacity-50">{addCriterion.isPending ? <LoaderCircle size={15} className="animate-spin"/> : <Plus size={15}/>}</button>}</div>
        <div className="space-y-1.5">{criteria.map((criterion, index) => <button key={criterion.id} onClick={() => setSelectedCriterionId(criterion.id)} className={`w-full rounded-lg border p-3 text-left ${activeCriterion?.id === criterion.id ? "border-blue-300 bg-blue-50/70" : "border-transparent hover:bg-slate-50"}`}><div className="flex gap-2"><span className="text-[10px] font-bold text-slate-400">{String(index + 1).padStart(2, "0")}</span><div className="min-w-0 flex-1"><div className="truncate text-xs font-semibold">{criterion.name}</div><div className="mt-1 flex items-center justify-between"><span className="text-[10px] text-slate-500">{criterion.method}</span><span className="text-[10px] font-semibold">{Number(criterion.maxScore).toFixed(1)} pt</span></div></div></div></button>)}</div>
        {criteria.length === 0 && <div className="rounded-lg border border-dashed border-slate-200 p-4 text-center text-xs text-slate-400">No criteria configured.</div>}
        <InlineError error={addCriterion.error}/>
      </aside>

      <main className="kpi-scroll min-w-0 p-3 sm:p-5 xl:overflow-y-auto">
        <div className="mx-auto max-w-3xl">{activeCriterion ? <CriterionEditor
          key={`${activeCriterion.id}:${activeCriterion.updatedAt}:${activeCriterion.metricConfiguration?.metricDefinitionId ?? "none"}:${activeCriterion.rules.map((rule) => rule.id).join(",")}`}
          organization={organization}
          criterion={activeCriterion}
          metrics={metricsQuery.data ?? []}
          mutable={versionMutable}
          onDeleted={() => setSelectedCriterionId(null)}
        /> : <Panel className="p-8 text-center"><div className="text-sm font-semibold">No criterion selected</div><p className="mt-1 text-xs text-slate-500">{versionMutable ? "Add the first criterion to this draft version." : "This version contains no criterion configuration."}</p></Panel>}</div>
      </main>

      <aside className="kpi-scroll border-t border-slate-200 bg-white p-4 xl:overflow-y-auto xl:border-l xl:border-t-0">
        <div><h3 className="text-sm font-semibold">Version integrity</h3><p className="mt-1 text-[10px] leading-4 text-slate-500">The server validates exact score totals, required metric/rule/evidence configuration, lifecycle order and submitted immutability.</p></div>
        <div className="mt-4 space-y-2">
          <div className={`rounded-lg border p-3 ${Math.abs(total - 10) < 0.001 ? "border-emerald-200 bg-emerald-50" : "border-amber-200 bg-amber-50"}`}><div className="text-[9px] font-bold uppercase tracking-wide text-slate-400">Configured maximum</div><div className="mt-1 text-lg font-semibold">{total.toFixed(1)} / 10</div></div>
          <div className="rounded-lg border border-slate-200 p-3"><div className="text-[9px] font-bold uppercase tracking-wide text-slate-400">Lifecycle</div><div className="mt-1 text-xs font-semibold">{detail.submittedAt ? "Submitted" : "Editable draft"} → {detail.approvedAt ? "Approved" : "Approval pending"} → {detail.publishedAt ? "Published" : "Not published"}</div></div>
          <div className="rounded-lg border border-slate-200 p-3"><div className="text-[9px] font-bold uppercase tracking-wide text-slate-400">Access</div><div className="mt-1 text-xs font-semibold">{roleLabel(organization.role)}</div><div className="mt-1 text-[10px] text-slate-500">{versionMutable ? "Configuration writes enabled" : detail.submittedAt ? "Configuration frozen" : "Read-only for this role"}</div></div>
        </div>
        {!versionMutable && detail.submittedAt && <div className="mt-4 flex gap-2 rounded-lg border border-blue-200 bg-blue-50 p-3 text-xs leading-5 text-blue-800"><LockKeyhole size={14} className="mt-0.5 shrink-0"/><span>Submitted configuration is immutable. Use <b>New draft</b> to clone this version before changing criteria.</span></div>}
        {metricsQuery.error && <InlineError error={metricsQuery.error}/>}
        <div className="mt-5 rounded-lg border border-emerald-200 bg-emerald-50 p-3"><div className="flex gap-2"><CheckCircle2 size={15} className="mt-0.5 text-emerald-600"/><div><div className="text-xs font-semibold text-emerald-800">No seeded builder authority</div><div className="mt-1 text-[10px] leading-4 text-emerald-700">Template, version, criterion, metric, scoring and lifecycle state on this screen are loaded from protected APIs. Local form state is only an unsaved edit buffer.</div></div></div></div>
      </aside>
    </div>}
  </div>;
}
