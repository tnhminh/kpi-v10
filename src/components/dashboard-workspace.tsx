"use client";

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, BarChart3, LoaderCircle, ShieldCheck, Sparkles, Users } from "lucide-react";
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { api, ClientApiError, type HistoricalAnalyticsDto, type OrganizationAccess, type PeriodEvaluationDto } from "@/client/api";

type PageKey = "dashboard" | "teams" | "members" | "templates" | "builder" | "metrics" | "rules" | "periods" | "system" | "review" | "calibration" | "history" | "quality" | "jira" | "rank" | "audit";

type Props = {
  organization: OrganizationAccess;
  go: (key: PageKey) => void;
};

const EMPTY_EVALUATIONS: PeriodEvaluationDto[] = [];

const stage: Record<PeriodEvaluationDto["status"], number> = {
  PENDING: 0,
  SYSTEM_EVALUATED: 1,
  LEADER_REVIEW: 2,
  HEAD_REVIEW: 3,
  FINALIZED: 4,
  LOCKED: 5,
};

function apiErrorMessage(error: unknown) {
  return error instanceof ClientApiError ? error.message : error instanceof Error ? error.message : "The request could not be completed.";
}

function average(values: Array<number | null>) {
  const valid = values.filter((value): value is number => value !== null && Number.isFinite(value));
  return valid.length ? valid.reduce((sum, value) => sum + value, 0) / valid.length : null;
}

function formatScore(value: number | null) {
  return value === null ? "N/A" : value.toFixed(2);
}

function statPercent(count: number, total: number) {
  return total ? Math.round((count / total) * 100) : 0;
}

