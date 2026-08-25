"use client";

import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, BarChart3, FileClock, LoaderCircle, ShieldCheck } from "lucide-react";
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { api, ClientApiError, type AuditEventDto, type OrganizationAccess } from "@/client/api";

function Panel({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <section className={`rounded-xl border border-slate-200 bg-white shadow-[0_1px_2px_rgba(15,23,42,.04)] ${className}`}>{children}</section>;
}

function PageTitle({ eyebrow, title, subtitle }: { eyebrow: string; title: string; subtitle: string }) {
  return <div className="mb-5"><div className="mb-1 text-[11px] font-bold uppercase tracking-[.12em] text-blue-600">{eyebrow}</div><h1 className="text-[24px] font-semibold tracking-tight text-slate-950">{title}</h1><p className="mt-1 max-w-3xl text-sm text-slate-500">{subtitle}</p></div>;
}

function errorMessage(error: unknown) {
  return error instanceof ClientApiError ? `${error.message}${error.requestId ? ` · Request ${error.requestId}` : ""}` : error instanceof Error ? error.message : "The request could not be completed.";
}

function Loading({ label }: { label: string }) {
  return <Panel className="p-8 text-center text-sm text-slate-500"><LoaderCircle size={16} className="mr-2 inline animate-spin"/>{label}</Panel>;
}

function ErrorPanel({ error }: { error: unknown }) {
  return <Panel className="border-rose-200 p-5"><div className="flex gap-3"><AlertTriangle size={18} className="mt-0.5 text-rose-600"/><div><div className="text-sm font-semibold text-rose-800">Unable to load authoritative data</div><div className="mt-1 text-xs text-rose-700">{errorMessage(error)}</div></div></div></Panel>;
}

function Stat({ label, value, hint }: { label: string; value: string; hint: string }) {
  return <Panel className="p-4"><div className="text-xs font-medium text-slate-500">{label}</div><div className="mt-2 text-2xl font-semibold tracking-tight text-slate-950">{value}</div><div className="mt-1 text-[11px] text-slate-400">{hint}</div></Panel>;
}

export function HistoricalAnalyticsWorkspace({ organization }: { organization: OrganizationAccess }) {
  const query = useQuery({
    queryKey: ["historical-analytics", organization.organizationId],
    queryFn: () => api.analytics.history(organization.organizationId),
  });

  return <div>
    <PageTitle eyebrow="Insights" title="Historical analytics" subtitle="Only authoritative FINALIZED/LOCKED KPI values contribute to historical scores. Incomplete periods remain visible in coverage and are never converted to zero."/>
    {query.isPending ? <Loading label="Loading historical evaluations…"/> : query.error ? <ErrorPanel error={query.error}/> : query.data ? <>
      <div className="grid grid-cols-4 gap-3">
        <Stat label="Historical score" value={query.data.summary.score === null ? "N/A" : query.data.summary.score.toFixed(2)} hint={query.data.scope === "ORGANIZATION" ? "Organization-wide valid final values" : query.data.scope === "DEPARTMENT" ? "Assigned-department valid final values" : "Your valid final values"}/>
        <Stat label="Coverage" value={`${query.data.summary.validCount} / ${query.data.summary.totalCount}`} hint="Finalized/locked / persisted evaluations"/>
        <Stat label="Latest valid period" value={query.data.latest?.periodKey ?? "N/A"} hint={query.data.latest ? `KPI ${query.data.latest.score.toFixed(2)}` : "No finalized/locked value yet"}/>
        <Stat label="Latest rank" value={query.data.latest?.rank ?? "N/A"} hint={query.data.latest?.coefficient === null || query.data.latest?.coefficient === undefined ? "No coefficient" : `Coefficient ${query.data.latest.coefficient}`}/>
      </div>
      <div className="mt-4 grid grid-cols-[1.4fr_.8fr] gap-4">
        <Panel className="p-5"><div className="flex items-start justify-between"><div><h3 className="font-semibold">Performance history</h3><p className="mt-1 text-xs text-slate-500">Period averages exclude non-final values while retaining explicit coverage.</p></div><span className="rounded-md bg-slate-100 px-2 py-1 text-[10px] font-bold text-slate-600">{query.data.scope}</span></div>
          {query.data.series.length ? <div className="mt-4 h-64"><ResponsiveContainer width="100%" height="100%"><LineChart data={query.data.series}><CartesianGrid stroke="#edf0f4" vertical={false}/><XAxis dataKey="periodKey" tick={{ fontSize: 11 }} axisLine={false} tickLine={false}/><YAxis domain={[0, 10]} tick={{ fontSize: 11 }} axisLine={false} tickLine={false}/><Tooltip formatter={(value) => value === null ? "N/A" : Number(value).toFixed(2)}/><Line type="monotone" dataKey="score" stroke="#3156d3" strokeWidth={2.5} connectNulls={false}/></LineChart></ResponsiveContainer></div> : <div className="mt-6 rounded-lg bg-slate-50 p-8 text-center text-sm text-slate-500">No persisted evaluation history is available yet.</div>}
        </Panel>
        <Panel className="p-5"><div className="flex items-center gap-2"><BarChart3 size={17} className="text-blue-600"/><h3 className="font-semibold">Period integrity</h3></div><div className="mt-4 space-y-2">{query.data.series.length ? query.data.series.slice().reverse().map((period) => <div key={period.periodId} className="rounded-lg border border-slate-200 p-3"><div className="flex items-center justify-between"><span className="text-xs font-semibold">{period.periodKey}</span><span className="text-sm font-semibold">{period.score === null ? "N/A" : period.score.toFixed(2)}</span></div><div className="mt-1 text-[10px] text-slate-500">{period.coverageLabel}</div></div>) : <div className="text-xs text-slate-500">No periods.</div>}</div>
        </Panel>
      </div>
      <Panel className="mt-4 p-4"><div className="flex gap-3"><ShieldCheck size={18} className="mt-0.5 text-emerald-600"/><div><div className="text-sm font-semibold">Historical-value policy enforced server-side</div><div className="mt-1 text-xs text-slate-500">SYSTEM_EVALUATED, review-stage, missing and invalid values do not enter the score numerator. Corrupt finalized data is rejected instead of silently excluded.</div></div></div></Panel>
    </> : null}
  </div>;
}

function actorSnapshot(event: AuditEventDto): { displayName: string | null; email: string | null } {
  const actor = event.metadata.actor;
  if (!actor || typeof actor !== "object" || Array.isArray(actor)) return { displayName: null, email: null };
  const record = actor as Record<string, unknown>;
  return {
    displayName: typeof record.displayName === "string" ? record.displayName : null,
    email: typeof record.email === "string" ? record.email : null,
  };
}

function formatJson(value: Record<string, unknown> | null) {
  return value ? JSON.stringify(value, null, 2) : "None";
}

function canReadAudit(role: OrganizationAccess["role"]) {
  return role === "ADMINISTRATOR" || role === "DEPARTMENT_HEAD";
}

export function AuditLogWorkspace({ organization }: { organization: OrganizationAccess }) {
  const allowed = canReadAudit(organization.role);
  const query = useQuery({
    queryKey: ["audit-events", organization.organizationId],
    queryFn: () => api.audit.list(organization.organizationId, 150),
    enabled: allowed,
  });

  return <div>
    <PageTitle eyebrow="Administration" title="Audit log" subtitle="Tenant-scoped, append-only history for high-impact configuration, review, finalization, locking and integration mutations with request correlation and before/after trace."/>
    {!allowed ? <Panel className="border-amber-200 p-5"><div className="flex gap-3"><FileClock size={18} className="text-amber-600"/><div><div className="text-sm font-semibold">Audit permission required</div><div className="mt-1 text-xs text-slate-500">Audit history is restricted to Department Head and Administrator roles.</div></div></div></Panel> : query.isPending ? <Loading label="Loading audit events…"/> : query.error ? <ErrorPanel error={query.error}/> : <Panel>{(query.data ?? []).length === 0 ? <div className="p-10 text-center"><FileClock size={28} className="mx-auto text-slate-300"/><div className="mt-3 text-sm font-semibold">No authoritative audit events yet</div><div className="mt-1 text-xs text-slate-500">New audited changes will appear here automatically.</div></div> : <div className="overflow-x-auto"><table className="w-full text-left text-xs"><thead className="bg-slate-50 text-slate-500"><tr>{["Timestamp","Actor","Action","Entity","Reason","Request","Trace"].map((heading) => <th key={heading} className="px-4 py-2.5">{heading}</th>)}</tr></thead><tbody>{(query.data ?? []).map((event) => { const snapshot = actorSnapshot(event); const actorName = event.actorDisplayName ?? snapshot.displayName ?? "System / deleted actor"; const actorEmail = event.actorEmail ?? snapshot.email; return <tr key={event.id} className="border-t border-slate-100 align-top"><td className="whitespace-nowrap px-4 py-3 text-slate-500">{new Date(event.occurredAt).toLocaleString()}</td><td className="px-4 py-3"><div className="font-semibold">{actorName}</div>{actorEmail && <div className="mt-0.5 text-[10px] text-slate-400">{actorEmail}</div>}</td><td className="px-4 py-3 font-semibold text-slate-900">{event.action.replaceAll("_", " ")}</td><td className="px-4 py-3"><div>{event.entityType.replaceAll("_", " ")}</div><div className="mt-0.5 max-w-40 truncate font-mono text-[10px] text-slate-400">{event.entityId}</div></td><td className="max-w-56 px-4 py-3 text-slate-600">{event.reason ?? "—"}</td><td className="max-w-40 px-4 py-3"><span className="font-mono text-[10px] text-slate-500">{event.requestId ?? "—"}</span></td><td className="px-4 py-3"><details><summary className="cursor-pointer font-semibold text-blue-600">Before / after</summary><div className="mt-2 grid min-w-[420px] grid-cols-2 gap-2"><pre className="max-h-72 overflow-auto rounded-lg bg-slate-950 p-3 text-[10px] leading-4 text-slate-100">{formatJson(event.before)}</pre><pre className="max-h-72 overflow-auto rounded-lg bg-slate-950 p-3 text-[10px] leading-4 text-slate-100">{formatJson(event.after)}</pre></div></details></td></tr>; })}</tbody></table></div>}</Panel>}
  </div>;
}
