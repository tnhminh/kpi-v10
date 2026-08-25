"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, LoaderCircle, LockKeyhole, Target } from "lucide-react";
import { useState } from "react";
import { api, ClientApiError, type OrganizationAccess } from "@/client/api";
import Studio from "./studio";

function CenterCard({ children }: { children: React.ReactNode }) {
  return <main className="grid min-h-screen place-items-center bg-slate-100 p-6"><section className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-7 shadow-xl shadow-slate-200/40">{children}</section></main>;
}

function Login({ serverMessage }: { serverMessage?: string }) {
  const queryClient = useQueryClient();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const mutation = useMutation({
    mutationFn: () => api.auth.login(email, password),
    onSuccess: async () => {
      setPassword("");
      await queryClient.invalidateQueries({ queryKey: ["session"] });
    },
  });
  const error = mutation.error instanceof ClientApiError ? mutation.error.message : mutation.error ? "Login failed." : null;
  return <CenterCard><div className="flex items-center gap-3"><div className="grid h-11 w-11 place-items-center rounded-xl bg-slate-950 text-white"><Target size={21}/></div><div><h1 className="font-semibold text-slate-950">KPI Performance Studio</h1><p className="text-xs text-slate-500">Authenticated production workspace</p></div></div><div className="mt-7"><div className="mb-4 flex items-start gap-2 rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs text-slate-600"><LockKeyhole size={15} className="mt-0.5 shrink-0"/><span>Sign in with an account provisioned by your administrator. Demo role switching is disabled as authority.</span></div>{serverMessage&&<div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">{serverMessage}</div>}<form onSubmit={(event)=>{event.preventDefault();mutation.mutate()}} className="space-y-4"><div><label className="text-xs font-semibold text-slate-700">Email</label><input type="email" autoComplete="username" value={email} onChange={(event)=>setEmail(event.target.value)} required maxLength={254} className="mt-1.5 w-full rounded-lg border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-blue-400"/></div><div><label className="text-xs font-semibold text-slate-700">Password</label><input type="password" autoComplete="current-password" value={password} onChange={(event)=>setPassword(event.target.value)} required maxLength={256} className="mt-1.5 w-full rounded-lg border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-blue-400"/></div>{error&&<div className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-xs text-rose-700">{error}</div>}<button type="submit" disabled={mutation.isPending} className="flex w-full items-center justify-center gap-2 rounded-lg bg-slate-950 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-60">{mutation.isPending&&<LoaderCircle size={15} className="animate-spin"/>} Sign in</button></form></div></CenterCard>;
}

function ChangeTemporaryPassword({ onLogout }: { onLogout: () => void }) {
  const queryClient = useQueryClient();
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const mutation = useMutation({
    mutationFn: () => api.auth.changePassword(currentPassword, newPassword),
    onSuccess: async () => {
      setCurrentPassword(""); setNewPassword(""); setConfirmPassword("");
      await queryClient.invalidateQueries({ queryKey: ["session"] });
    },
  });
  const mismatch = Boolean(confirmPassword) && newPassword !== confirmPassword;
  const error = mutation.error instanceof ClientApiError ? mutation.error.message : mutation.error ? "Password change failed." : null;
  return <CenterCard><div className="flex items-center gap-3"><div className="grid h-11 w-11 place-items-center rounded-xl bg-amber-50 text-amber-700"><LockKeyhole size={21}/></div><div><h1 className="font-semibold text-slate-950">Change temporary password</h1><p className="text-xs text-slate-500">Required before accessing KPI Studio</p></div></div><p className="mt-5 text-xs leading-5 text-slate-600">Your administrator provisioned this account with a temporary password. Choose a new password of at least 12 characters before continuing.</p><form onSubmit={(event)=>{event.preventDefault();if(!mismatch)mutation.mutate()}} className="mt-5 space-y-4"><div><label className="text-xs font-semibold">Temporary password</label><input type="password" autoComplete="current-password" value={currentPassword} onChange={(event)=>setCurrentPassword(event.target.value)} required maxLength={256} className="mt-1.5 w-full rounded-lg border border-slate-200 px-3 py-2.5 text-sm"/></div><div><label className="text-xs font-semibold">New password</label><input type="password" autoComplete="new-password" value={newPassword} onChange={(event)=>setNewPassword(event.target.value)} required minLength={12} maxLength={256} className="mt-1.5 w-full rounded-lg border border-slate-200 px-3 py-2.5 text-sm"/></div><div><label className="text-xs font-semibold">Confirm new password</label><input type="password" autoComplete="new-password" value={confirmPassword} onChange={(event)=>setConfirmPassword(event.target.value)} required minLength={12} maxLength={256} className="mt-1.5 w-full rounded-lg border border-slate-200 px-3 py-2.5 text-sm"/></div>{mismatch&&<div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">New passwords do not match.</div>}{error&&<div className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-xs text-rose-700">{error}</div>}<button type="submit" disabled={mutation.isPending||mismatch||newPassword.length<12} className="flex w-full items-center justify-center gap-2 rounded-lg bg-slate-950 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50">{mutation.isPending&&<LoaderCircle size={15} className="animate-spin"/>} Set new password</button><button type="button" onClick={onLogout} className="w-full rounded-lg border border-slate-200 px-4 py-2.5 text-sm font-semibold text-slate-600">Sign out</button></form></CenterCard>;
}

