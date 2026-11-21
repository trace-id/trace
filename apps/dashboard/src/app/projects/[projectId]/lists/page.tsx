'use client';

import { Ban, ListChecks, Plus, ShieldCheck, Trash2 } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { KIND_LABEL } from '@/components/lists/quick-list';
import { Dialog, DialogClose, DialogContent } from '@/components/ui/overlay';
import { Badge, Button, Card, CardHeader, EmptyState, ErrorBanner, Field, Input, PageHeader, Segmented, Select, Skeleton, Spinner, Table, Td, Th, Tr } from '@/components/ui/primitives';
import { useToast } from '@/components/ui/toast';
import { api, errorMessage } from '@/lib/api';
import { compact, timeAgo } from '@/lib/format';
import type { ListEntryView, ListKind } from '@/lib/manage-types';
import { useProject } from '@/lib/project-context';
import { useApi } from '@/lib/use-api';

const EXAMPLE: Record<ListKind, string> = {
  ip: '203.0.113.7',
  cidr: '203.0.113.0/24',
  visitor: 'a visitor id, from a visitor page',
  device: 'a device id, from an event page',
  linked: 'your own user id, as sent in linkedId',
};
const KIND_HELP: Record<ListKind, string> = {
  ip: 'One address. IPv4 or IPv6.',
  cidr: 'A whole range, written like 203.0.113.0/24.',
  visitor: 'One browser, by its visitor id.',
  device: 'One device across browsers, by its device id.',
  linked: 'One of your own users, by the linkedId your page sends.',
};

