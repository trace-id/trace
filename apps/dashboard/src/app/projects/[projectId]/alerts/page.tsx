'use client';

import { Bell, BellRing, CheckCircle2, FlaskConical, Pencil, Plus, Trash2, Webhook } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { Dialog, DialogClose, DialogContent } from '@/components/ui/overlay';
import { Badge, Button, Card, CardHeader, CopyButton, EmptyState, ErrorBanner, Field, Input, PageHeader, Select, Skeleton, Spinner, Table, Td, Th, Tr } from '@/components/ui/primitives';
import { useToast } from '@/components/ui/toast';
import { api, errorMessage } from '@/lib/api';
import { cn } from '@/lib/cn';
import { num, timeAgo } from '@/lib/format';
import type { AlertEventView, AlertKind, AlertRuleView } from '@/lib/manage-types';
import { useProject } from '@/lib/project-context';
import { useApi } from '@/lib/use-api';

const KINDS: { value: AlertKind; label: string; unit: string; help: string }[] = [
  { value: 'flagged_events', label: 'Flagged events', unit: 'flagged events', help: 'Fires when this many events score 70 or more within the window.' },
  { value: 'flagged_ratio', label: 'Share of events flagged', unit: '% flagged', help: 'Fires when this percentage of events are flagged. Needs a minimum number of events so a quiet hour does not trigger it.' },
  { value: 'event_volume', label: 'Event volume', unit: 'events', help: 'Fires when this many events arrive within the window. Set it above your normal traffic to catch floods.' },
];
const WINDOWS = [5, 15, 30, 60, 180, 360, 1440];
const COOLDOWNS = [5, 30, 60, 180, 720, 1440];
const minutesText = (m: number) => (m >= 60 ? `${m / 60} hour${m === 60 ? '' : 's'}` : `${m} minutes`);

const TEMPLATES: { title: string; body: { name: string; kind: AlertKind; threshold: number; windowMinutes: number; minEvents?: number; cooldownMinutes: number } }[] = [
  { title: 'Burst of flagged events', body: { name: 'Burst of flagged events', kind: 'flagged_events', threshold: 10, windowMinutes: 15, cooldownMinutes: 60 } },
  { title: 'Bot wave', body: { name: 'Bot wave', kind: 'flagged_ratio', threshold: 30, windowMinutes: 60, minEvents: 50, cooldownMinutes: 180 } },
  { title: 'Traffic spike', body: { name: 'Traffic spike', kind: 'event_volume', threshold: 1000, windowMinutes: 5, cooldownMinutes: 60 } },
];

