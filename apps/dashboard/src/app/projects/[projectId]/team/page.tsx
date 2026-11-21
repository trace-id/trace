'use client';

import { Check, Copy, LogOut, MailPlus, Trash2, UserPlus, Users } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { Dialog, DialogClose, DialogContent } from '@/components/ui/overlay';
import { Badge, Button, Card, CardHeader, EmptyState, ErrorBanner, Field, Input, PageHeader, Select, Skeleton, Spinner, Table, Td, Th, Tr } from '@/components/ui/primitives';
import { useToast } from '@/components/ui/toast';
import { api, errorMessage } from '@/lib/api';
import { timeAgo } from '@/lib/format';
import type { InviteView, MemberView, MembersResponse, Role } from '@/lib/manage-types';
import { useProject } from '@/lib/project-context';
import { useApi } from '@/lib/use-api';

const RANK: Record<Role, number> = { viewer: 1, admin: 2, owner: 3 };
const ROLE_TEXT: Record<Role, string> = {
  viewer: 'Can look at everything but change nothing.',
  admin: 'Can also manage keys, webhooks, lists, alerts and invite people.',
  owner: 'Can also change roles, remove admins and delete the project.',
};
const TONE: Record<Role, 'neutral' | 'info' | 'warn'> = { viewer: 'neutral', admin: 'info', owner: 'warn' };