function BackendUnavailable({ error, retry }: { error: unknown; retry: () => void }) {
  const message = error instanceof ClientApiError ? `${error.message}${error.requestId ? ` · Request ${error.requestId}` : ""}` : "The application backend is unavailable.";
  return <CenterCard><div className="flex items-start gap-3"><div className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-amber-50 text-amber-700"><AlertTriangle size={19}/></div><div><h1 className="font-semibold">Backend unavailable</h1><p className="mt-1 text-sm text-slate-500">{message}</p></div></div><p className="mt-5 text-xs leading-5 text-slate-500">The UI will not fall back to seeded demo data when authentication or persistence infrastructure is unavailable. Verify the server environment and database readiness.</p><button onClick={retry} className="mt-5 rounded-lg bg-slate-950 px-4 py-2 text-sm font-semibold text-white">Retry</button></CenterCard>;
}

function AuthenticatedGateway() {
  const queryClient = useQueryClient();
  const session = useQuery({ queryKey: ["session"], queryFn: api.auth.me });
  const organizations = useQuery({ queryKey: ["organizations"], queryFn: api.organizations.list, enabled: session.isSuccess && !session.data.passwordChangeRequired });
  const [selectedOrganizationId, setSelectedOrganizationId] = useState<string | null>(null);
  const logout = useMutation({
    mutationFn: api.auth.logout,
    onSettled: () => queryClient.clear(),
  });

  if (session.isPending) return <CenterCard><div className="flex items-center justify-center gap-2 text-sm font-medium text-slate-600"><LoaderCircle size={17} className="animate-spin"/> Verifying session…</div></CenterCard>;
  if (session.error) {
    if (session.error instanceof ClientApiError && session.error.status === 401) return <Login/>;
    return <BackendUnavailable error={session.error} retry={()=>void session.refetch()}/>;
  }
  if (session.data.passwordChangeRequired) return <ChangeTemporaryPassword onLogout={()=>logout.mutate()}/>;
  if (organizations.isPending) return <CenterCard><div className="flex items-center justify-center gap-2 text-sm font-medium text-slate-600"><LoaderCircle size={17} className="animate-spin"/> Loading organization access…</div></CenterCard>;
  if (organizations.error) return <BackendUnavailable error={organizations.error} retry={()=>void organizations.refetch()}/>;
  if (!organizations.data?.length) return <CenterCard><div className="flex items-start gap-3"><LockKeyhole size={20} className="mt-0.5 text-slate-500"/><div><h1 className="font-semibold">No organization access</h1><p className="mt-1 text-sm text-slate-500">Your account is authenticated but has no active organization assignment.</p></div></div></CenterCard>;

  const active: OrganizationAccess = organizations.data.find((item)=>item.organizationId === selectedOrganizationId) ?? organizations.data[0];
  return <Studio
    user={session.data}
    organizations={organizations.data}
    organization={active}
    onOrganizationChange={setSelectedOrganizationId}
    onLogout={()=>logout.mutate()}
  />;
}

export default function AppGateway() {
  return <AuthenticatedGateway/>;
}