function RuleDialog({ rule, onClose, onDone }: { rule?: AlertRuleView; onClose: () => void; onDone: (secret?: string) => void }) {
  const { project } = useProject();
  const [name, setName] = useState(rule?.name ?? '');
  const [kind, setKind] = useState<AlertKind>(rule?.kind ?? 'flagged_events');
  const [threshold, setThreshold] = useState(String(rule?.threshold ?? 10));
  const [windowMinutes, setWindowMinutes] = useState(String(rule?.windowMinutes ?? 15));
  const [minEvents, setMinEvents] = useState(String(rule?.minEvents ?? 50));
  const [cooldown, setCooldown] = useState(String(rule?.cooldownMinutes ?? 60));
  const [url, setUrl] = useState(rule?.webhookUrl ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const info = KINDS.find((k) => k.value === kind) as (typeof KINDS)[number];

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const body = {
      name: name.trim(),
      kind,
      threshold: Number(threshold),
      windowMinutes: Number(windowMinutes),
      minEvents: kind === 'flagged_ratio' ? Number(minEvents) : 0,
      cooldownMinutes: Number(cooldown),
      webhookUrl: url.trim() || null,
    };
    try {
      const saved = rule
        ? await api<AlertRuleView>(`/v1/projects/${project.id}/alerts/${rule.id}`, { method: 'PATCH', body })
        : await api<AlertRuleView>(`/v1/projects/${project.id}/alerts`, { method: 'POST', body });
      onClose();
      onDone(saved.webhookSecret);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-xl" title={rule ? `Edit ${rule.name}` : 'New alert rule'} description="Checked every minute. After it fires, it stays quiet for the cooldown.">
        <form onSubmit={submit} className="grid gap-4">
          <Field label="Name"><Input required value={name} maxLength={100} onChange={(e) => setName(e.target.value)} placeholder="Burst of flagged events" /></Field>
          <Field label="Fires on" hint={info.help}>
            <Select value={kind} onChange={(e) => setKind(e.target.value as AlertKind)}>{KINDS.map((k) => <option key={k.value} value={k.value}>{k.label}</option>)}</Select>
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={`Threshold (${info.unit})`}><Input required type="number" min={1} max={kind === 'flagged_ratio' ? 100 : 10000000} value={threshold} onChange={(e) => setThreshold(e.target.value)} /></Field>
            <Field label="Within the last"><Select value={windowMinutes} onChange={(e) => setWindowMinutes(e.target.value)}>{WINDOWS.map((w) => <option key={w} value={w}>{minutesText(w)}</option>)}</Select></Field>
            {kind === 'flagged_ratio' && <Field label="At least this many events" hint="Below this the share is ignored."><Input type="number" min={0} value={minEvents} onChange={(e) => setMinEvents(e.target.value)} /></Field>}
            <Field label="Quiet for"><Select value={cooldown} onChange={(e) => setCooldown(e.target.value)}>{COOLDOWNS.map((w) => <option key={w} value={w}>{minutesText(w)}</option>)}</Select></Field>
          </div>
          <Field label="Webhook URL (optional)" hint="Trace sends a signed POST here when the rule fires, like a regular webhook. Alerts always appear in the history below.">
            <Input type="url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://hooks.example.com/trace-alerts" />
          </Field>
          <ErrorBanner message={error} />
          <div className="flex justify-end gap-2"><DialogClose asChild><Button type="button" variant="outline">Cancel</Button></DialogClose><Button type="submit" variant="primary" disabled={busy}>{busy ? <Spinner /> : null} {rule ? 'Save' : 'Create rule'}</Button></div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function RuleCard({ rule, canEdit, onChange, onSecret }: { rule: AlertRuleView; canEdit: boolean; onChange: () => void; onSecret: (s: string) => void }) {
  const { project } = useProject();
  const toast = useToast();
  const [edit, setEdit] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [testing, setTesting] = useState(false);
  const base = `/v1/projects/${project.id}/alerts/${rule.id}`;
  const unit = KINDS.find((k) => k.value === rule.kind)?.unit ?? '';

  async function act(fn: () => Promise<unknown>, done?: string) {
    setError(null);
    try {
      await fn();
      if (done) toast({ tone: 'ok', title: done });
      onChange();
    } catch (e) {
      setError(errorMessage(e));
    }
  }

  return (
    <Card className={cn('p-4', !rule.enabled && 'opacity-75')}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-sm font-semibold tracking-tight text-ink">{rule.name}</h3>
            {!rule.enabled ? <Badge tone="neutral">Off</Badge> : rule.current.wouldFire ? <Badge tone="bad"><BellRing className="mr-1 size-3" /> Over the line now</Badge> : <Badge tone="ok">Quiet</Badge>}
            {rule.webhookUrl && <Badge tone="info"><Webhook className="mr-1 size-3" /> Webhook</Badge>}
          </div>
          <p className="mt-1 text-[13px] text-ink-2">{rule.description}. Quiet for {minutesText(rule.cooldownMinutes)} after it fires.</p>
          <p className="mt-1 text-xs text-ink-3">Right now: <b className="tnum text-ink-2">{num(rule.current.observed)}</b> {unit} of {num(rule.threshold)} · {num(rule.current.events)} events, {num(rule.current.flagged)} flagged in the window{rule.lastFiredAt && <> · last fired {timeAgo(rule.lastFiredAt)}</>}</p>
        </div>
        {canEdit && (
          <div className="flex items-center gap-1">
            <Button size="sm" variant="ghost" disabled={testing} onClick={() => { setTesting(true); void act(() => api(`${base}/test`, { method: 'POST' }), 'Test alert sent').finally(() => setTesting(false)); }}>{testing ? <Spinner /> : <FlaskConical className="size-3.5" />} Test</Button>
            <Button size="sm" variant="ghost" onClick={() => void act(() => api(base, { method: 'PATCH', body: { enabled: !rule.enabled } }))}>{rule.enabled ? 'Turn off' : 'Turn on'}</Button>
            <Button size="sm" variant="ghost" onClick={() => setEdit(true)}><Pencil className="size-3.5" /> Edit</Button>
            {confirm ? (
              <><Button size="sm" variant="danger" onClick={() => void act(() => api(base, { method: 'DELETE' }), 'Rule deleted')}>Delete</Button><Button size="sm" variant="ghost" onClick={() => setConfirm(false)}>Cancel</Button></>
            ) : <Button size="icon" variant="danger-ghost" aria-label="Delete rule" onClick={() => setConfirm(true)}><Trash2 className="size-3.5" /></Button>}
          </div>
        )}
      </div>
      {error && <div className="mt-3"><ErrorBanner message={error} /></div>}
      {edit && <RuleDialog rule={rule} onClose={() => setEdit(false)} onDone={(s) => { onChange(); if (s) onSecret(s); }} />}
    </Card>
  );
}

export default function AlertsPage() {
  const { project, canEdit } = useProject();
  const rules = useApi<{ rules: AlertRuleView[]; limit: number }>(`/v1/projects/${project.id}/alerts`, { intervalMs: 30_000 });
  const history = useApi<{ alerts: AlertEventView[] }>(`/v1/projects/${project.id}/alerts/history`, { intervalMs: 30_000 });
  const [creating, setCreating] = useState(false);
  const [secret, setSecret] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const toast = useToast();
  const reload = () => { rules.reload(); history.reload(); };
  const list = rules.data?.rules ?? [];
  const alerts = history.data?.alerts ?? [];

  async function template(t: (typeof TEMPLATES)[number]) {
    setError(null);
    try {
      await api(`/v1/projects/${project.id}/alerts`, { method: 'POST', body: t.body });
      toast({ tone: 'ok', title: 'Rule added', description: t.title });
      reload();
    } catch (e) {
      setError(errorMessage(e));
    }
  }

  return (
    <>
      <PageHeader title="Alerts" description="Get told when flagged traffic or volume crosses a line. Alerts are kept here and can also be sent to a webhook." actions={canEdit && <Button variant="primary" onClick={() => setCreating(true)}><Plus className="size-3.5" /> New rule</Button>} />
      <ErrorBanner message={error ?? rules.error} />
      {secret && (
        <Card className="mb-4 border-signal/40 bg-signal-soft p-5">
          <p className="text-[13px] font-semibold text-signal-ink">Webhook signing secret</p>
          <p className="mt-0.5 text-[13px] text-signal-ink/80">Use it to check the X-Signature header on each alert, as for regular webhooks. It is shown only once.</p>
          <div className="mt-3 flex items-center gap-2 rounded-xl border border-signal/30 bg-surface px-3 py-2"><code className="min-w-0 flex-1 break-all font-mono text-xs">{secret}</code><CopyButton value={secret} /></div>
          <Button size="sm" variant="outline" className="mt-3" onClick={() => setSecret(null)}>I have saved it</Button>
        </Card>
      )}

      <div className="grid gap-3">
        {!rules.data ? <Skeleton className="h-28" /> : list.length === 0 ? (
          <Card>
            <EmptyState icon={<Bell className="size-5" />} title="No alert rules yet" description="A rule watches your events and fires when they cross a line. Start from one of these, or write your own." action={canEdit && <div className="flex flex-wrap justify-center gap-2">{TEMPLATES.map((t) => <Button key={t.title} variant="outline" onClick={() => void template(t)}><Plus className="size-3.5" /> {t.title}</Button>)}</div>} />
          </Card>
        ) : list.map((r) => <RuleCard key={r.id} rule={r} canEdit={canEdit} onChange={reload} onSecret={setSecret} />)}
      </div>

      <Card className="mt-6 overflow-hidden">
        <CardHeader title="What has fired" description="The last 100 alerts, kept for 90 days." />
        {!history.data ? <Skeleton className="m-5 h-24" /> : alerts.length === 0 ? (
          <p className="px-5 pb-6 text-[13px] text-ink-3">Nothing has fired yet.</p>
        ) : (
          <Table>
            <thead><tr><Th>When</Th><Th>Rule</Th><Th>Measured</Th><Th>Webhook</Th></tr></thead>
            <tbody>
              {alerts.map((a) => (
                <Tr key={a.id}>
                  <Td className="whitespace-nowrap text-ink-2">{timeAgo(a.firedAt)}</Td>
                  <Td><span className="text-[13px] font-medium text-ink">{a.ruleName}</span>{a.test && <Badge tone="outline" className="ml-2">Test</Badge>}</Td>
                  <Td className="tnum text-ink-2">{num(a.observed)} of {num(a.threshold)} in {minutesText(a.windowMinutes)}</Td>
                  <Td>{a.delivery === 'none' ? <span className="text-ink-3">-</span> : a.delivery === 'delivered' ? <Badge tone="ok"><CheckCircle2 className="mr-1 size-3" /> Delivered</Badge> : <Badge tone="bad" title={a.deliveryError ?? undefined}>Failed{a.deliveryError ? `: ${a.deliveryError}` : ''}</Badge>}</Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
      {creating && <RuleDialog onClose={() => setCreating(false)} onDone={(s) => { reload(); if (s) setSecret(s); }} />}
    </>
  );
}
