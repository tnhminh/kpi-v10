"use client";

import { useMemo, useState } from "react";
import { useMutation, useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, CalendarRange, CheckCircle2, LoaderCircle, Play, Plus, ShieldAlert, Users } from "lucide-react";
import { api, ClientApiError, type KpiLifecycleStatus, type OrganizationAccess } from "@/client/api";

function Card({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <section className={`rounded-xl border border-slate-200 bg-white shadow-[0_1px_2px_rgba(15,23,42,.04)] ${className}`}>{children}</section>;
}

function errorMessage(error: unknown) {
  return error instanceof ClientApiError ? error.message : error instanceof Error ? error.message : "The request could not be completed.";
}

function Status({ value }: { value: string }) {
  const tone = value === "LOCKED" || value === "FINALIZED" || value === "SYSTEM_EVALUATED"
    ? "bg-emerald-50 text-emerald-700 ring-emerald-200"
    : value === "COLLECTING" || value === "PUBLISHED" || value === "IN_USE"
      ? "bg-blue-50 text-blue-700 ring-blue-200"
      : value === "CRITICAL" || value === "LOW"
        ? "bg-rose-50 text-rose-700 ring-rose-200"
        : value === "REVIEW_REQUIRED" || value.includes("REVIEW")
          ? "bg-violet-50 text-violet-700 ring-violet-200"
          : "bg-amber-50 text-amber-700 ring-amber-200";
  return <span className={`inline-flex rounded-md px-2 py-1 text-[10px] font-bold ring-1 ring-inset ${tone}`}>{value.replaceAll("_", " ")}</span>;
}

function Header({ eyebrow, title, subtitle, action }: { eyebrow: string; title: string; subtitle: string; action?: React.ReactNode }) {
  return <div className="mb-5 flex items-start justify-between gap-4"><div><div className="mb-1 text-[11px] font-bold uppercase tracking-[.12em] text-blue-600">{eyebrow}</div><h1 className="text-[24px] font-semibold tracking-tight text-slate-950">{title}</h1><p className="mt-1 max-w-3xl text-sm text-slate-500">{subtitle}</p></div>{action}</div>;
}

function canManage(role: OrganizationAccess["role"]) { return role === "ADMINISTRATOR"; }
function canRun(role: OrganizationAccess["role"]) { return role === "ADMINISTRATOR" || role === "DEPARTMENT_HEAD"; }

export function EvaluationPeriodsWorkspace({ organization }: { organization: OrganizationAccess }) {
  const queryClient = useQueryClient();
  const [selectedPeriodId, setSelectedPeriodId] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [showAssignments, setShowAssignments] = useState(false);
  const [key, setKey] = useState("");
  const [startsOn, setStartsOn] = useState("");
  const [endsOn, setEndsOn] = useState("");
  const [rankSchemeId, setRankSchemeId] = useState("");
  const [assignmentDraft, setAssignmentDraft] = useState<Record<string, string>>({});

  const periodsQuery = useQuery({ queryKey: ["evaluation-periods", organization.organizationId], queryFn: () => api.evaluation.periods(organization.organizationId) });
  const periods = periodsQuery.data ?? [];
  const activePeriod = periods.find((period) => period.id === selectedPeriodId) ?? periods[0] ?? null;
  const runAllowed = canRun(organization.role);
  const manageAllowed = canManage(organization.role);

  const assignmentsQuery = useQuery({
    queryKey: ["evaluation-assignments", organization.organizationId, activePeriod?.id],
    queryFn: () => api.evaluation.assignments(organization.organizationId, activePeriod!.id),
    enabled: Boolean(activePeriod && runAllowed),
  });
  const teamsQuery = useQuery({ queryKey: ["teams", organization.organizationId], queryFn: () => api.organizations.teams(organization.organizationId), enabled: manageAllowed });
  const templatesQuery = useQuery({ queryKey: ["kpi-templates", organization.organizationId], queryFn: () => api.organizations.templates(organization.organizationId), enabled: manageAllowed });
  const rankSchemesQuery = useQuery({ queryKey: ["rank-schemes", organization.organizationId], queryFn: () => api.kpi.rankSchemes(organization.organizationId), enabled: manageAllowed });
  const versionQueries = useQueries({
    queries: (templatesQuery.data ?? []).map((template) => ({
      queryKey: ["kpi-versions", organization.organizationId, template.id],
      queryFn: () => api.kpi.versions(organization.organizationId, template.id),
      enabled: manageAllowed,
    })),
  });
  const assignableVersions = useMemo(() => (templatesQuery.data ?? []).flatMap((template, index) =>
    (versionQueries[index]?.data ?? []).filter((version) => version.status === "PUBLISHED" || version.status === "IN_USE").map((version) => ({
      id: version.id,
      label: `${template.name} · v${version.version}`,
      status: version.status as KpiLifecycleStatus,
    }))), [templatesQuery.data, versionQueries]);

  const createMutation = useMutation({
    mutationFn: () => api.evaluation.createPeriod(organization.organizationId, { key: key.trim(), startsOn, endsOn, rankSchemeId: rankSchemeId || null }),
    onSuccess: async (created) => {
      await queryClient.invalidateQueries({ queryKey: ["evaluation-periods", organization.organizationId] });
      setSelectedPeriodId(created.id); setShowCreate(false); setKey(""); setStartsOn(""); setEndsOn(""); setRankSchemeId("");
    },
  });
  const assignmentMutation = useMutation({
    mutationFn: () => api.evaluation.replaceAssignments(organization.organizationId, activePeriod!.id,
      Object.entries(assignmentDraft).filter(([, versionId]) => Boolean(versionId)).map(([teamId, kpiVersionId]) => ({ teamId, kpiVersionId }))),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["evaluation-assignments", organization.organizationId, activePeriod?.id] });
      setShowAssignments(false);
    },
  });
  const startMutation = useMutation({
    mutationFn: () => api.evaluation.startCollection(organization.organizationId, activePeriod!.id),
    onSuccess: async () => queryClient.invalidateQueries({ queryKey: ["evaluation-periods", organization.organizationId] }),
  });

  const openAssignments = () => {
    const existing = Object.fromEntries((assignmentsQuery.data ?? []).map((assignment) => [assignment.teamId, assignment.kpiVersionId]));
    setAssignmentDraft(existing);
    setShowAssignments(true);
  };

  return <div>
    <Header eyebrow="Evaluation" title="Evaluation periods" subtitle="Period lifecycle, effective team membership and KPI-version assignments are persisted and resolved server-side." action={manageAllowed ? <button onClick={() => setShowCreate(true)} className="flex items-center gap-2 rounded-lg bg-slate-950 px-3.5 py-2 text-sm font-semibold text-white"><Plus size={15}/> Create period</button> : undefined}/>
    {periodsQuery.isPending ? <Card className="p-8 text-center text-sm text-slate-500"><LoaderCircle size={16} className="mr-2 inline animate-spin"/>Loading evaluation periods…</Card> : periodsQuery.error ? <Card className="border-rose-200 p-5 text-sm text-rose-700">{errorMessage(periodsQuery.error)}</Card> : periods.length === 0 ? <Card className="p-10 text-center"><CalendarRange size={28} className="mx-auto text-slate-300"/><div className="mt-3 font-semibold">No evaluation periods yet</div><div className="mt-1 text-xs text-slate-500">Create a period, assign each team a published KPI version, then start collection.</div></Card> : <div className="grid grid-cols-[1.25fr_.75fr] gap-4">
      <Card><table className="w-full text-left text-xs"><thead className="bg-slate-50 text-slate-500"><tr>{["Period","Date range","Lifecycle","Integrity"].map((heading) => <th key={heading} className="px-4 py-2.5">{heading}</th>)}</tr></thead><tbody>{periods.map((period) => <tr key={period.id} onClick={() => setSelectedPeriodId(period.id)} className={`cursor-pointer border-t border-slate-100 ${activePeriod?.id === period.id ? "bg-blue-50/60" : "hover:bg-slate-50"}`}><td className="px-4 py-3 font-semibold">{period.key}</td><td className="px-4 py-3 text-slate-500">{period.startsOn} → {period.endsOn}</td><td className="px-4 py-3"><Status value={period.status}/></td><td className="px-4 py-3">{period.lockedAt ? "Immutable snapshot" : "Versioned"}</td></tr>)}</tbody></table></Card>
      <Card className="p-5">{activePeriod && <><div className="flex items-center justify-between"><div><div className="text-xs font-bold uppercase tracking-wide text-slate-400">Selected period</div><div className="mt-1 text-lg font-semibold">{activePeriod.key}</div></div><Status value={activePeriod.status}/></div><div className="mt-5 space-y-3 text-xs"><div className="flex justify-between border-b border-slate-100 pb-2"><span className="text-slate-500">KPI assignments</span><b>{assignmentsQuery.isPending ? "…" : assignmentsQuery.data?.length ?? "Restricted"}</b></div><div className="flex justify-between border-b border-slate-100 pb-2"><span className="text-slate-500">Rank scheme</span><b>{activePeriod.rankSchemeId ? (rankSchemesQuery.data?.find((scheme) => scheme.id === activePeriod.rankSchemeId)?.name ?? "Configured") : "None"}</b></div><div className="flex justify-between"><span className="text-slate-500">Lock state</span><b>{activePeriod.lockedAt ? "Locked" : "Open"}</b></div></div>{assignmentsQuery.data?.length ? <div className="mt-4 space-y-2">{assignmentsQuery.data.slice(0, 6).map((assignment) => <div key={assignment.id} className="flex items-center justify-between rounded-lg bg-slate-50 px-3 py-2 text-xs"><span className="font-semibold">{assignment.teamName}</span><span className="text-slate-500">{assignment.templateName} v{assignment.version}</span></div>)}</div> : null}<div className="mt-5 flex flex-wrap gap-2">{manageAllowed && activePeriod.status === "UPCOMING" && <button onClick={openAssignments} className="rounded-lg border border-slate-200 px-3 py-2 text-xs font-semibold">Configure assignments</button>}{runAllowed && activePeriod.status === "UPCOMING" && <button disabled={startMutation.isPending || !assignmentsQuery.data?.length} onClick={() => startMutation.mutate()} className="flex items-center gap-2 rounded-lg bg-blue-600 px-3 py-2 text-xs font-semibold text-white disabled:opacity-50">{startMutation.isPending ? <LoaderCircle size={13} className="animate-spin"/> : <Play size={13}/>} Start collection</button>}</div>{(startMutation.error || assignmentsQuery.error) && <div className="mt-3 rounded-lg bg-rose-50 p-3 text-xs text-rose-700">{errorMessage(startMutation.error ?? assignmentsQuery.error)}</div>}</>}</Card>
    </div>}

    {showCreate && <div className="fixed inset-0 z-50 grid place-items-center bg-slate-950/35 p-6"><Card className="w-full max-w-lg p-5"><div className="text-lg font-semibold">Create evaluation period</div><div className="mt-1 text-xs text-slate-500">Period configuration is immutable after collection begins.</div><div className="mt-4"><label className="text-xs font-semibold">Period key</label><input value={key} onChange={(event) => setKey(event.target.value)} placeholder="2026-10" className="mt-1.5 w-full rounded-lg border border-slate-200 px-3 py-2.5 text-sm"/></div><div className="mt-3 grid grid-cols-2 gap-3"><div><label className="text-xs font-semibold">Starts on</label><input type="date" value={startsOn} onChange={(event) => setStartsOn(event.target.value)} className="mt-1.5 w-full rounded-lg border border-slate-200 px-3 py-2.5 text-sm"/></div><div><label className="text-xs font-semibold">Ends on</label><input type="date" value={endsOn} onChange={(event) => setEndsOn(event.target.value)} className="mt-1.5 w-full rounded-lg border border-slate-200 px-3 py-2.5 text-sm"/></div></div><div className="mt-3"><label className="text-xs font-semibold">Rank scheme</label><select value={rankSchemeId} onChange={(event) => setRankSchemeId(event.target.value)} disabled={rankSchemesQuery.isPending} className="mt-1.5 w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm"><option value="">No rank scheme</option>{(rankSchemesQuery.data ?? []).filter((scheme) => scheme.active).map((scheme) => <option key={scheme.id} value={scheme.id}>{scheme.name}</option>)}</select><div className="mt-1 text-[10px] text-slate-400">Final rank/coefficient is resolved from this immutable period reference.</div></div>{rankSchemesQuery.error && <div className="mt-3 rounded-lg bg-rose-50 p-3 text-xs text-rose-700">{errorMessage(rankSchemesQuery.error)}</div>}{createMutation.error && <div className="mt-3 rounded-lg bg-rose-50 p-3 text-xs text-rose-700">{errorMessage(createMutation.error)}</div>}<div className="mt-5 flex justify-end gap-2"><button onClick={() => setShowCreate(false)} className="rounded-lg border border-slate-200 px-3 py-2 text-xs font-semibold">Cancel</button><button disabled={createMutation.isPending || !key.trim() || !startsOn || !endsOn} onClick={() => createMutation.mutate()} className="rounded-lg bg-slate-950 px-3 py-2 text-xs font-semibold text-white disabled:opacity-50">Create period</button></div></Card></div>}

    {showAssignments && activePeriod && <div className="fixed inset-0 z-50 grid place-items-center bg-slate-950/35 p-6"><Card className="max-h-[82vh] w-full max-w-2xl overflow-y-auto p-5"><div className="flex items-start justify-between"><div><div className="text-lg font-semibold">Team KPI assignments · {activePeriod.key}</div><div className="mt-1 text-xs text-slate-500">Every team is resolved to the exact published/in-use KPI version stored for this period.</div></div><Status value="UPCOMING"/></div>{assignableVersions.length === 0 && <div className="mt-4 flex gap-2 rounded-lg bg-amber-50 p-3 text-xs text-amber-800"><AlertTriangle size={15}/> Publish at least one KPI version before assigning teams.</div>}<div className="mt-4 space-y-2">{(teamsQuery.data ?? []).map((team) => <div key={team.id} className="grid grid-cols-[1fr_1.4fr] items-center gap-3 rounded-lg border border-slate-200 p-3"><div><div className="text-sm font-semibold">{team.name}</div><div className="text-[10px] text-slate-400">{team.departmentName}</div></div><select value={assignmentDraft[team.id] ?? ""} onChange={(event) => setAssignmentDraft((current) => ({ ...current, [team.id]: event.target.value }))} className="rounded-lg border border-slate-200 px-3 py-2 text-xs"><option value="">No assignment</option>{assignableVersions.map((version) => <option key={version.id} value={version.id}>{version.label} · {version.status}</option>)}</select></div>)}</div>{assignmentMutation.error && <div className="mt-3 rounded-lg bg-rose-50 p-3 text-xs text-rose-700">{errorMessage(assignmentMutation.error)}</div>}<div className="mt-5 flex justify-end gap-2"><button onClick={() => setShowAssignments(false)} className="rounded-lg border border-slate-200 px-3 py-2 text-xs font-semibold">Cancel</button><button disabled={assignmentMutation.isPending} onClick={() => assignmentMutation.mutate()} className="rounded-lg bg-blue-600 px-3 py-2 text-xs font-semibold text-white disabled:opacity-50">Save assignments</button></div></Card></div>}
  </div>;
}