function Invite({ mine, onDone }: { mine: Role; onDone: () => void }) {
  const { project } = useProject();
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<Role>('viewer');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ result: 'added' | 'invited'; email: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const toast = useToast();
  const roles = (['viewer', 'admin', 'owner'] as const).filter((r) => RANK[r] <= RANK[mine]);
  const link = typeof window === 'undefined' ? '' : `${window.location.origin}/login`;

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ result: 'added' | 'invited' }>(`/v1/projects/${project.id}/members`, { method: 'POST', body: { email: email.trim(), role } });
      setDone({ result: r.result, email: email.trim() });
      setEmail('');
      if (r.result === 'added') toast({ tone: 'ok', title: 'Added to the project' });
      onDone();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Button variant="primary" onClick={() => { setOpen(true); setDone(null); setError(null); }}><UserPlus className="size-3.5" /> Invite someone</Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent title="Invite someone" description="They get access as soon as they have an account with this email address.">
          {done ? (
            <div className="grid gap-4">
              {done.result === 'added' ? (
                <p className="rounded-xl border border-ok/30 bg-ok-soft p-3.5 text-[13px] text-ok"><b>{done.email}</b> already has an account and now has access.</p>
              ) : (
                <>
                  <p className="rounded-xl border border-signal/30 bg-signal-soft p-3.5 text-[13px] text-signal-ink">Invitation saved for <b>{done.email}</b>. Trace does not send email, so send them this link. They sign up with that same address and the project is theirs, even though sign-up is closed.</p>
                  <div className="flex items-center gap-2 rounded-xl border border-line bg-surface-2 px-3 py-2"><code className="min-w-0 flex-1 truncate font-mono text-xs">{link}</code><Button size="sm" variant="outline" onClick={() => { void navigator.clipboard.writeText(link); setCopied(true); setTimeout(() => setCopied(false), 1500); }}>{copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />} {copied ? 'Copied' : 'Copy'}</Button></div>
                  <p className="text-xs text-ink-3">Email addresses are not verified, so anyone who knows the address could sign up with it first. Send the link only to them, and revoke the invitation if it goes to the wrong place. It expires in 14 days.</p>
                </>
              )}
              <div className="flex justify-end gap-2"><Button variant="outline" onClick={() => setDone(null)}>Invite another</Button><DialogClose asChild><Button variant="primary">Done</Button></DialogClose></div>
            </div>
          ) : (
            <form onSubmit={submit} className="grid gap-4">
              <Field label="Email address"><Input type="email" required autoFocus value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@company.com" /></Field>
              <Field label="Role" hint={ROLE_TEXT[role]}>
                <Select value={role} onChange={(e) => setRole(e.target.value as Role)}>{roles.map((r) => <option key={r} value={r}>{r[0]?.toUpperCase() + r.slice(1)}</option>)}</Select>
              </Field>
              <ErrorBanner message={error} />
              <div className="flex justify-end gap-2"><DialogClose asChild><Button type="button" variant="outline">Cancel</Button></DialogClose><Button type="submit" variant="primary" disabled={busy}>{busy ? <Spinner /> : <MailPlus className="size-3.5" />} Invite</Button></div>
            </form>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}

export default function TeamPage() {
  const { project, canEdit, reloadProject } = useProject();
  const router = useRouter();
  const toast = useToast();
  const data = useApi<MembersResponse>(`/v1/projects/${project.id}/members`);
  const [error, setError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<string | null>(null);
  const mine = project.role as Role;
  const base = `/v1/projects/${project.id}/members`;

  async function act(fn: () => Promise<unknown>, done?: string) {
    setError(null);
    try {
      await fn();
      if (done) toast({ tone: 'ok', title: done });
      setConfirm(null);
      data.reload();
    } catch (e) {
      setError(errorMessage(e));
    }
  }
  const setRole = (m: MemberView, role: Role) => act(() => api(`${base}/${m.userId}`, { method: 'PATCH', body: { role } }), 'Role changed');
  const remove = (m: MemberView) => act(() => api(`${base}/${m.userId}`, { method: 'DELETE' }), 'Removed');
  const revoke = (i: InviteView) => act(() => api(`${base}/invites/${i.id}`, { method: 'DELETE' }), 'Invitation revoked');
  async function leave(m: MemberView) {
    setError(null);
    try {
      await api(`${base}/${m.userId}`, { method: 'DELETE' });
      reloadProject();
      router.push('/');
    } catch (e) {
      setError(errorMessage(e));
    }
  }
  const canRemove = (m: MemberView) => !m.isYou && RANK[mine] >= RANK.admin && RANK[m.role] <= RANK[mine] && !(m.role === 'admin' && mine !== 'owner') && !(m.role === 'owner' && mine !== 'owner');

  const members = data.data?.members ?? [];
  const invites = data.data?.invites ?? [];
  return (
    <>
      <PageHeader title="Team" description="Who can see and change this project. Everyone here sees the same data; the role decides what they can change." actions={canEdit && <Invite mine={mine} onDone={data.reload} />} />
      <ErrorBanner message={error ?? data.error} />
      <Card className="overflow-hidden">
        {!data.data ? <Skeleton className="m-5 h-32" /> : members.length === 0 ? (
          <EmptyState icon={<Users className="size-5" />} title="No members" />
        ) : (
          <Table>
            <thead><tr><Th>Person</Th><Th>Role</Th><Th>Joined</Th><Th /></tr></thead>
            <tbody>
              {members.map((m) => (
                <Tr key={m.userId}>
                  <Td>
                    <div className="flex items-center gap-3">
                      <span className="grid size-8 shrink-0 place-items-center rounded-full bg-surface-3 text-xs font-semibold text-ink-2">{(m.name || m.email).slice(0, 1).toUpperCase()}</span>
                      <span className="min-w-0"><span className="block truncate text-[13px] font-medium text-ink">{m.name}{m.isYou && <Badge tone="outline" className="ml-2">You</Badge>}</span><span className="block truncate text-xs text-ink-3">{m.email}</span></span>
                    </div>
                  </Td>
                  <Td>
                    {mine === 'owner' ? (
                      <Select className="h-8 w-28" value={m.role} onChange={(e) => void setRole(m, e.target.value as Role)} aria-label={`Role of ${m.email}`}>
                        <option value="viewer">Viewer</option><option value="admin">Admin</option><option value="owner">Owner</option>
                      </Select>
                    ) : <Badge tone={TONE[m.role]}>{m.role}</Badge>}
                  </Td>
                  <Td className="text-ink-2">{timeAgo(m.joinedAt)}</Td>
                  <Td className="text-right">
                    {m.isYou ? (
                      confirm === m.userId ? (
                        <div className="flex justify-end gap-1"><Button size="sm" variant="danger" onClick={() => void leave(m)}>Leave</Button><Button size="sm" variant="ghost" onClick={() => setConfirm(null)}>Cancel</Button></div>
                      ) : <Button size="sm" variant="ghost" onClick={() => setConfirm(m.userId)}><LogOut className="size-3.5" /> Leave</Button>
                    ) : canRemove(m) ? (
                      confirm === m.userId ? (
                        <div className="flex justify-end gap-1"><Button size="sm" variant="danger" onClick={() => void remove(m)}>Remove</Button><Button size="sm" variant="ghost" onClick={() => setConfirm(null)}>Cancel</Button></div>
                      ) : <Button size="icon" variant="danger-ghost" aria-label={`Remove ${m.email}`} onClick={() => setConfirm(m.userId)}><Trash2 className="size-3.5" /></Button>
                    ) : null}
                  </Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>

      {invites.length > 0 && (
        <Card className="mt-5 overflow-hidden">
          <CardHeader title="Waiting to join" description="Invited, but no account with that address yet. The invitation lets them sign up even when sign-up is closed." />
          <Table>
            <thead><tr><Th>Email</Th><Th>Role</Th><Th>Invited</Th><Th>Expires</Th><Th /></tr></thead>
            <tbody>
              {invites.map((i) => (
                <Tr key={i.id}>
                  <Td className="text-[13px] text-ink">{i.email}</Td>
                  <Td><Badge tone={TONE[i.role]}>{i.role}</Badge></Td>
                  <Td className="text-ink-2">{timeAgo(i.invitedAt)}</Td>
                  <Td className="text-ink-2">{new Date(i.expiresAt).toLocaleDateString()}</Td>
                  <Td className="text-right">{canEdit && <Button size="sm" variant="ghost" onClick={() => void revoke(i)}>Revoke</Button>}</Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        </Card>
      )}

      <Card className="mt-5">
        <CardHeader title="What each role can do" />
        <dl className="grid gap-3 px-5 pb-5 text-[13px] sm:grid-cols-3">
          {(['viewer', 'admin', 'owner'] as const).map((r) => <div key={r} className="rounded-xl border border-line p-3.5"><dt><Badge tone={TONE[r]}>{r}</Badge></dt><dd className="mt-2 text-ink-2">{ROLE_TEXT[r]}</dd></div>)}
        </dl>
      </Card>
    </>
  );
}