function Panel({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <section className={`rounded-xl border border-slate-200 bg-white shadow-[0_1px_2px_rgba(15,23,42,.04)] ${className}`}>{children}</section>;
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return <Panel className="p-4"><div className="text-xs font-medium text-slate-500">{label}</div><div className="mt-2 text-2xl font-semibold tracking-tight text-slate-950">{value}</div>{hint && <div className="mt-1 text-[11px] text-slate-400">{hint}</div>}</Panel>;
}

function ErrorState({ error, onRetry }: { error: unknown; onRetry: () => void }) {
  return <Panel className="border-rose-200 p-5"><div className="flex items-start gap-3"><AlertTriangle size={17} className="mt-0.5 text-rose-600"/><div className="flex-1"><div className="text-sm font-semibold text-rose-800">Unable to load dashboard</div><div className="mt-1 text-xs text-rose-700">{apiErrorMessage(error)}</div><button onClick={onRetry} className="mt-3 rounded-lg border border-rose-200 bg-white px-3 py-1.5 text-xs font-semibold text-rose-700">Retry</button></div></div></Panel>;
}

function attentionReasons(evaluation: PeriodEvaluationDto) {
  const reasons: string[] = [];
  if (evaluation.confidence === "LOW") reasons.push("Low confidence");
  if (evaluation.confidence === "REVIEW_REQUIRED") reasons.push("Review required");
  const unresolvedCritical = evaluation.qualityIssues.filter((issue) => issue.severity === "CRITICAL" && !issue.resolvedAt);
  if (unresolvedCritical.length) reasons.push(`${unresolvedCritical.length} unresolved critical data issue${unresolvedCritical.length === 1 ? "" : "s"}`);
  return reasons;
}

function historyStats(history: HistoricalAnalyticsDto) {
  return [
    { label: "Historical Average", value: formatScore(history.summary.score), hint: history.summary.coverageLabel },
    { label: "Valid Evaluations", value: String(history.summary.validCount), hint: "Finalized / locked only" },
    { label: "Persisted Evaluations", value: String(history.summary.totalCount), hint: "Includes non-final coverage" },
    { label: "Latest Final Score", value: history.latest ? history.latest.score.toFixed(2) : "N/A", hint: history.latest?.periodKey ?? "No finalized result" },
    { label: "Latest Rank", value: history.latest?.rank ?? "N/A", hint: history.latest?.coefficient === null || history.latest?.coefficient === undefined ? "No coefficient" : `Coefficient ${history.latest.coefficient}` },
    { label: "Analytics Scope", value: history.scope === "ORGANIZATION" ? "Organization" : "Self", hint: "Server-authorized scope" },
  ];
}

export default function DashboardWorkspace({ organization, go }: Props) {
  const organizationId = organization.organizationId;
  const canReadOrganization = organization.role !== "MEMBER";
  const isAdministrator = organization.role === "ADMINISTRATOR";
  const reviewLayer = organization.role === "DEPARTMENT_HEAD" ? "DEPARTMENT_HEAD" as const : organization.role === "TEAM_LEADER" ? "LEADER" as const : null;

  const historyQuery = useQuery({
    queryKey: ["dashboard-history", organizationId],
    queryFn: () => api.analytics.history(organizationId),
  });
  const periodsQuery = useQuery({
    queryKey: ["dashboard-periods", organizationId],
    queryFn: () => api.evaluation.periods(organizationId),
    enabled: canReadOrganization,
  });
  const teamsQuery = useQuery({
    queryKey: ["dashboard-teams", organizationId],
    queryFn: () => api.organizations.teams(organizationId),
    enabled: canReadOrganization,
  });
  const membersQuery = useQuery({
    queryKey: ["dashboard-members", organizationId],
    queryFn: () => api.organizations.members(organizationId),
    enabled: canReadOrganization,
  });

  const currentPeriod = useMemo(() => {
    const rows = periodsQuery.data ?? [];
    return [...rows].sort((left, right) => right.startsOn.localeCompare(left.startsOn))[0] ?? null;
  }, [periodsQuery.data]);

  const adminEvaluationsQuery = useQuery({
    queryKey: ["dashboard-evaluations", organizationId, currentPeriod?.id],
    queryFn: () => api.evaluation.evaluations(organizationId, currentPeriod!.id),
    enabled: Boolean(isAdministrator && currentPeriod?.id),
  });
  const scopedEvaluationsQuery = useQuery({
    queryKey: ["dashboard-review-scope", organizationId, currentPeriod?.id, reviewLayer],
    queryFn: () => api.evaluation.reviewQueue(organizationId, currentPeriod!.id, reviewLayer!),
    enabled: Boolean(reviewLayer && currentPeriod?.id),
  });

  const evaluationQuery = isAdministrator ? adminEvaluationsQuery : reviewLayer ? scopedEvaluationsQuery : null;
  const evaluations = evaluationQuery?.data ?? EMPTY_EVALUATIONS;
  const history = historyQuery.data;

  const pending = historyQuery.isPending || (canReadOrganization && periodsQuery.isPending) || Boolean(evaluationQuery?.isPending);
  const error = historyQuery.error ?? periodsQuery.error ?? evaluationQuery?.error ?? null;
  if (pending) return <Panel className="p-10"><div className="flex items-center justify-center gap-2 text-sm text-slate-500"><LoaderCircle size={16} className="animate-spin"/> Loading authoritative dashboard…</div></Panel>;
  if (error || !history) return <ErrorState error={error ?? new Error("Historical analytics did not return a result.")} onRetry={() => { void historyQuery.refetch(); if (canReadOrganization) void periodsQuery.refetch(); if (evaluationQuery) void evaluationQuery.refetch(); }}/ >;

  const total = evaluations.length;
  const systemCount = evaluations.filter((row) => stage[row.status] >= stage.SYSTEM_EVALUATED).length;
  const leaderCount = evaluations.filter((row) => stage[row.status] >= stage.LEADER_REVIEW).length;
  const headCount = evaluations.filter((row) => stage[row.status] >= stage.HEAD_REVIEW).length;
  const finalizedCount = evaluations.filter((row) => stage[row.status] >= stage.FINALIZED).length;
  const lowConfidenceCount = evaluations.filter((row) => row.confidence === "LOW" || row.confidence === "REVIEW_REQUIRED").length;
  const attentionRows = evaluations
    .map((evaluation) => ({ evaluation, reasons: attentionReasons(evaluation) }))
    .filter((item) => item.reasons.length > 0);

  const currentFinalAverage = average(evaluations.map((row) => row.finalScore));
  const scopeLabel = isAdministrator ? "Organization" : organization.role === "DEPARTMENT_HEAD" ? "Assigned department" : organization.role === "TEAM_LEADER" ? "Led teams" : "Self";
  const statRows = evaluationQuery ? [
    { label: "Finalized Average", value: formatScore(currentFinalAverage ?? history.summary.score), hint: currentFinalAverage === null ? "Fallback to historical final average" : "Current period finalized / locked only" },
    { label: "Members Evaluated", value: `${systemCount} / ${total}`, hint: currentPeriod?.key ?? "No current period" },
    { label: "Leader Review", value: `${statPercent(leaderCount, total)}%`, hint: `${leaderCount} / ${total} reached Leader Review` },
    { label: "Head Reviewed", value: String(headCount), hint: `${finalizedCount} finalized / locked` },
    { label: "Low Confidence", value: String(lowConfidenceCount), hint: "LOW or REVIEW_REQUIRED" },
    { label: "Needs Attention", value: String(attentionRows.length), hint: "Confidence or unresolved critical data" },
  ] : historyStats(history);

  const teamMap = new Map<string, PeriodEvaluationDto[]>();
  for (const evaluation of evaluations) {
    const rows = teamMap.get(evaluation.resolvedTeamId) ?? [];
    rows.push(evaluation);
    teamMap.set(evaluation.resolvedTeamId, rows);
  }
  const groupedTeams = [...teamMap.entries()].map(([teamId, rows]) => {
    const attention = rows.filter((row) => attentionReasons(row).length > 0).length;
    const finalCount = rows.filter((row) => stage[row.status] >= stage.FINALIZED).length;
    return {
      teamId,
      name: rows[0]?.teamName ?? teamId,
      members: rows.length,
      system: average(rows.map((row) => row.systemScore)),
      leader: average(rows.map((row) => row.leaderScore)),
      final: average(rows.map((row) => row.finalScore)),
      progress: statPercent(finalCount, rows.length),
      attention,
    };
  }).sort((left, right) => left.name.localeCompare(right.name));

  const trendData = history.series.filter((item) => item.score !== null).map((item) => ({ period: item.periodKey, score: item.score }));
  const configuredTeams = teamsQuery.data ?? [];
  const activeMemberCount = (membersQuery.data ?? []).filter((member) => member.active).length;

  return <div>
    <div className="mb-5 flex items-start justify-between gap-4">
      <div>
        <div className="mb-1 text-[11px] font-bold uppercase tracking-[.12em] text-blue-600">{organization.organizationName}{currentPeriod ? ` · ${currentPeriod.key}` : ""}</div>
        <h1 className="text-[24px] font-semibold tracking-tight text-slate-950">Performance overview</h1>
        <p className="mt-1 max-w-3xl text-sm text-slate-500">Authoritative persisted metrics for the server-approved <b>{scopeLabel}</b> scope. Missing or non-final values are never converted to zero.</p>
      </div>
      {(organization.role === "TEAM_LEADER" || organization.role === "DEPARTMENT_HEAD" || organization.role === "ADMINISTRATOR") && <button onClick={() => go("review")} className="rounded-lg bg-slate-950 px-3.5 py-2 text-sm font-semibold text-white">Open review workspace</button>}
    </div>

    <div className="grid grid-cols-2 gap-3 xl:grid-cols-3 2xl:grid-cols-6">{statRows.map((item) => <Stat key={item.label} {...item}/>)}</div>

    <div className="mt-4 grid gap-4 xl:grid-cols-[1.15fr_.85fr]">
      <Panel className="p-5">
        <div className="mb-4 flex items-center justify-between"><div><h2 className="font-semibold">Review progress</h2><p className="text-xs text-slate-500">Current-period lifecycle in your authorized evaluation scope.</p></div><span className="rounded-md bg-blue-50 px-2 py-1 text-[11px] font-semibold text-blue-700">{currentPeriod?.status ?? "NO PERIOD"}</span></div>
        {evaluationQuery ? <div className="space-y-4">{[
          ["System evaluated", systemCount, total, "bg-blue-500"],
          ["Leader reviewed", leaderCount, total, "bg-violet-500"],
          ["Head reviewed", headCount, total, "bg-fuchsia-500"],
          ["Finalized / locked", finalizedCount, total, "bg-emerald-500"],
        ].map(([label, count, denominator, tone]) => <div key={String(label)}><div className="mb-1.5 flex justify-between text-xs"><span className="font-medium">{label}</span><span className="text-slate-500">{count} / {denominator}</span></div><div className="h-2 rounded-full bg-slate-100"><div className={`h-2 rounded-full ${tone}`} style={{ width: `${statPercent(Number(count), Number(denominator))}%` }}/></div></div>)}</div> : <div className="rounded-lg bg-slate-50 p-5 text-sm text-slate-600"><ShieldCheck size={18} className="mb-2 text-blue-600"/>Current evaluation-stage details are intentionally hidden for this role. Your personal finalized history remains available above.</div>}
      </Panel>

      <Panel className="p-5">
        <div className="mb-3"><h2 className="font-semibold">Final KPI trend</h2><p className="text-xs text-slate-500">{history.scope === "ORGANIZATION" ? "Organization-authorized" : "Personal"} finalized / locked values only.</p></div>
        {trendData.length ? <div className="h-44"><ResponsiveContainer width="100%" height="100%"><LineChart data={trendData}><CartesianGrid stroke="#edf0f4" vertical={false}/><XAxis dataKey="period" tick={{ fontSize: 10 }} axisLine={false} tickLine={false}/><YAxis domain={[0,10]} tick={{ fontSize: 10 }} axisLine={false} tickLine={false}/><Tooltip/><Line type="monotone" dataKey="score" stroke="#3156d3" strokeWidth={2.5} dot={{ r: 3 }}/></LineChart></ResponsiveContainer></div> : <div className="grid h-44 place-items-center text-sm text-slate-400"><div className="text-center"><BarChart3 size={22} className="mx-auto mb-2"/>No finalized history yet.</div></div>}
      </Panel>
    </div>

    <div className="mt-4 grid gap-4 xl:grid-cols-[1.4fr_.8fr]">
      <Panel>
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4"><div><h2 className="font-semibold">Team performance</h2><p className="text-xs text-slate-500">Current period, calculated from persisted evaluation rows in your scope.</p></div><button onClick={() => go("teams")} className="text-xs font-semibold text-blue-600">View teams →</button></div>
        {groupedTeams.length ? <div className="overflow-x-auto"><table className="w-full text-left text-xs"><thead className="bg-slate-50 text-slate-500"><tr>{["Team","Members","System","Leader","Final","Finalized","Attention"].map((heading) => <th key={heading} className="px-4 py-2.5 font-semibold">{heading}</th>)}</tr></thead><tbody>{groupedTeams.map((team) => <tr key={team.teamId} className="border-t border-slate-100"><td className="px-4 py-3 font-semibold text-slate-900">{team.name}</td><td className="px-4 py-3">{team.members}</td><td className="px-4 py-3">{formatScore(team.system)}</td><td className="px-4 py-3">{formatScore(team.leader)}</td><td className="px-4 py-3 font-semibold">{formatScore(team.final)}</td><td className="px-4 py-3"><div className="w-24"><div className="mb-1 text-[10px] text-slate-500">{team.progress}%</div><div className="h-1.5 rounded-full bg-slate-100"><div className="h-1.5 rounded-full bg-emerald-500" style={{ width: `${team.progress}%` }}/></div></div></td><td className={`px-4 py-3 font-semibold ${team.attention ? "text-rose-600" : "text-emerald-600"}`}>{team.attention}</td></tr>)}</tbody></table></div> : <div className="p-8 text-center text-sm text-slate-500">{evaluationQuery ? "No evaluation rows are currently visible in this scope." : canReadOrganization ? `${configuredTeams.filter((team) => team.active).length} active teams and ${activeMemberCount} active members are configured; performance rows are restricted for this role.` : "Team-level organization data is restricted for this role."}</div>}
      </Panel>

      <Panel className="p-5">
        <div className="mb-3 flex items-center justify-between"><div><h2 className="font-semibold">Needs attention</h2><p className="text-xs text-slate-500">Confidence and unresolved critical-data exceptions.</p></div><Sparkles size={17} className="text-violet-500"/></div>
        {evaluationQuery ? attentionRows.length ? <div className="space-y-2.5">{attentionRows.slice(0,7).map(({ evaluation, reasons }) => <button onClick={() => go("review")} key={evaluation.id} className="w-full rounded-lg border border-slate-200 p-3 text-left hover:border-blue-200 hover:bg-blue-50/30"><div className="flex justify-between gap-3"><span className="text-xs font-semibold">{evaluation.memberName}</span><span className="text-[10px] font-semibold text-rose-600">{evaluation.confidence}</span></div><div className="mt-1 text-[10px] text-slate-400">{evaluation.teamName}</div><div className="mt-1 text-xs text-slate-500">{reasons.join(" · ")}</div></button>)}</div> : <div className="rounded-lg bg-emerald-50 p-4 text-sm text-emerald-700"><ShieldCheck size={18} className="mb-2"/>No low-confidence or unresolved critical-data cases in this scope.</div> : <div className="rounded-lg bg-slate-50 p-4 text-sm text-slate-500"><Users size={18} className="mb-2"/>Exception details are available only to roles with review scope.</div>}
      </Panel>
    </div>
  </div>;
}
