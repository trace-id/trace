'use client';

import type { WebhookEndpointResponse } from '@trace-id/signals/api';
import { Plus, ScrollText, Trash2, Webhook } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { Badge, Button, Card, CardHeader, CopyButton, EmptyState, ErrorBanner, Field, Input, PageHeader, Skeleton, Table, Td, Th, Tr } from '@/components/ui/primitives';
import { Dialog, DialogClose, DialogContent, DialogTrigger, Sheet } from '@/components/ui/overlay';
import { api, errorMessage } from '@/lib/api';
import { formatDateTime, timeAgo } from '@/lib/format';
import { useProject } from '@/lib/project-context';
import { useApi } from '@/lib/use-api';

interface Delivery {
  id: string; eventId: string; type: string; status: string; attempts: number; lastStatus: number | null;
  lastError: string | null; createdAt: string; deliveredAt: string | null; nextAttemptAt: string;
}

const TYPES = [
  { id: 'event.created', label: 'Every event', hint: 'Fires for each identify call' },
  { id: 'visitor.flagged', label: 'Flagged visitors', hint: 'Fires when the score reaches your threshold' },
] as const;

function Deliveries({ endpoint, onClose }: { endpoint: WebhookEndpointResponse; onClose: () => void }) {
  const { project } = useProject();
  const d = useApi<{ deliveries: Delivery[] }>(`/v1/projects/${project.id}/webhooks/${endpoint.id}/deliveries`);
  return (
    <Sheet open onOpenChange={(o) => !o && onClose()} title="Delivery log" width="max-w-2xl">
      <div className="p-6">
        <h2 className="text-lg font-semibold tracking-tight">Delivery log</h2>
        <p className="mt-1 break-all font-mono text-xs text-ink-3">{endpoint.url}</p>
        <ErrorBanner message={d.error} />
        <div className="mt-5 grid gap-2">
          {!d.data ? <Skeleton className="h-32" /> : d.data.deliveries.length === 0 ? (
            <p className="py-10 text-center text-[13px] text-ink-3">Nothing has been sent to this endpoint yet.</p>
          ) : d.data.deliveries.map((x) => (
            <Card key={x.id} className="p-3.5">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <Badge tone={x.status === 'delivered' ? 'ok' : x.status === 'pending' ? 'warn' : 'bad'}>{x.status}</Badge>
                  <span className="font-mono text-xs text-ink-2">{x.type}</span>
                </div>
                <span className="text-xs text-ink-3">{timeAgo(x.createdAt)}</span>
              </div>
              <p className="mt-2 text-xs text-ink-3">
                Event <span className="font-mono">{x.eventId.slice(0, 13)}…</span> · {x.attempts} attempt{x.attempts === 1 ? '' : 's'}
                {x.lastStatus !== null && <> · HTTP {x.lastStatus}</>}
                {x.deliveredAt && <> · delivered {formatDateTime(x.deliveredAt)}</>}
              </p>
              {x.lastError && <p className="mt-1.5 rounded-lg bg-bad-soft px-2.5 py-1.5 text-xs text-bad">{x.lastError}</p>}
            </Card>
          ))}
        </div>
      </div>
    </Sheet>
  );
}

