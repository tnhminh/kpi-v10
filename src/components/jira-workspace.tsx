"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, CheckCircle2, Clock3, Database, KeyRound, LoaderCircle, Network, Plus, RefreshCw, Save, ShieldCheck, Users, XCircle } from "lucide-react";
import { api, ClientApiError, type JiraConnectionDto, type JiraSyncConfigDto, type OrganizationAccess } from "@/client/api";

function Panel({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <section className={`rounded-xl border border-slate-200 bg-white shadow-[0_1px_2px_rgba(15,23,42,.04)] ${className}`}>{children}</section>;
}
function errorMessage(error: unknown) { return error instanceof ClientApiError ? `${error.message}${error.requestId ? ` · ${error.requestId}` : ""}` : error instanceof Error ? error.message : "Request failed."; }
function formatTime(value: string | null) { return value ? new Date(value).toLocaleString() : "Never"; }
function statusTone(status: string) { return status === "SUCCEEDED" ? "bg-emerald-50 text-emerald-700 ring-emerald-200" : status === "FAILED" ? "bg-rose-50 text-rose-700 ring-rose-200" : "bg-amber-50 text-amber-700 ring-amber-200"; }
function StatusBadge({ status }: { status: string }) { return <span className={`inline-flex rounded-md px-2 py-1 text-[10px] font-bold ring-1 ring-inset ${statusTone(status)}`}>{status}</span>; }

type MappingDraft = { memberId: string; jiraAccountId: string; jiraDisplayName: string };
export default function JiraWorkspace({ organization }: { organization: OrganizationAccess }) {
  const queryClient = useQueryClient();
  const admin = organization.role === "ADMINISTRATOR";
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [workspaceUrl, setWorkspaceUrl] = useState("");
  const [secretRef, setSecretRef] = useState("env:JIRA_BACKEND_CREDENTIALS");
  const [jql, setJql] = useState("ORDER BY updated ASC");
  const [fields, setFields] = useState("");
  const [factMappingsJson, setFactMappingsJson] = useState("{}");
  const [mappingDraftsByConnection, setMappingDraftsByConnection] = useState<Record<string, MappingDraft[]>>({});
  const [tab, setTab] = useState<"overview" | "mapping" | "facts" | "runs">("overview");
  const [message, setMessage] = useState<string | null>(null);

  const connectionsQuery = useQuery({
    queryKey: ["jira-connections", organization.organizationId],
    queryFn: () => api.jira.connections(organization.organizationId),
    enabled: admin,
  });
  const connections = useMemo(() => connectionsQuery.data ?? [], [connectionsQuery.data]);
  const selected = connections.find((item) => item.id === selectedId) ?? connections[0] ?? null;

  const membersQuery = useQuery({ queryKey: ["members", organization.organizationId], queryFn: () => api.organizations.members(organization.organizationId), enabled: admin });
  const mappingsQuery = useQuery({ queryKey: ["jira-mappings", organization.organizationId, selected?.id], queryFn: () => api.jira.mappings(organization.organizationId, selected!.id), enabled: admin && Boolean(selected?.id) });
  const factsQuery = useQuery({ queryKey: ["jira-facts", organization.organizationId, selected?.id], queryFn: () => api.jira.facts(organization.organizationId, selected!.id), enabled: admin && Boolean(selected?.id) });
  const runsQuery = useQuery({ queryKey: ["jira-runs", organization.organizationId, selected?.id], queryFn: () => api.jira.runs(organization.organizationId, selected!.id), enabled: admin && Boolean(selected?.id) });

  const persistedMappingDrafts = useMemo(() => (mappingsQuery.data ?? []).map((item) => ({ memberId: item.memberId, jiraAccountId: item.jiraAccountId, jiraDisplayName: item.jiraDisplayName ?? "" })), [mappingsQuery.data]);
  const mappingDrafts = selected ? mappingDraftsByConnection[selected.id] ?? persistedMappingDrafts : [];
  function setMappingDrafts(update: MappingDraft[] | ((rows: MappingDraft[]) => MappingDraft[])) {
    if (!selected) return;
    setMappingDraftsByConnection((current) => {
      const base = current[selected.id] ?? persistedMappingDrafts;
      const next = typeof update === "function" ? update(base) : update;
      return { ...current, [selected.id]: next };
    });
  }

  async function refreshSelected() {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["jira-connections", organization.organizationId] }),
      queryClient.invalidateQueries({ queryKey: ["jira-mappings", organization.organizationId, selected?.id] }),
      queryClient.invalidateQueries({ queryKey: ["jira-facts", organization.organizationId, selected?.id] }),
      queryClient.invalidateQueries({ queryKey: ["jira-runs", organization.organizationId, selected?.id] }),
    ]);
  }

  const createMutation = useMutation({
    mutationFn: async () => {
      let factMappings: JiraSyncConfigDto["factMappings"];
      try { factMappings = JSON.parse(factMappingsJson) as JiraSyncConfigDto["factMappings"]; }
      catch { throw new Error("Fact mappings must be valid JSON."); }
      return api.jira.createConnection(organization.organizationId, {
        workspaceUrl: workspaceUrl.trim(),
        secretRef: secretRef.trim(),
        syncConfig: { jql: jql.trim(), fields: fields.split(",").map((value) => value.trim()).filter(Boolean), factMappings },
      });
    },
    onSuccess: async (connection) => {
      setSelectedId(connection.id); setWorkspaceUrl(""); setMessage("Jira connection saved. Credential material remains outside the database; only its secret reference is stored.");
      await queryClient.invalidateQueries({ queryKey: ["jira-connections", organization.organizationId] });
    },
  });
  const syncMutation = useMutation({
    mutationFn: () => api.jira.sync(organization.organizationId, selected!.id),
    onSuccess: async (run) => { setMessage(`Sync ${run.status.toLowerCase()}: ${run.issuesSeen} issues, ${run.issuesMapped} mapped, ${run.issuesUnmapped} unmapped.`); await refreshSelected(); },
  });
  const saveMappingsMutation = useMutation({
    mutationFn: () => api.jira.replaceMappings(organization.organizationId, selected!.id, mappingDrafts.filter((row) => row.memberId && row.jiraAccountId.trim()).map((row) => ({ memberId: row.memberId, jiraAccountId: row.jiraAccountId.trim(), jiraDisplayName: row.jiraDisplayName.trim() || null }))),
    onSuccess: async (saved) => {
      if (selected) setMappingDraftsByConnection((current) => ({ ...current, [selected.id]: saved.map((item) => ({ memberId: item.memberId, jiraAccountId: item.jiraAccountId, jiraDisplayName: item.jiraDisplayName ?? "" })) }));
      setMessage("Member ↔ Jira account mapping saved."); await refreshSelected();
    },
  });

  const unmappedFacts = useMemo(() => (factsQuery.data ?? []).filter((item) => !item.memberId).length, [factsQuery.data]);
  const anyError = connectionsQuery.error ?? mappingsQuery.error ?? factsQuery.error ?? runsQuery.error ?? createMutation.error ?? syncMutation.error ?? saveMappingsMutation.error;

  if (!admin) return <div><div className="mb-5"><div className="mb-1 text-[11px] font-bold uppercase tracking-[.12em] text-blue-600">Integration</div><h1 className="text-[24px] font-semibold tracking-tight text-slate-950">Jira Control Center</h1><p className="mt-1 max-w-3xl text-sm text-slate-500">Jira credentials, account mappings and sync execution are administrative integration authority.</p></div><Panel className="p-6"><div className="flex items-start gap-3"><ShieldCheck className="mt-0.5 text-slate-500" size={20}/><div><div className="font-semibold">Administrator access required</div><p className="mt-1 text-sm text-slate-500">Your organization role is {organization.role}. Jira integration configuration is intentionally not exposed to review or member roles.</p></div></div></Panel></div>;

  return <div>
    <div className="mb-5 flex items-start justify-between gap-4"><div><div className="mb-1 text-[11px] font-bold uppercase tracking-[.12em] text-blue-600">Integration · T08</div><h1 className="text-[24px] font-semibold tracking-tight text-slate-950">Jira Control Center</h1><p className="mt-1 max-w-3xl text-sm text-slate-500">Operate Jira as a traceable evidence source: credentials by reference, explicit member mapping, normalized current facts and immutable evaluation snapshots.</p></div>{selected && <button disabled={syncMutation.isPending} onClick={() => syncMutation.mutate()} className="flex items-center gap-2 rounded-lg bg-slate-950 px-3.5 py-2 text-sm font-semibold text-white disabled:opacity-50">{syncMutation.isPending ? <LoaderCircle size={15} className="animate-spin"/> : <RefreshCw size={15}/>} Sync now</button>}</div>

    {message && <div className="mb-4 flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-semibold text-emerald-800"><CheckCircle2 size={14}/>{message}</div>}
    {anyError && <div className="mb-4 flex items-start gap-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-800"><AlertTriangle size={14} className="mt-0.5 shrink-0"/><div><b>Integration request failed.</b> {errorMessage(anyError)}</div></div>}

    <div className="grid grid-cols-[310px_1fr] gap-4">
      <div className="space-y-4">
        <Panel className="p-4"><div className="mb-3 flex items-center justify-between"><div><h2 className="text-sm font-semibold">Connections</h2><p className="text-[10px] text-slate-400">Organization-scoped Jira Cloud workspaces</p></div><Network size={16} className="text-blue-600"/></div>{connectionsQuery.isPending ? <div className="py-6 text-center text-xs text-slate-400">Loading…</div> : connections.length === 0 ? <div className="rounded-lg bg-slate-50 p-3 text-xs text-slate-500">No Jira connection configured.</div> : <div className="space-y-2">{connections.map((connection: JiraConnectionDto) => <button key={connection.id} onClick={() => setSelectedId(connection.id)} className={`w-full rounded-lg border p-3 text-left ${selected?.id === connection.id ? "border-blue-300 bg-blue-50" : "border-slate-200 hover:bg-slate-50"}`}><div className="truncate text-xs font-semibold">{connection.workspaceUrl.replace(/^https:\/\//, "")}</div><div className="mt-2 flex items-center justify-between"><span className="text-[10px] text-slate-500">{connection.factCount} facts · {connection.mappingCount} mappings</span>{connection.latestRun ? <StatusBadge status={connection.latestRun.status}/> : <span className="text-[10px] text-slate-400">Never synced</span>}</div></button>)}</div>}</Panel>
        <Panel className="p-4"><div className="mb-3 flex items-center gap-2"><Plus size={15}/><h2 className="text-sm font-semibold">Add Jira Cloud</h2></div><label className="text-[10px] font-bold uppercase text-slate-400">Workspace URL</label><input value={workspaceUrl} onChange={(event) => setWorkspaceUrl(event.target.value)} placeholder="https://company.atlassian.net" className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-xs outline-none"/><label className="mt-3 block text-[10px] font-bold uppercase text-slate-400">Credential reference</label><div className="relative mt-1"><KeyRound size={13} className="absolute left-2.5 top-2.5 text-slate-400"/><input value={secretRef} onChange={(event) => setSecretRef(event.target.value)} placeholder="env:JIRA_BACKEND_CREDENTIALS" className="w-full rounded-lg border border-slate-200 py-2 pl-8 pr-3 text-xs outline-none"/></div><p className="mt-1 text-[9px] leading-4 text-slate-400">Store JSON credentials in the runtime secret source. The database/API stores only this reference.</p><label className="mt-3 block text-[10px] font-bold uppercase text-slate-400">JQL</label><textarea value={jql} onChange={(event) => setJql(event.target.value)} rows={2} maxLength={4000} className="mt-1 w-full resize-none rounded-lg border border-slate-200 px-3 py-2 text-xs outline-none"/><label className="mt-3 block text-[10px] font-bold uppercase text-slate-400">Extra fields</label><input value={fields} onChange={(event) => setFields(event.target.value)} placeholder="duedate, resolutiondate, customfield_10016" className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-xs outline-none"/><label className="mt-3 block text-[10px] font-bold uppercase text-slate-400">Fact mappings JSON</label><textarea value={factMappingsJson} onChange={(event) => setFactMappingsJson(event.target.value)} rows={4} spellCheck={false} className="mt-1 w-full resize-y rounded-lg border border-slate-200 px-3 py-2 font-mono text-[10px] outline-none"/><button disabled={createMutation.isPending || !workspaceUrl.trim() || !secretRef.trim() || !jql.trim()} onClick={() => createMutation.mutate()} className="mt-3 flex w-full items-center justify-center gap-2 rounded-lg bg-blue-600 px-3 py-2 text-xs font-semibold text-white disabled:opacity-50">{createMutation.isPending && <LoaderCircle size={13} className="animate-spin"/>} Save connection</button></Panel>
      </div>

      {!selected ? <Panel className="grid min-h-[520px] place-items-center p-8 text-center"><div><Database size={28} className="mx-auto text-slate-300"/><div className="mt-3 font-semibold">Configure a Jira workspace</div><p className="mt-1 text-xs text-slate-500">Then map Jira accounts to members and run a traceable sync.</p></div></Panel> : <div>
        <div className="grid grid-cols-4 gap-3">{[
          ["Last sync", formatTime(selected.lastSyncAt), Clock3],
          ["Normalized facts", String(selected.factCount), Database],
          ["Member mappings", String(selected.mappingCount), Users],
          ["Unmapped facts", String(unmappedFacts), AlertTriangle],
        ].map(([label, value, Icon]) => <Panel key={String(label)} className="p-4"><div className="flex items-center justify-between"><span className="text-[10px] font-bold uppercase tracking-wide text-slate-400">{String(label)}</span><Icon size={14} className="text-slate-400"/></div><div className="mt-2 text-lg font-semibold">{String(value)}</div></Panel>)}</div>
        <Panel className="mt-4 overflow-hidden"><div className="flex border-b border-slate-200 bg-slate-50 px-3">{(["overview", "mapping", "facts", "runs"] as const).map((item) => <button key={item} onClick={() => setTab(item)} className={`border-b-2 px-4 py-3 text-xs font-semibold capitalize ${tab === item ? "border-blue-600 text-blue-700" : "border-transparent text-slate-500"}`}>{item}</button>)}</div>
          {tab === "overview" && <div className="p-5"><div className="grid grid-cols-2 gap-4"><div className="rounded-xl border border-slate-200 p-4"><div className="text-[10px] font-bold uppercase text-slate-400">Workspace</div><div className="mt-2 text-sm font-semibold">{selected.workspaceUrl}</div><div className="mt-3 flex gap-2"><span className="rounded-md bg-emerald-50 px-2 py-1 text-[10px] font-semibold text-emerald-700">{selected.active ? "ACTIVE" : "INACTIVE"}</span><span className="rounded-md bg-slate-100 px-2 py-1 text-[10px] font-semibold text-slate-600">{selected.secretConfigured ? "SECRET REF CONFIGURED" : "NO SECRET"}</span></div></div><div className="rounded-xl border border-slate-200 p-4"><div className="text-[10px] font-bold uppercase text-slate-400">Sync policy</div><div className="mt-2 font-mono text-[11px] text-slate-700">{selected.syncConfig.jql}</div><div className="mt-3 text-[10px] text-slate-500">{Object.keys(selected.syncConfig.factMappings).length} declarative fact mappings · {selected.syncConfig.fields.length} extra fields</div></div></div><div className="mt-4 rounded-xl border border-blue-100 bg-blue-50/60 p-4"><div className="flex gap-3"><ShieldCheck size={18} className="mt-0.5 text-blue-700"/><div><div className="text-sm font-semibold text-blue-950">Historical safety boundary</div><p className="mt-1 text-xs leading-5 text-blue-800">This page manages mutable current Jira facts. T08-B snapshots the exact facts used by an evaluation; those snapshots are database-immutable and Jira changes must not silently rewrite reviewed results.</p></div></div></div></div>}
          {tab === "mapping" && <div className="p-5"><div className="mb-3 flex items-center justify-between"><div><h3 className="text-sm font-semibold">Member ↔ Jira account mapping</h3><p className="text-[10px] text-slate-500">Explicit identity attribution only. Display-name guessing is not authority.</p></div><div className="flex gap-2"><button onClick={() => setMappingDrafts((rows) => [...rows, { memberId: "", jiraAccountId: "", jiraDisplayName: "" }])} className="flex items-center gap-1 rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-semibold"><Plus size={12}/> Row</button><button disabled={saveMappingsMutation.isPending} onClick={() => saveMappingsMutation.mutate()} className="flex items-center gap-1 rounded-lg bg-slate-950 px-2.5 py-1.5 text-xs font-semibold text-white"><Save size={12}/> Save</button></div></div><div className="space-y-2">{mappingDrafts.length === 0 && <div className="rounded-lg bg-slate-50 p-5 text-center text-xs text-slate-500">No account mappings yet.</div>}{mappingDrafts.map((row, index) => <div key={`${index}-${row.memberId}`} className="grid grid-cols-[1fr_1fr_1fr_32px] gap-2"><select value={row.memberId} onChange={(event) => setMappingDrafts((rows) => rows.map((current, i) => i === index ? { ...current, memberId: event.target.value } : current))} className="rounded-lg border border-slate-200 px-2 py-2 text-xs"><option value="">Select member…</option>{(membersQuery.data ?? []).map((member) => <option key={member.id} value={member.id}>{member.name} · {member.employeeId}</option>)}</select><input value={row.jiraAccountId} onChange={(event) => setMappingDrafts((rows) => rows.map((current, i) => i === index ? { ...current, jiraAccountId: event.target.value } : current))} placeholder="Jira accountId" className="rounded-lg border border-slate-200 px-2 py-2 text-xs"/><input value={row.jiraDisplayName} onChange={(event) => setMappingDrafts((rows) => rows.map((current, i) => i === index ? { ...current, jiraDisplayName: event.target.value } : current))} placeholder="Display name (optional)" className="rounded-lg border border-slate-200 px-2 py-2 text-xs"/><button onClick={() => setMappingDrafts((rows) => rows.filter((_, i) => i !== index))} title="Remove mapping" className="grid place-items-center rounded-lg border border-slate-200 text-slate-400 hover:text-rose-600"><XCircle size={14}/></button></div>)}</div></div>}
          {tab === "facts" && <div className="overflow-x-auto"><table className="w-full text-left text-xs"><thead className="bg-slate-50 text-slate-500"><tr>{["Issue", "Member", "Observed", "Normalized facts"].map((head) => <th key={head} className="px-4 py-2.5 font-semibold">{head}</th>)}</tr></thead><tbody>{(factsQuery.data ?? []).map((fact) => <tr key={fact.id} className="border-t border-slate-100 align-top"><td className="px-4 py-3"><div className="font-semibold text-blue-700">{fact.issueKey}</div><div className="mt-1 max-w-60 truncate text-[10px] text-slate-500">{fact.summary}</div></td><td className="px-4 py-3">{fact.memberName ?? <span className="font-semibold text-amber-600">Unmapped</span>}</td><td className="px-4 py-3 text-[10px] text-slate-500">{formatTime(fact.observedAt)}</td><td className="px-4 py-3"><pre className="max-w-[520px] whitespace-pre-wrap break-words rounded-md bg-slate-50 p-2 text-[9px] leading-4 text-slate-600">{JSON.stringify(fact.facts, null, 2)}</pre></td></tr>)}{factsQuery.data?.length === 0 && <tr><td colSpan={4} className="p-8 text-center text-slate-400">No normalized facts yet. Run a successful sync after credential and mapping setup.</td></tr>}</tbody></table></div>}
          {tab === "runs" && <div className="overflow-x-auto"><table className="w-full text-left text-xs"><thead className="bg-slate-50 text-slate-500"><tr>{["Started", "Status", "Pages", "Seen", "Mapped", "Unmapped", "Error"].map((head) => <th key={head} className="px-4 py-2.5 font-semibold">{head}</th>)}</tr></thead><tbody>{(runsQuery.data ?? []).map((run) => <tr key={run.id} className="border-t border-slate-100"><td className="px-4 py-3 text-[10px]">{formatTime(run.startedAt)}</td><td className="px-4 py-3"><StatusBadge status={run.status}/></td><td className="px-4 py-3">{run.pagesFetched}</td><td className="px-4 py-3">{run.issuesSeen}</td><td className="px-4 py-3">{run.issuesMapped}</td><td className="px-4 py-3">{run.issuesUnmapped}</td><td className="max-w-72 px-4 py-3 text-[10px] text-rose-600">{run.errorCode ? `${run.errorCode}: ${run.errorMessage}` : "—"}</td></tr>)}{runsQuery.data?.length === 0 && <tr><td colSpan={7} className="p-8 text-center text-slate-400">No sync runs recorded.</td></tr>}</tbody></table></div>}
        </Panel>
      </div>}
    </div>
  </div>;
}
