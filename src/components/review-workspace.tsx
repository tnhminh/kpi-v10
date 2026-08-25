"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, CheckCircle2, FileCheck2, LoaderCircle, LockKeyhole, Search, ShieldAlert } from "lucide-react";
import { api, ClientApiError, type OrganizationAccess, type PeriodEvaluationDto } from "@/client/api";

type Mode = "LEADER" | "DEPARTMENT_HEAD";
type ScoreDraft = Record<string, string>;
type ReasonDraft = Record<string, string>;

function errorMessage(error: unknown) {
  return error instanceof ClientApiError ? error.message : error instanceof Error ? error.message : "The request could not be completed.";
}

function scoreLabel(value: number | null) {
  return value === null ? "NOT EVALUATED" : value.toFixed(2);
}

function statusTone(status: string) {
  if (status === "LOCKED" || status === "FINALIZED") return "bg-emerald-50 text-emerald-700 ring-emerald-200";
  if (status === "HEAD_REVIEW" || status === "LEADER_REVIEW") return "bg-violet-50 text-violet-700 ring-violet-200";
  if (status === "SYSTEM_EVALUATED") return "bg-blue-50 text-blue-700 ring-blue-200";
  return "bg-slate-100 text-slate-600 ring-slate-200";
}

function Pill({ children, tone }: { children: React.ReactNode; tone?: string }) {
  return <span className={`inline-flex rounded-md px-2 py-1 text-[10px] font-bold ring-1 ring-inset ${tone ?? "bg-slate-50 text-slate-600 ring-slate-200"}`}>{children}</span>;
}