function Create({ onCreated }: { onCreated: (e: WebhookEndpointResponse) => void }) {
  const { project } = useProject();
  const [open, setOpen] = useState(false);
  const [url, setUrl] = useState('');
  const [events, setEvents] = useState<string[]>(['visitor.flagged']);
  const [threshold, setThreshold] = useState(70);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      const w = await api<WebhookEndpointResponse>(`/v1/projects/${project.id}/webhooks`, { method: 'POST', body: { url, events, flagThreshold: threshold } });
      setUrl('');
      setOpen(false);
      onCreated(w);
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild><Button variant="primary"><Plus className="size-3.5" /> Add endpoint</Button></DialogTrigger>
      <DialogContent title="Add a webhook endpoint" description="Trace sends a signed POST to this URL. Deliveries are retried and may arrive more than once, so de-duplicate on the payload id.">
        <form onSubmit={submit} className="grid gap-4">
          <Field label="Endpoint URL"><Input type="url" required value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://api.example.com/hooks/trace" /></Field>
          <fieldset className="grid gap-2">
            <legend className="mb-1 text-xs font-medium text-ink-2">Send</legend>
            {TYPES.map((t) => (
              <label key={t.id} className="flex cursor-pointer items-start gap-3 rounded-xl border border-line p-3 hover:bg-surface-2">
                <input type="checkbox" className="mt-0.5 size-4 accent-[var(--signal)]" checked={events.includes(t.id)} onChange={(e) => setEvents((cur) => (e.target.checked ? [...cur, t.id] : cur.filter((x) => x !== t.id)))} />
                <span><span className="block text-[13px] font-medium text-ink">{t.label}</span><span className="text-xs text-ink-3">{t.hint}</span></span>
              </label>
            ))}
          </fieldset>
          {events.includes('visitor.flagged') && (
            <Field label={`Flag threshold: ${threshold}`} hint="Visitors scoring at or above this are flagged.">
              <input type="range" min={1} max={100} value={threshold} onChange={(e) => setThreshold(Number(e.target.value))} className="accent-[var(--signal)]" />
            </Field>
          )}
          <ErrorBanner message={error} />
          <div className="flex justify-end gap-2">
            <DialogClose asChild><Button type="button" variant="outline">Cancel</Button></DialogClose>
            <Button type="submit" variant="primary" disabled={events.length === 0}>Add endpoint</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export default function WebhooksPage() {
  const { project, canEdit } = useProject();
  const hooks = useApi<{ endpoints: WebhookEndpointResponse[] }>(`/v1/projects/${project.id}/webhooks`);
  const [created, setCreated] = useState<WebhookEndpointResponse | null>(null);
  const [log, setLog] = useState<WebhookEndpointResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<string | null>(null);

  async function remove(id: string) {
    try {
      await api(`/v1/projects/${project.id}/webhooks/${id}`, { method: 'DELETE' });
      setConfirm(null);
      hooks.reload();
    } catch (e) {
      setError(errorMessage(e));
    }
  }

  const list = hooks.data?.endpoints ?? [];
  return (
    <>
      <PageHeader title="Webhooks" description="Get notified when events happen or a visitor is flagged. Each request is signed with the endpoint secret." actions={canEdit && <Create onCreated={(w) => { setCreated(w); hooks.reload(); }} />} />
      <ErrorBanner message={error ?? hooks.error} />
      {created?.secret && (
        <Card className="mb-4 border-signal/40 bg-signal-soft p-5">
          <p className="text-[13px] font-semibold text-signal-ink">Signing secret</p>
          <p className="mt-0.5 text-[13px] text-signal-ink/80">Use it to verify the signature on each delivery. It is shown only once.</p>
          <div className="mt-3 flex items-center gap-2 rounded-xl border border-signal/30 bg-surface px-3 py-2"><code className="min-w-0 flex-1 break-all font-mono text-xs">{created.secret}</code><CopyButton value={created.secret} /></div>
          <Button size="sm" variant="outline" className="mt-3" onClick={() => setCreated(null)}>I have saved it</Button>
        </Card>
      )}
      <Card className="overflow-hidden">
        {!hooks.data ? <Skeleton className="m-5 h-32" /> : list.length === 0 ? (
          <EmptyState icon={<Webhook className="size-5" />} title="No endpoints" description="Add an endpoint to receive events as they happen." />
        ) : (
          <Table>
            <thead><tr><Th>Endpoint</Th><Th>Sends</Th><Th>Threshold</Th><Th>Created</Th><Th /></tr></thead>
            <tbody>
              {list.map((w) => (
                <Tr key={w.id}>
                  <Td><span className="break-all font-mono text-xs">{w.url}</span></Td>
                  <Td><div className="flex flex-wrap gap-1">{w.events.map((t) => <Badge key={t} tone="info">{t}</Badge>)}</div></Td>
                  <Td className="tnum">{w.events.includes('visitor.flagged') ? w.flagThreshold : '-'}</Td>
                  <Td className="text-ink-2">{timeAgo(w.createdAt)}</Td>
                  <Td className="text-right">
                    <div className="flex justify-end gap-1">
                      <Button size="sm" variant="ghost" onClick={() => setLog(w)}><ScrollText className="size-3.5" /> Log</Button>
                      {canEdit && (confirm === w.id ? (
                        <><Button size="sm" variant="danger" onClick={() => remove(w.id)}>Delete</Button><Button size="sm" variant="ghost" onClick={() => setConfirm(null)}>Cancel</Button></>
                      ) : (
                        <Button size="icon" variant="danger-ghost" aria-label="Delete endpoint" onClick={() => setConfirm(w.id)}><Trash2 className="size-3.5" /></Button>
                      ))}
                    </div>
                  </Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
      <Card className="mt-5">
        <CardHeader title="Verify each delivery" description="Requests carry an X-Signature header: an HMAC-SHA256 of the timestamp and raw body, made with your endpoint secret. Always check it before trusting a payload." />
        <pre className="mx-5 mb-5 overflow-x-auto rounded-xl bg-[#0d1014] p-4 font-mono text-[12px] leading-5 text-[#d7dbe0]">{`import { verifyWebhook } from '@trace-id/sdk-node/webhooks';

const result = verifyWebhook({
  body: rawBody,                       // the exact bytes received
  signature: req.headers['x-signature'],
  secret: process.env.TRACE_WEBHOOK_SECRET,
});
// Deliveries are at-least-once: de-duplicate on X-Webhook-Id.`}</pre>
      </Card>
      {log && <Deliveries endpoint={log} onClose={() => setLog(null)} />}
    </>
  );
}