export function SystemEvaluationWorkspace({ organization }: { organization: OrganizationAccess }) {
  const queryClient = useQueryClient();
  const runAllowed = canRun(organization.role);
  const [selectedPeriodId, setSelectedPeriodId] = useState<string | null>(null);
  const periodsQuery = useQuery({ queryKey: ["evaluation-periods", organization.organizationId], queryFn: () => api.evaluation.periods(organization.organizationId) });
  const periods = periodsQuery.data ?? [];
  const activePeriod = periods.find((period) => period.id === selectedPeriodId)
    ?? periods.find((period) => period.status === "COLLECTING")
    ?? periods.find((period) => period.status === "SYSTEM_EVALUATED")
    ?? periods[0]
    ?? null;
  const evaluationsQuery = useQuery({
    queryKey: ["period-evaluations", organization.organizationId, activePeriod?.id],
    queryFn: () => api.evaluation.evaluations(organization.organizationId, activePeriod!.id),
    enabled: Boolean(activePeriod && runAllowed),
  });
  const startMutation = useMutation({
    mutationFn: () => api.evaluation.startCollection(organization.organizationId, activePeriod!.id),
    onSuccess: async () => queryClient.invalidateQueries({ queryKey: ["evaluation-periods", organization.organizationId] }),
  });
  const jiraMutation = useMutation({
    mutationFn: () => api.evaluation.runJira(organization.organizationId, activePeriod!.id),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["evaluation-periods", organization.organizationId] }),
        queryClient.invalidateQueries({ queryKey: ["period-evaluations", organization.organizationId, activePeriod?.id] }),
      ]);
    },
  });
  const rows = evaluationsQuery.data ?? [];
  const scored = rows.filter((row) => row.systemScore !== null).length;
  const reviewRequired = rows.filter((row) => row.confidence === "REVIEW_REQUIRED" || row.qualityIssues.some((issue) => issue.severity === "CRITICAL")).length;
  const stages = ["Resolve member", "Resolve primary team", "Resolve KPI version", "Collect inputs", "Build metric", "Apply rules", "Persist evidence", "Suggested KPI"];

  return <div>
    <Header eyebrow="Evaluation" title="System evaluation pipeline" subtitle="Server-authoritative period resolution and deterministic scoring. Missing or critical data remains NOT_EVALUATED rather than becoming zero." action={activePeriod ? <div className="flex items-center gap-2"><select value={activePeriod.id} onChange={(event) => setSelectedPeriodId(event.target.value)} className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold">{periods.map((period) => <option key={period.id} value={period.id}>{period.key} · {period.status.replaceAll("_", " ")}</option>)}</select>{runAllowed && activePeriod.status === "UPCOMING" && <button disabled={startMutation.isPending} onClick={() => startMutation.mutate()} className="flex items-center gap-2 rounded-lg bg-blue-600 px-3.5 py-2 text-sm font-semibold text-white"><Play size={15}/> Start collection</button>}{runAllowed && (activePeriod.status === "COLLECTING" || activePeriod.status === "SYSTEM_EVALUATED") && <button disabled={jiraMutation.isPending} onClick={() => jiraMutation.mutate()} className="flex items-center gap-2 rounded-lg bg-slate-950 px-3.5 py-2 text-sm font-semibold text-white disabled:opacity-60">{jiraMutation.isPending ? <LoaderCircle size={15} className="animate-spin"/> : <Play size={15}/>} Run Jira evaluation</button>}</div> : undefined}/>
    {!runAllowed && <Card className="mb-4 border-amber-200 p-4"><div className="flex gap-3"><ShieldAlert size={18} className="text-amber-600"/><div><div className="text-sm font-semibold">Department evaluation access required</div><div className="mt-1 text-xs text-slate-500">System evaluation results are restricted to Department Head and Administrator at this stage.</div></div></div></Card>}
    {runAllowed && activePeriod && (activePeriod.status === "COLLECTING" || activePeriod.status === "SYSTEM_EVALUATED") && <Card className="mb-4 border-blue-200 bg-blue-50/40 p-4"><div className="flex gap-3"><ShieldAlert size={18} className="text-blue-600"/><div><div className="text-sm font-semibold">Trusted input boundary</div><div className="mt-1 text-xs text-slate-600">This workspace reads persisted system results and can run AUTO/ASSISTED metrics directly from server-owned Jira facts. The first Jira-backed evaluation freezes its exact contributing issue facts; later reruns reuse that immutable snapshot, and human review blocks silent recalculation.</div></div></div></Card>}
    {activePeriod ? <><Card className="p-5"><div className="flex items-center justify-between gap-2">{stages.map((stage, index) => <div key={stage} className="flex flex-1 items-center"><div className="min-w-0 flex-1 rounded-lg border border-emerald-200 bg-emerald-50 p-2.5 text-center"><CheckCircle2 size={14} className="mx-auto text-emerald-600"/><div className="mt-1 truncate text-[10px] font-semibold text-emerald-800">{stage}</div></div>{index < stages.length - 1 && <div className="mx-1 h-px w-3 bg-slate-200"/>}</div>)}</div></Card><div className="mt-4 grid grid-cols-4 gap-3"><Card className="p-4"><div className="text-xs text-slate-500">Period</div><div className="mt-2 text-xl font-semibold">{activePeriod.key}</div><div className="mt-1"><Status value={activePeriod.status}/></div></Card><Card className="p-4"><div className="text-xs text-slate-500">Persisted evaluations</div><div className="mt-2 text-xl font-semibold">{rows.length}</div><div className="mt-1 text-[10px] text-slate-400">Exact team + KPI version stored</div></Card><Card className="p-4"><div className="text-xs text-slate-500">System-scored</div><div className="mt-2 text-xl font-semibold">{scored}</div><div className="mt-1 text-[10px] text-slate-400">Full criterion coverage only</div></Card><Card className="p-4"><div className="text-xs text-slate-500">Needs review</div><div className="mt-2 text-xl font-semibold">{reviewRequired}</div><div className="mt-1 text-[10px] text-slate-400">Critical/missing input is never zero</div></Card></div>
      {evaluationsQuery.isPending && runAllowed ? <Card className="mt-4 p-8 text-center text-sm text-slate-500"><LoaderCircle size={16} className="mr-2 inline animate-spin"/>Loading persisted evaluations…</Card> : evaluationsQuery.error ? <Card className="mt-4 border-rose-200 p-4 text-xs text-rose-700">{errorMessage(evaluationsQuery.error)}</Card> : runAllowed ? <Card className="mt-4">{rows.length === 0 ? <div className="p-10 text-center"><Users size={28} className="mx-auto text-slate-300"/><div className="mt-3 text-sm font-semibold">No system evaluations persisted yet</div><div className="mt-1 text-xs text-slate-500">Run the pipeline after collection starts. Until T08 Jira is connected, missing source inputs correctly produce review-required results.</div></div> : <div className="overflow-x-auto"><table className="w-full text-left text-xs"><thead className="bg-slate-50 text-slate-500"><tr>{["Member","Team","KPI Version","Coverage","Quality","Confidence","Suggested KPI","Status"].map((heading) => <th key={heading} className="px-4 py-2.5">{heading}</th>)}</tr></thead><tbody>{rows.map((row) => <tr key={row.id} className="border-t border-slate-100"><td className="px-4 py-3"><div className="font-semibold">{row.memberName}</div><div className="text-[10px] text-slate-400">{row.employeeId}</div></td><td className="px-4 py-3">{row.teamName}</td><td className="px-4 py-3 text-blue-700">{row.templateName} · v{row.version}</td><td className="px-4 py-3">{row.criteria.filter((criterion) => criterion.systemScore !== null).length}/{row.criteria.length}</td><td className="px-4 py-3">{row.qualityIssues.length ? <span className="inline-flex items-center gap-1 text-amber-700"><AlertTriangle size={12}/>{row.qualityIssues.length} issue(s)</span> : <span className="text-emerald-700">Complete</span>}</td><td className="px-4 py-3"><Status value={row.confidence}/></td><td className="px-4 py-3 font-semibold">{row.systemScore === null ? "NOT EVALUATED" : row.systemScore.toFixed(2)}</td><td className="px-4 py-3"><Status value={row.status}/></td></tr>)}</tbody></table></div>}</Card> : null}
      {startMutation.error && <Card className="mt-4 border-rose-200 p-4 text-xs text-rose-700">{errorMessage(startMutation.error)}</Card>}</> : periodsQuery.isPending ? <Card className="p-8 text-center text-sm text-slate-500"><LoaderCircle size={16} className="mr-2 inline animate-spin"/>Loading periods…</Card> : <Card className="p-10 text-center text-sm text-slate-500">Create an evaluation period first.</Card>}
  </div>;
}