function Card({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <section className={`rounded-xl border border-slate-200 bg-white shadow-[0_1px_2px_rgba(15,23,42,.04)] ${className}`}>{children}</section>;
}

function previousCriterionScore(mode: Mode, criterion: PeriodEvaluationDto["criteria"][number]) {
  return mode === "LEADER" ? criterion.systemScore : criterion.leaderScore;
}

function memberLayerScore(mode: Mode, member: PeriodEvaluationDto) {
  return mode === "LEADER" ? member.leaderScore : member.headScore;
}

export default function ReviewWorkspace({ organization, mode }: { organization: OrganizationAccess; mode: Mode }) {
  const queryClient = useQueryClient();
  const [periodId, setPeriodId] = useState("");
  const [selectedId, setSelectedId] = useState("");
  const [search, setSearch] = useState("");
  const [scores, setScores] = useState<ScoreDraft>({});
  const [reasons, setReasons] = useState<ReasonDraft>({});
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [qualityReasons, setQualityReasons] = useState<Record<string, string>>({});

  const periodsQuery = useQuery({
    queryKey: ["evaluation-periods", organization.organizationId],
    queryFn: () => api.evaluation.periods(organization.organizationId),
  });
  const periods = useMemo(() => periodsQuery.data ?? [], [periodsQuery.data]);
  const preferredPeriod = periods.find((period) => ["SYSTEM_EVALUATED", "LEADER_REVIEW", "HEAD_REVIEW", "FINALIZED", "LOCKED"].includes(period.status)) ?? periods[0];
  const effectivePeriodId = periodId && periods.some((period) => period.id === periodId) ? periodId : preferredPeriod?.id ?? "";

  const queueQuery = useQuery({
    queryKey: ["review-queue", organization.organizationId, effectivePeriodId, mode],
    queryFn: () => api.evaluation.reviewQueue(organization.organizationId, effectivePeriodId, mode),
    enabled: Boolean(effectivePeriodId),
  });
  const queue = useMemo(() => queueQuery.data ?? [], [queueQuery.data]);
  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    if (!needle) return queue;
    return queue.filter((item) => `${item.memberName} ${item.employeeId} ${item.teamName}`.toLowerCase().includes(needle));
  }, [queue, search]);

  const effectiveSelectedId = selectedId && queue.some((item) => item.id === selectedId) ? selectedId : queue[0]?.id ?? "";
  const selected = queue.find((item) => item.id === effectiveSelectedId) ?? null;
  const period = periods.find((item) => item.id === effectivePeriodId) ?? null;

  async function refresh() {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["review-queue", organization.organizationId, effectivePeriodId] }),
      queryClient.invalidateQueries({ queryKey: ["evaluation-periods", organization.organizationId] }),
      queryClient.invalidateQueries({ queryKey: ["period-evaluations", organization.organizationId, effectivePeriodId] }),
    ]);
  }

  const reviewMutation = useMutation({
    mutationFn: async () => {
      if (!selected) throw new Error("Select a member to review.");
      const adjustments = selected.criteria.flatMap((criterion) => {
        const raw = scores[criterion.id]?.trim() ?? "";
        if (!raw) throw new Error(`Score is required for ${criterion.criterionName}.`);
        const score = Number(raw);
        if (!Number.isFinite(score) || score < 0 || score > criterion.maxScore) throw new Error(`${criterion.criterionName} must be between 0 and ${criterion.maxScore}.`);
        const previous = previousCriterionScore(mode, criterion);
        const changed = previous === null || Math.abs(score - previous) > 0.000001;
        if (!changed) return [];
        const reason = reasons[criterion.id]?.trim() ?? "";
        if (!reason) throw new Error(`An auditable reason is required for ${criterion.criterionName}.`);
        return [{ criterionEvaluationId: criterion.id, score, reason }];
      });
      return mode === "LEADER"
        ? api.evaluation.completeLeaderReview(organization.organizationId, selected.id, adjustments)
        : api.evaluation.completeHeadReview(organization.organizationId, selected.id, adjustments);
    },
    onSuccess: async (result) => {
      setScores({});
      setReasons({});
      setActionMessage(`${mode === "LEADER" ? "Leader review" : "Department Head review"} completed at ${result.score.toFixed(2)}.`);
      await refresh();
    },
  });

  const finalizeMutation = useMutation({
    mutationFn: async () => {
      if (!selected) throw new Error("Select a member to finalize.");
      return api.evaluation.finalize(organization.organizationId, selected.id);
    },
    onSuccess: async (result) => {
      setActionMessage(`Finalized at ${result.finalScore.toFixed(2)}${result.finalRank ? ` · rank ${result.finalRank}` : ""}.`);
      await refresh();
    },
  });

  const qualityMutation = useMutation({
    mutationFn: async ({ issueId, disposition }: { issueId: string; disposition: "RESOLVED" | "WAIVED" }) => {
      const reason = qualityReasons[issueId]?.trim() ?? "";
      if (!reason) throw new Error("A resolution/waiver reason is required.");
      return api.evaluation.resolveQualityIssue(organization.organizationId, issueId, disposition, reason);
    },
    onSuccess: async (result) => {
      setQualityReasons((current) => ({ ...current, [result.id]: "" }));
      setActionMessage(`Quality issue ${result.resolutionDisposition.toLowerCase()} with an auditable reason.`);
      await refresh();
    },
  });

  const lockMutation = useMutation({
    mutationFn: async () => {
      if (!selected) throw new Error("Select a finalized member to lock.");
      return api.evaluation.lock(organization.organizationId, selected.id);
    },
    onSuccess: async (result) => {
      setActionMessage(`Locked with snapshot checksum ${result.checksum.slice(0, 12)}…`);
      await refresh();
    },
  });

  const mutationError = reviewMutation.error ?? qualityMutation.error ?? finalizeMutation.error ?? lockMutation.error;
  const pending = reviewMutation.isPending || qualityMutation.isPending || finalizeMutation.isPending || lockMutation.isPending;
  const criticalCount = selected?.qualityIssues.filter((issue) => issue.severity === "CRITICAL" && !issue.resolvedAt).length ?? 0;
  const changedCount = selected?.criteria.filter((criterion) => {
    const raw = scores[criterion.id]?.trim();
    if (!raw) return previousCriterionScore(mode, criterion) === null;
    const value = Number(raw);
    const previous = previousCriterionScore(mode, criterion);
    return previous === null || Number.isFinite(value) && Math.abs(value - previous) > 0.000001;
  }).length ?? 0;

  const reviewEnabled = Boolean(selected) && (mode === "LEADER"
    ? selected?.status === "SYSTEM_EVALUATED" && (period?.status === "SYSTEM_EVALUATED" || period?.status === "LEADER_REVIEW")
    : selected?.status === "LEADER_REVIEW" && period?.status === "HEAD_REVIEW");

  if (periodsQuery.isPending) return <Card className="p-8"><div className="flex items-center justify-center gap-2 text-sm text-slate-500"><LoaderCircle size={16} className="animate-spin"/> Loading review periods…</div></Card>;
  if (periodsQuery.error) return <Card className="border-rose-200 p-5 text-sm text-rose-700">{errorMessage(periodsQuery.error)}</Card>;

  return <div className="-m-7 flex h-[calc(100vh-65px)] flex-col overflow-hidden">
    <div className="flex items-center justify-between border-b border-slate-200 bg-white px-5 py-3">
      <div>
        <div className="text-sm font-semibold text-slate-950">{mode === "LEADER" ? "Leader Review" : "Department Head Calibration"}</div>
        <div className="mt-0.5 text-[11px] text-slate-500">Persisted layer review · previous scores stay immutable · changed scores require an audit reason.</div>
      </div>
      <div className="flex items-center gap-2">
        <select value={effectivePeriodId} onChange={(event) => { setPeriodId(event.target.value); setSelectedId(""); setScores({}); setReasons({}); setActionMessage(null); }} className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold">
          {periods.map((item) => <option key={item.id} value={item.id}>{item.key} · {item.status}</option>)}
        </select>
        {period && <Pill tone={statusTone(period.status)}>{period.status}</Pill>}
      </div>
    </div>

    <div className="grid min-h-0 flex-1 grid-cols-[260px_minmax(0,1fr)_310px] bg-slate-100">
      <aside className="kpi-scroll overflow-y-auto border-r border-slate-200 bg-white p-3">
        <div className="relative mb-3"><Search size={13} className="absolute left-2.5 top-2.5 text-slate-400"/><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Find member or team…" className="w-full rounded-lg border border-slate-200 py-2 pl-8 pr-2 text-xs outline-none"/></div>
        {queueQuery.isPending ? <div className="flex items-center justify-center gap-2 py-8 text-xs text-slate-500"><LoaderCircle size={14} className="animate-spin"/> Loading queue…</div> : queueQuery.error ? <div className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-xs text-rose-700">{errorMessage(queueQuery.error)}</div> : filtered.length === 0 ? <div className="rounded-lg bg-slate-50 p-4 text-xs text-slate-500">No members are visible in this review scope.</div> : filtered.map((member) => {
          const critical = member.qualityIssues.filter((issue) => issue.severity === "CRITICAL" && !issue.resolvedAt).length;
          return <button key={member.id} onClick={() => { setSelectedId(member.id); setActionMessage(null); }} className={`mb-1.5 w-full rounded-lg border p-3 text-left ${effectiveSelectedId === member.id ? "border-blue-300 bg-blue-50" : "border-transparent hover:bg-slate-50"}`}>
            <div className="flex items-center justify-between gap-2"><span className="truncate text-xs font-semibold">{member.memberName}</span><span className="text-[10px] font-bold text-slate-500">{scoreLabel(memberLayerScore(mode, member))}</span></div>
            <div className="mt-2 flex items-center justify-between gap-2"><span className="truncate text-[10px] text-slate-500">{member.teamName}</span><Pill tone={statusTone(member.status)}>{member.status}</Pill></div>
            {critical > 0 && <div className="mt-2 flex items-center gap-1 text-[10px] font-semibold text-rose-600"><ShieldAlert size={11}/>{critical} unresolved critical issue{critical > 1 ? "s" : ""}</div>}
          </button>;
        })}
      </aside>

      <main className="kpi-scroll overflow-y-auto p-5">
        {!selected ? <Card className="p-10 text-center text-sm text-slate-500">Select a member to inspect the persisted review layers.</Card> : <>
          <div className="mb-4 flex items-start justify-between gap-4">
            <div><div className="text-lg font-semibold text-slate-950">{selected.memberName}</div><div className="mt-1 text-xs text-slate-500">{selected.employeeId} · {selected.teamName} · {selected.templateName} v{selected.version}</div></div>
            <div className="grid grid-cols-4 gap-px overflow-hidden rounded-xl border border-slate-200 bg-slate-200 text-center">
              {[["System", selected.systemScore], ["Leader", selected.leaderScore], ["Head", selected.headScore], ["Final", selected.finalScore]].map(([label, score]) => <div key={String(label)} className="min-w-20 bg-white px-3 py-2"><div className="text-[9px] font-bold uppercase text-slate-400">{label}</div><div className="mt-1 text-sm font-semibold">{scoreLabel(score as number | null)}</div></div>)}
            </div>
          </div>

          {criticalCount > 0 && <Card className="mb-4 border-rose-200 bg-rose-50/60 p-4"><div className="flex gap-3"><ShieldAlert size={18} className="mt-0.5 text-rose-600"/><div><div className="text-sm font-semibold text-rose-800">{criticalCount} unresolved critical data-quality issue{criticalCount > 1 ? "s" : ""}</div><div className="mt-1 text-xs text-rose-700">Human review may record a justified score, but finalization remains blocked until each critical issue is explicitly resolved or waived with an auditable actor and reason.</div></div></div></Card>}

          <Card className="overflow-hidden">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 text-slate-500"><tr>{["Criterion", "Max", "System", "Leader", "Head", "Final", mode === "LEADER" ? "Leader input" : "Head input", "Confidence"].map((header) => <th key={header} className="px-3 py-2.5 font-semibold">{header}</th>)}</tr></thead>
              <tbody>{selected.criteria.map((criterion) => {
                const previous = previousCriterionScore(mode, criterion);
                const raw = scores[criterion.id] ?? (previous === null ? "" : String(previous));
                const parsed = raw.trim() ? Number(raw) : null;
                const changed = previous === null || parsed !== null && Number.isFinite(parsed) && Math.abs(parsed - previous) > 0.000001;
                return <tr key={criterion.id} className="border-t border-slate-100 align-top">
                  <td className="px-3 py-3"><div className="font-semibold text-slate-900">{criterion.criterionName}</div>{previous === null && <div className="mt-1 text-[10px] font-semibold text-violet-700">Previous layer is NOT_EVALUATED · human score required</div>}</td>
                  <td className="px-3 py-3">{criterion.maxScore.toFixed(1)}</td>
                  <td className="px-3 py-3">{scoreLabel(criterion.systemScore)}</td>
                  <td className="px-3 py-3">{scoreLabel(criterion.leaderScore)}</td>
                  <td className="px-3 py-3">{scoreLabel(criterion.headScore)}</td>
                  <td className="px-3 py-3">{scoreLabel(criterion.finalScore)}</td>
                  <td className="px-3 py-3"><input disabled={!reviewEnabled || pending} type="number" step="0.1" min={0} max={criterion.maxScore} value={raw} onChange={(event) => setScores((current) => ({ ...current, [criterion.id]: event.target.value }))} className={`w-20 rounded-md border px-2 py-1.5 font-semibold outline-none disabled:bg-slate-50 disabled:text-slate-400 ${changed ? "border-violet-300 text-violet-700" : "border-slate-200 text-slate-700"}`}/>{changed && reviewEnabled && <textarea value={reasons[criterion.id] ?? ""} onChange={(event) => setReasons((current) => ({ ...current, [criterion.id]: event.target.value }))} rows={2} maxLength={4000} placeholder="Required adjustment reason…" className="mt-2 w-56 resize-none rounded-md border border-violet-200 bg-violet-50/50 px-2 py-1.5 text-[10px] outline-none"/>}</td>
                  <td className="px-3 py-3"><Pill>{criterion.confidence}</Pill></td>
                </tr>;
              })}</tbody>
            </table>
          </Card>

          {(mutationError || actionMessage) && <div className={`mt-4 rounded-lg border p-3 text-xs ${mutationError ? "border-rose-200 bg-rose-50 text-rose-700" : "border-emerald-200 bg-emerald-50 text-emerald-700"}`}>{mutationError ? errorMessage(mutationError) : actionMessage}</div>}

          <div className="mt-4 flex items-center justify-between">
            <div className="text-xs text-slate-500">{reviewEnabled ? `${changedCount} criterion change${changedCount === 1 ? "" : "s"} require${changedCount === 1 ? "s" : ""} persisted reasons.` : `Current workflow stage: ${selected.status}.`}</div>
            <div className="flex gap-2">
              {reviewEnabled && <button disabled={pending} onClick={() => reviewMutation.mutate()} className="flex items-center gap-2 rounded-lg bg-blue-600 px-3.5 py-2 text-xs font-semibold text-white disabled:opacity-50">{reviewMutation.isPending ? <LoaderCircle size={14} className="animate-spin"/> : <CheckCircle2 size={14}/>} Complete {mode === "LEADER" ? "Leader" : "Head"} review</button>}
              {mode === "DEPARTMENT_HEAD" && selected.status === "HEAD_REVIEW" && <button disabled={pending} onClick={() => finalizeMutation.mutate()} className="flex items-center gap-2 rounded-lg bg-slate-950 px-3.5 py-2 text-xs font-semibold text-white disabled:opacity-50">{finalizeMutation.isPending ? <LoaderCircle size={14} className="animate-spin"/> : <FileCheck2 size={14}/>} Finalize member</button>}
              {mode === "DEPARTMENT_HEAD" && selected.status === "FINALIZED" && <button disabled={pending} onClick={() => lockMutation.mutate()} className="flex items-center gap-2 rounded-lg bg-emerald-700 px-3.5 py-2 text-xs font-semibold text-white disabled:opacity-50">{lockMutation.isPending ? <LoaderCircle size={14} className="animate-spin"/> : <LockKeyhole size={14}/>} Lock snapshot</button>}
            </div>
          </div>
        </>}
      </main>

      <aside className="kpi-scroll overflow-y-auto border-l border-slate-200 bg-white p-4">
        <div><h3 className="text-sm font-semibold">Review integrity</h3><p className="mt-1 text-[10px] leading-4 text-slate-500">System evidence remains unchanged. Each human layer is additive and historical.</p></div>
        <div className="mt-4 space-y-2">
          <Card className="p-3"><div className="text-[9px] font-bold uppercase tracking-wide text-slate-400">Authority</div><div className="mt-1 text-xs font-semibold">{mode === "LEADER" ? "Effective team leadership at period date" : "Department review permission"}</div></Card>
          <Card className="p-3"><div className="text-[9px] font-bold uppercase tracking-wide text-slate-400">Adjustment audit</div><div className="mt-1 text-xs font-semibold">Before → after → reason → actor</div></Card>
          <Card className="p-3"><div className="text-[9px] font-bold uppercase tracking-wide text-slate-400">Finalization</div><div className="mt-1 text-xs font-semibold">Complete Head scores + zero unresolved CRITICAL</div></Card>
          <Card className="p-3"><div className="text-[9px] font-bold uppercase tracking-wide text-slate-400">Lock</div><div className="mt-1 text-xs font-semibold">Canonical snapshot + SHA-256 checksum</div></Card>
        </div>
        {selected && <div className="mt-5"><div className="text-[10px] font-bold uppercase tracking-wide text-slate-400">Selected member quality</div><div className="mt-2 space-y-2">{selected.qualityIssues.length === 0 ? <div className="rounded-lg bg-emerald-50 p-3 text-xs font-semibold text-emerald-700">No recorded quality issues</div> : selected.qualityIssues.map((issue) => <div key={issue.id} className={`rounded-lg border p-3 text-xs ${issue.severity === "CRITICAL" && !issue.resolvedAt ? "border-rose-200 bg-rose-50 text-rose-700" : issue.resolvedAt ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-amber-200 bg-amber-50 text-amber-700"}`}><div className="flex items-center gap-1 font-semibold"><AlertTriangle size={12}/>{issue.code}</div><div className="mt-1 text-[10px] leading-4">{issue.message}</div>{issue.resolvedAt ? <div className="mt-2 text-[10px] font-semibold">{issue.resolutionDisposition} · {issue.resolutionReason}</div> : mode === "DEPARTMENT_HEAD" && issue.severity === "CRITICAL" && selected.status !== "FINALIZED" && selected.status !== "LOCKED" ? <div className="mt-2"><textarea value={qualityReasons[issue.id] ?? ""} onChange={(event) => setQualityReasons((current) => ({ ...current, [issue.id]: event.target.value }))} maxLength={4000} rows={2} placeholder="Resolution / waiver reason…" className="w-full resize-none rounded-md border border-rose-200 bg-white px-2 py-1.5 text-[10px] text-slate-700 outline-none"/><div className="mt-2 flex gap-1.5"><button disabled={pending} onClick={() => qualityMutation.mutate({ issueId: issue.id, disposition: "RESOLVED" })} className="rounded-md bg-emerald-700 px-2 py-1 text-[10px] font-semibold text-white disabled:opacity-50">Resolve</button><button disabled={pending} onClick={() => qualityMutation.mutate({ issueId: issue.id, disposition: "WAIVED" })} className="rounded-md bg-slate-700 px-2 py-1 text-[10px] font-semibold text-white disabled:opacity-50">Waive</button></div></div> : null}</div>)}</div></div>}
      </aside>
    </div>
  </div>;
}