function Add({ onDone }: { onDone: () => void }) {
  const { project } = useProject();
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<ListKind>('ip');
  const [value, setValue] = useState('');
  const [action, setAction] = useState<'allow' | 'block'>('block');
  const [note, setNote] = useState('');
  const [days, setDays] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const toast = useToast();

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api(`/v1/projects/${project.id}/lists`, { method: 'POST', body: { kind, value: value.trim(), action, ...(note.trim() ? { note: note.trim() } : {}), ...(days ? { expiresInDays: Number(days) } : {}) } });
      toast({ tone: 'ok', title: action === 'block' ? 'Blocked' : 'Allowed', description: value.trim() });
      setValue('');
      setNote('');
      setOpen(false);
      onDone();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Button variant="primary" onClick={() => setOpen(true)}><Plus className="size-3.5" /> Add entry</Button>
      <DialogContent title="Add to a list" description="Events that match are scored by the list instead of by their signals. The signal score is kept on the event.">
        <form onSubmit={submit} className="grid gap-4">
          <Field label="What happens"><Segmented value={action} onChange={setAction} options={[{ value: 'block', label: 'Always block (100)' }, { value: 'allow', label: 'Always allow (0)' }]} /></Field>
          <Field label="Type" hint={KIND_HELP[kind]}>
            <Select value={kind} onChange={(e) => setKind(e.target.value as ListKind)}>{(Object.keys(KIND_LABEL) as ListKind[]).map((k) => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}</Select>
          </Field>
          <Field label="Value"><Input required value={value} onChange={(e) => setValue(e.target.value)} placeholder={EXAMPLE[kind]} spellCheck={false} autoComplete="off" /></Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Note (optional)"><Input value={note} maxLength={200} onChange={(e) => setNote(e.target.value)} placeholder="Why it is here" /></Field>
            <Field label="Keep for">
              <Select value={days} onChange={(e) => setDays(e.target.value)}><option value="">Until removed</option><option value="1">1 day</option><option value="7">7 days</option><option value="30">30 days</option><option value="90">90 days</option></Select>
            </Field>
          </div>
          <ErrorBanner message={error} />
          <div className="flex justify-end gap-2"><DialogClose asChild><Button type="button" variant="outline">Cancel</Button></DialogClose><Button type="submit" variant="primary" disabled={busy}>{busy ? <Spinner /> : null} Add</Button></div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export default function ListsPage() {
  const { project, canEdit } = useProject();
  const [filter, setFilter] = useState<'all' | 'block' | 'allow'>('all');
  const data = useApi<{ entries: ListEntryView[]; limit: number }>(`/v1/projects/${project.id}/lists`, { intervalMs: 30_000 });
  const [error, setError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<string | null>(null);
  const toast = useToast();
  const all = data.data?.entries ?? [];
  const rows = all.filter((e) => filter === 'all' || e.action === filter);
  const blocks = all.filter((e) => e.action === 'block').length;

  async function remove(id: string) {
    setError(null);
    try {
      await api(`/v1/projects/${project.id}/lists/${id}`, { method: 'DELETE' });
      toast({ tone: 'ok', title: 'Removed from the list' });
      setConfirm(null);
      data.reload();
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  return (
    <>
      <PageHeader title="Allow and block lists" description="Treat an address, range, visitor, device or user as always bad or always fine, whatever their signals say." actions={canEdit && <Add onDone={data.reload} />} />
      <ErrorBanner message={error ?? data.error} />
      <Card className="overflow-hidden">
        <CardHeader title={`${all.length} entr${all.length === 1 ? 'y' : 'ies'}`} description={`${blocks} blocked, ${all.length - blocks} allowed. Changes apply to new events within seconds.`} action={<Segmented value={filter} onChange={setFilter} options={[{ value: 'all', label: 'All' }, { value: 'block', label: 'Blocked' }, { value: 'allow', label: 'Allowed' }]} />} />
        {!data.data ? <Skeleton className="m-5 h-32" /> : rows.length === 0 ? (
          <EmptyState icon={<ListChecks className="size-5" />} title={all.length === 0 ? 'Nothing listed yet' : 'Nothing in this view'} description={all.length === 0 ? 'Add an entry here, or use the Block and Allow buttons on an event or visitor page.' : undefined} />
        ) : (
          <Table>
            <thead><tr><Th>Value</Th><Th>Type</Th><Th>What happens</Th><Th>Matched</Th><Th>Added</Th><Th>Expires</Th><Th /></tr></thead>
            <tbody>
              {rows.map((e) => (
                <Tr key={e.id}>
                  <Td><span className="block break-all font-mono text-xs text-ink">{e.value}</span>{e.note && <span className="block text-xs text-ink-3">{e.note}</span>}</Td>
                  <Td className="text-ink-2">{KIND_LABEL[e.kind]}</Td>
                  <Td>{e.action === 'block' ? <Badge tone="bad"><Ban className="mr-1 size-3" /> Block</Badge> : <Badge tone="ok"><ShieldCheck className="mr-1 size-3" /> Allow</Badge>}</Td>
                  <Td className="text-ink-2">{e.hits > 0 ? <><span className="tnum font-medium text-ink">{compact(e.hits)}</span>{e.lastHitAt && <span className="block text-xs text-ink-3">{timeAgo(e.lastHitAt)}</span>}</> : '-'}</Td>
                  <Td className="text-ink-2">{timeAgo(e.createdAt)}</Td>
                  <Td className="text-ink-2">{e.expiresAt ? new Date(e.expiresAt).toLocaleDateString() : 'Never'}</Td>
                  <Td className="text-right">
                    {canEdit && (confirm === e.id ? (
                      <div className="flex justify-end gap-1"><Button size="sm" variant="danger" onClick={() => void remove(e.id)}>Remove</Button><Button size="sm" variant="ghost" onClick={() => setConfirm(null)}>Cancel</Button></div>
                    ) : <Button size="icon" variant="danger-ghost" aria-label="Remove entry" onClick={() => setConfirm(e.id)}><Trash2 className="size-3.5" /></Button>)}
                  </Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
      <Card className="mt-5">
        <CardHeader title="How lists work" />
        <ul className="grid gap-2 px-5 pb-5 text-[13px] leading-relaxed text-ink-2">
          <li>An event that matches a <b className="text-ink">block</b> entry scores 100, so it is flagged and any webhook for flagged visitors fires. A match on an <b className="text-ink">allow</b> entry scores 0.</li>
          <li>If an event matches both, <b className="text-ink">allow wins</b>. That lets you trust one address inside a range you blocked.</li>
          <li>The event still records the signals and the score they gave, and says which entry decided. Nothing is hidden from the event log.</li>
          <li>Lists change scores, not what your server does with them: you still decide in your own code whether to block, challenge or just watch.</li>
          <li>Up to {data.data?.limit ?? 1000} entries per project. The embedded mode (<span className="font-mono text-xs">@trace-id/embed</span>) has no lists.</li>
        </ul>
      </Card>
    </>
  );
}
