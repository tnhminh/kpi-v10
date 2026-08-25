"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, CalendarDays, LoaderCircle, ShieldCheck, UserCog, X } from "lucide-react";
import { api, ClientApiError, type DepartmentHeadAssignmentDto, type OrganizationAccess, type OrganizationUserDto } from "@/client/api";

function Panel({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <section className={`rounded-xl border border-slate-200 bg-white shadow-[0_1px_2px_rgba(15,23,42,.04)] ${className}`}>{children}</section>;
}

function message(error: unknown) {
  return error instanceof ClientApiError ? `${error.message}${error.requestId ? ` · ${error.requestId}` : ""}` : error instanceof Error ? error.message : "The request could not be completed.";
}

function todayInput() {
  const now = new Date();
  const offset = now.getTimezoneOffset() * 60_000;
  return new Date(now.getTime() - offset).toISOString().slice(0, 10);
}

function assignmentState(row: DepartmentHeadAssignmentDto) {
  const today = todayInput();
  if (row.effectiveFrom > today) return "UPCOMING";
  if (row.effectiveTo && row.effectiveTo < today) return "CLOSED";
  return "ACTIVE";
}

export default function AdministrationWorkspace({ organization }: { organization: OrganizationAccess }) {
  const queryClient = useQueryClient();
  const canManage = organization.role === "ADMINISTRATOR";
  const [showCreate, setShowCreate] = useState(false);
  const [showProvision, setShowProvision] = useState(false);
  const [provisionMemberId, setProvisionMemberId] = useState("");
  const [provisionName, setProvisionName] = useState("");
  const [provisionEmail, setProvisionEmail] = useState("");
  const [provisionRole, setProvisionRole] = useState<"MEMBER" | "TEAM_LEADER" | "DEPARTMENT_HEAD" | "ADMINISTRATOR">("MEMBER");
  const [temporaryPassword, setTemporaryPassword] = useState("");
  const [departmentId, setDepartmentId] = useState("");
  const [userId, setUserId] = useState("");
  const [effectiveFrom, setEffectiveFrom] = useState(todayInput());
  const [effectiveTo, setEffectiveTo] = useState("");
  const [closing, setClosing] = useState<DepartmentHeadAssignmentDto | null>(null);
  const [closeDate, setCloseDate] = useState(todayInput());

  const usersQuery = useQuery({
    queryKey: ["admin-users", organization.organizationId],
    queryFn: () => api.administration.users(organization.organizationId),
    enabled: canManage,
  });
  const assignmentsQuery = useQuery({
    queryKey: ["department-head-assignments", organization.organizationId],
    queryFn: () => api.administration.departmentHeadAssignments(organization.organizationId),
    enabled: canManage,
  });
  const departmentsQuery = useQuery({
    queryKey: ["departments", organization.organizationId],
    queryFn: () => api.organizations.departments(organization.organizationId),
    enabled: canManage,
  });
  const membersQuery = useQuery({
    queryKey: ["members", organization.organizationId],
    queryFn: () => api.organizations.members(organization.organizationId),
    enabled: canManage,
  });

  const provisionMutation = useMutation({
    mutationFn: () => api.administration.provisionUser(organization.organizationId, {
      email: provisionEmail.trim(),
      displayName: provisionName.trim(),
      role: provisionRole,
      temporaryPassword,
      memberId: provisionMemberId || null,
    }),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["admin-users", organization.organizationId] }),
        queryClient.invalidateQueries({ queryKey: ["members", organization.organizationId] }),
      ]);
      setShowProvision(false); setProvisionMemberId(""); setProvisionName(""); setProvisionEmail(""); setProvisionRole("MEMBER"); setTemporaryPassword("");
    },
  });

  const createMutation = useMutation({
    mutationFn: () => api.administration.createDepartmentHeadAssignment(organization.organizationId, {
      departmentId,
      userId,
      effectiveFrom,
      effectiveTo: effectiveTo || null,
    }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["department-head-assignments", organization.organizationId] });
      setShowCreate(false);
      setDepartmentId("");
      setUserId("");
      setEffectiveFrom(todayInput());
      setEffectiveTo("");
    },
  });

  const closeMutation = useMutation({
    mutationFn: () => {
      if (!closing) throw new Error("No assignment selected.");
      return api.administration.closeDepartmentHeadAssignment(organization.organizationId, closing.id, closeDate);
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["department-head-assignments", organization.organizationId] });
      setClosing(null);
      setCloseDate(todayInput());
    },
  });

  const departmentHeads = useMemo(() => (usersQuery.data ?? []).filter((user: OrganizationUserDto) => user.role === "DEPARTMENT_HEAD" && user.userActive && user.accessActive), [usersQuery.data]);
  const assignments = assignmentsQuery.data ?? [];
  const activeAssignments = assignments.filter((item) => assignmentState(item) === "ACTIVE");
  const linkedMemberIds = new Set((usersQuery.data ?? []).map((user) => user.memberId).filter(Boolean));
  const unlinkedMembers = (membersQuery.data ?? []).filter((member) => member.active && !linkedMemberIds.has(member.id));

  if (!canManage) {
    return <div>
      <div className="mb-5"><div className="mb-1 text-[11px] font-bold uppercase tracking-[.12em] text-blue-600">Administration</div><h1 className="text-[24px] font-semibold tracking-tight text-slate-950">Organization administration</h1><p className="mt-1 text-sm text-slate-500">Administrator permission is required for user scope and Department Head assignments.</p></div>
      <Panel className="p-6"><div className="flex items-start gap-3"><ShieldCheck className="mt-0.5 text-slate-500" size={18}/><div><div className="text-sm font-semibold">Read restricted</div><div className="mt-1 text-xs text-slate-500">This surface intentionally does not attempt admin API calls for non-administrator organization access.</div></div></div></Panel>
    </div>;
  }

  const pending = usersQuery.isPending || assignmentsQuery.isPending || departmentsQuery.isPending || membersQuery.isPending;
  const error = usersQuery.error || assignmentsQuery.error || departmentsQuery.error || membersQuery.error;

  return <div>
    <div className="mb-5 flex items-start justify-between gap-4">
      <div><div className="mb-1 text-[11px] font-bold uppercase tracking-[.12em] text-blue-600">Administration</div><h1 className="text-[24px] font-semibold tracking-tight text-slate-950">Organization administration</h1><p className="mt-1 max-w-3xl text-sm text-slate-500">Inspect organization users and manage period-effective Department Head scope without rewriting historical review authority.</p></div>
      <div className="flex gap-2"><button onClick={() => { setProvisionMemberId(""); setProvisionName(""); setProvisionEmail(""); setProvisionRole("MEMBER"); setTemporaryPassword(""); setShowProvision(true); }} className="rounded-lg border border-slate-200 bg-white px-3.5 py-2 text-sm font-semibold text-slate-800">Provision user</button><button onClick={() => { setDepartmentId(departmentsQuery.data?.[0]?.id ?? ""); setUserId(departmentHeads[0]?.userId ?? ""); setEffectiveFrom(todayInput()); setEffectiveTo(""); setShowCreate(true); }} disabled={!departmentHeads.length || !(departmentsQuery.data?.length)} className="rounded-lg bg-slate-950 px-3.5 py-2 text-sm font-semibold text-white disabled:opacity-40">Assign Department Head</button></div>
    </div>

    {pending ? <Panel className="p-8 text-center text-sm text-slate-500"><LoaderCircle size={16} className="mr-2 inline animate-spin"/>Loading administration data…</Panel> : error ? <Panel className="border-rose-200 p-5"><div className="flex gap-3"><AlertTriangle size={17} className="text-rose-600"/><div className="text-sm text-rose-700">{message(error)}</div></div></Panel> : <>
      <div className="grid gap-3 md:grid-cols-3"><Panel className="p-4"><div className="text-xs text-slate-500">Organization users</div><div className="mt-2 text-2xl font-semibold">{usersQuery.data?.length ?? 0}</div></Panel><Panel className="p-4"><div className="text-xs text-slate-500">Eligible Department Heads</div><div className="mt-2 text-2xl font-semibold">{departmentHeads.length}</div></Panel><Panel className="p-4"><div className="text-xs text-slate-500">Active assignments</div><div className="mt-2 text-2xl font-semibold">{activeAssignments.length}</div></Panel></div>

      <div className="mt-4 grid gap-4 xl:grid-cols-[.9fr_1.1fr]">
        <Panel><div className="flex items-center gap-2 border-b border-slate-100 px-5 py-4"><UserCog size={17} className="text-blue-600"/><div><h2 className="font-semibold">Organization users</h2><p className="text-xs text-slate-500">Identity and organization role are server-owned.</p></div></div><div className="max-h-[520px] overflow-auto"><table className="w-full text-left text-xs"><thead className="sticky top-0 bg-slate-50 text-slate-500"><tr>{["User","Role","User","Access"].map((h) => <th key={h} className="px-4 py-2.5 font-semibold">{h}</th>)}</tr></thead><tbody>{(usersQuery.data ?? []).map((user) => <tr key={user.userId} className="border-t border-slate-100"><td className="px-4 py-3"><div className="font-semibold text-slate-900">{user.displayName}</div><div className="mt-0.5 text-[10px] text-slate-400">{user.email}</div></td><td className="px-4 py-3 font-semibold">{user.role}</td><td className="px-4 py-3">{user.userActive ? "Active" : "Inactive"}</td><td className="px-4 py-3">{user.accessActive ? "Active" : "Inactive"}</td></tr>)}</tbody></table></div></Panel>

        <Panel><div className="flex items-center gap-2 border-b border-slate-100 px-5 py-4"><CalendarDays size={17} className="text-violet-600"/><div><h2 className="font-semibold">Department Head scope history</h2><p className="text-xs text-slate-500">Assignments are effective-dated; past scope is preserved.</p></div></div>{assignments.length === 0 ? <div className="p-8 text-center text-sm text-slate-500">No Department Head assignments yet.</div> : <div className="overflow-auto"><table className="w-full text-left text-xs"><thead className="bg-slate-50 text-slate-500"><tr>{["Department","Department Head","Effective","State",""].map((h) => <th key={h} className="px-4 py-2.5 font-semibold">{h}</th>)}</tr></thead><tbody>{assignments.map((row) => { const state = assignmentState(row); return <tr key={row.id} className="border-t border-slate-100"><td className="px-4 py-3 font-semibold">{row.departmentName}</td><td className="px-4 py-3"><div className="font-medium">{row.userDisplayName}</div><div className="text-[10px] text-slate-400">{row.userEmail}</div></td><td className="px-4 py-3">{row.effectiveFrom} → {row.effectiveTo ?? "open"}</td><td className="px-4 py-3"><span className="rounded-md bg-slate-100 px-2 py-1 font-semibold">{state}</span></td><td className="px-4 py-3 text-right">{state === "ACTIVE" && <button onClick={() => { setClosing(row); setCloseDate(todayInput()); }} className="rounded-lg border border-slate-200 px-2.5 py-1.5 font-semibold hover:bg-slate-50">Close scope</button>}</td></tr>; })}</tbody></table></div>}</Panel>
      </div>
    </>}

    {showProvision && <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/35 p-6"><Panel className="w-full max-w-lg p-5"><div className="mb-4 flex justify-between"><div><h3 className="font-semibold">Provision organization user</h3><p className="mt-1 text-xs text-slate-500">The temporary password is never stored in audit metadata. The user must rotate it at first sign-in.</p></div><button onClick={() => setShowProvision(false)}><X size={18}/></button></div><div className="grid gap-3"><label className="text-xs font-semibold">Role<select value={provisionRole} onChange={(event)=>{const role=event.target.value as typeof provisionRole;setProvisionRole(role);if(role==="DEPARTMENT_HEAD"||role==="ADMINISTRATOR")setProvisionMemberId("")}} className="mt-1.5 w-full rounded-lg border border-slate-200 p-2.5 text-sm">{["MEMBER","TEAM_LEADER","DEPARTMENT_HEAD","ADMINISTRATOR"].map(role=><option key={role}>{role}</option>)}</select></label>{(provisionRole==="MEMBER"||provisionRole==="TEAM_LEADER")&&<label className="text-xs font-semibold">Linked member<select value={provisionMemberId} onChange={(event)=>{const id=event.target.value;setProvisionMemberId(id);const member=unlinkedMembers.find(item=>item.id===id);if(member){setProvisionName(member.name);setProvisionEmail(member.email)}}} className="mt-1.5 w-full rounded-lg border border-slate-200 p-2.5 text-sm"><option value="">Select unlinked member</option>{unlinkedMembers.map(member=><option key={member.id} value={member.id}>{member.name} · {member.email}</option>)}</select></label>}<label className="text-xs font-semibold">Display name<input value={provisionName} onChange={(event)=>setProvisionName(event.target.value)} className="mt-1.5 w-full rounded-lg border border-slate-200 px-3 py-2.5 text-sm"/></label><label className="text-xs font-semibold">Email<input type="email" value={provisionEmail} onChange={(event)=>setProvisionEmail(event.target.value)} className="mt-1.5 w-full rounded-lg border border-slate-200 px-3 py-2.5 text-sm"/></label><label className="text-xs font-semibold">Temporary password<input type="password" value={temporaryPassword} minLength={12} maxLength={256} onChange={(event)=>setTemporaryPassword(event.target.value)} className="mt-1.5 w-full rounded-lg border border-slate-200 px-3 py-2.5 text-sm"/><span className="mt-1 block text-[10px] font-normal text-slate-400">Minimum 12 characters. Share it out-of-band; the application will force rotation before Studio access.</span></label></div>{provisionMutation.error&&<div className="mt-3 rounded-lg border border-rose-200 bg-rose-50 p-3 text-xs text-rose-700">{message(provisionMutation.error)}</div>}<div className="mt-5 flex justify-end gap-2"><button onClick={()=>setShowProvision(false)} className="rounded-lg border border-slate-200 px-3.5 py-2 text-sm font-semibold">Cancel</button><button disabled={provisionMutation.isPending||!provisionName.trim()||!provisionEmail.trim()||temporaryPassword.length<12||((provisionRole==="MEMBER"||provisionRole==="TEAM_LEADER")&&!provisionMemberId)} onClick={()=>provisionMutation.mutate()} className="rounded-lg bg-blue-600 px-3.5 py-2 text-sm font-semibold text-white disabled:opacity-40">{provisionMutation.isPending?"Provisioning…":"Provision user"}</button></div></Panel></div>}

    {showCreate && <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/35 p-6"><Panel className="w-full max-w-lg p-5"><div className="mb-4 flex justify-between"><div><h3 className="font-semibold">Assign Department Head</h3><p className="mt-1 text-xs text-slate-500">Only active users with DEPARTMENT_HEAD organization role are eligible.</p></div><button onClick={() => setShowCreate(false)}><X size={18}/></button></div><div className="grid gap-3"><label className="text-xs font-semibold">Department<select value={departmentId} onChange={(event) => setDepartmentId(event.target.value)} className="mt-1.5 w-full rounded-lg border border-slate-200 p-2.5 text-sm"><option value="">Select department</option>{(departmentsQuery.data ?? []).map((department) => <option key={department.id} value={department.id}>{department.name}</option>)}</select></label><label className="text-xs font-semibold">Department Head<select value={userId} onChange={(event) => setUserId(event.target.value)} className="mt-1.5 w-full rounded-lg border border-slate-200 p-2.5 text-sm"><option value="">Select user</option>{departmentHeads.map((user) => <option key={user.userId} value={user.userId}>{user.displayName} · {user.email}</option>)}</select></label><div className="grid grid-cols-2 gap-3"><label className="text-xs font-semibold">Effective from<input type="date" value={effectiveFrom} onChange={(event) => setEffectiveFrom(event.target.value)} className="mt-1.5 w-full rounded-lg border border-slate-200 p-2.5 text-sm"/></label><label className="text-xs font-semibold">Effective to (optional)<input type="date" value={effectiveTo} min={effectiveFrom} onChange={(event) => setEffectiveTo(event.target.value)} className="mt-1.5 w-full rounded-lg border border-slate-200 p-2.5 text-sm"/></label></div></div>{createMutation.error && <div className="mt-3 rounded-lg border border-rose-200 bg-rose-50 p-3 text-xs text-rose-700">{message(createMutation.error)}</div>}<div className="mt-5 flex justify-end gap-2"><button onClick={() => setShowCreate(false)} className="rounded-lg border border-slate-200 px-3.5 py-2 text-sm font-semibold">Cancel</button><button disabled={createMutation.isPending || !departmentId || !userId || !effectiveFrom} onClick={() => createMutation.mutate()} className="rounded-lg bg-blue-600 px-3.5 py-2 text-sm font-semibold text-white disabled:opacity-40">{createMutation.isPending ? "Assigning…" : "Create assignment"}</button></div></Panel></div>}

    {closing && <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/35 p-6"><Panel className="w-full max-w-md p-5"><div className="mb-3 flex justify-between"><div><h3 className="font-semibold">Close Department Head scope</h3><p className="mt-1 text-xs text-slate-500">Past-date closure is forbidden to preserve historical authority.</p></div><button onClick={() => setClosing(null)}><X size={18}/></button></div><div className="rounded-lg bg-slate-50 p-3 text-xs"><b>{closing.userDisplayName}</b> · {closing.departmentName}<div className="mt-1 text-slate-500">Started {closing.effectiveFrom}</div></div><label className="mt-4 block text-xs font-semibold">Effective to<input type="date" min={todayInput()} value={closeDate} onChange={(event) => setCloseDate(event.target.value)} className="mt-1.5 w-full rounded-lg border border-slate-200 p-2.5 text-sm"/></label>{closeMutation.error && <div className="mt-3 rounded-lg border border-rose-200 bg-rose-50 p-3 text-xs text-rose-700">{message(closeMutation.error)}</div>}<div className="mt-5 flex justify-end gap-2"><button onClick={() => setClosing(null)} className="rounded-lg border border-slate-200 px-3.5 py-2 text-sm font-semibold">Cancel</button><button disabled={closeMutation.isPending || !closeDate} onClick={() => closeMutation.mutate()} className="rounded-lg bg-slate-950 px-3.5 py-2 text-sm font-semibold text-white disabled:opacity-40">{closeMutation.isPending ? "Closing…" : "Close scope"}</button></div></Panel></div>}
  </div>;
}
