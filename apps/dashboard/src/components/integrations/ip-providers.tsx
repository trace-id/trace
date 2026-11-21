'use client';

import { Activity, AlertTriangle, ChevronDown, ExternalLink, FlaskConical, KeyRound, Layers, Pencil, Plus, ShieldCheck, Trash2, Zap } from 'lucide-react';
import { useMemo, useState, type FormEvent, type ReactNode } from 'react';
import { AreaChart, BarList, type Series } from '@/components/charts/charts';
import { Dialog, DialogClose, DialogContent } from '@/components/ui/overlay';
import { Badge, Button, Card, CardHeader, EmptyState, ErrorBanner, Field, Input, Segmented, Select, Skeleton, Spinner, Table, Td, Th, Tr } from '@/components/ui/primitives';
import { ProviderMark, ProviderPicker } from '@/components/integrations/provider-picker';
import { useToast } from '@/components/ui/toast';
import { api, errorMessage } from '@/lib/api';
import { cn } from '@/lib/cn';
import { compact, num, timeAgo } from '@/lib/format';
import type { Capability, FieldSpec, IpOverview, KeyView, ProviderInfo, ProviderStatus, ProviderView, SettingView, TestResult, UsageResponse, UsageTotals } from '@/lib/ip-intel-types';
import { useApi } from '@/lib/use-api';

const CAPABILITY: Record<Capability, string> = {
  country: 'Country', asn: 'ASN', location: 'Location', vpn: 'VPN', proxy: 'Proxy', tor: 'Tor', datacenter: 'Datacenter', blocklisted: 'Abuse list', relay: 'Relay',
};
const STATUS: Record<ProviderStatus, { tone: 'ok' | 'warn' | 'bad' | 'neutral'; label: string }> = {
  ok: { tone: 'ok', label: 'Working' },
  degraded: { tone: 'warn', label: 'Degraded' },
  down: { tone: 'bad', label: 'Not working' },
  disabled: { tone: 'neutral', label: 'Off' },
};
const COLORS = ['var(--signal)', '#d97706', '#7c3aed', '#0891b2', '#dc2626', '#65a30d', '#db2777', '#4b5563'];

const infoFor = (registry: ProviderInfo[], id: string): ProviderInfo | undefined => registry.find((r) => r.id === id);

/* ---------- form pieces ---------- */

function FieldInput({ spec, value, onChange, optionalHint }: { spec: FieldSpec; value: string; onChange: (v: string) => void; optionalHint?: string }) {
  const label = spec.required ? spec.label : `${spec.label}${spec.label.toLowerCase().includes('optional') ? '' : ' (optional)'}`;
  if (spec.kind === 'boolean') {
    return (
      <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-line p-3 hover:bg-surface-2">
        <input type="checkbox" className="mt-0.5 size-4 accent-[var(--signal)]" checked={value === 'true'} onChange={(e) => onChange(String(e.target.checked))} />
        <span>
          <span className="block text-[13px] font-medium text-ink">{spec.label}</span>
          {spec.help && <span className="text-xs text-ink-3">{spec.help}</span>}
        </span>
      </label>
    );
  }
  return (
    <Field label={label} hint={optionalHint ?? spec.help}>
      {spec.kind === 'select' ? (
        <Select value={value} onChange={(e) => onChange(e.target.value)}>
          {!spec.required && !spec.suggested && <option value="">Default</option>}
          {spec.options?.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </Select>
      ) : (
        <Input
          type={spec.secret ? 'password' : spec.kind === 'number' ? 'number' : 'text'}
          autoComplete="off"
          spellCheck={false}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={spec.secret ? 'Paste the key' : spec.suggested}
        />
      )}
    </Field>
  );
}

const initialValues = (fields: FieldSpec[]): Record<string, string> => Object.fromEntries(fields.filter((f) => f.suggested !== undefined).map((f) => [f.name, f.suggested as string]));

function numberOrNull(v: string): number | null {
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/* ---------- testing ---------- */

function useTester() {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<TestResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  async function run(body: unknown) {
    setBusy(true);
    setResult(null);
    setError(null);
    try {
      setResult(await api<TestResult>('/v1/ip-intel/test', { method: 'POST', body }));
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  return { busy, result, error, run, clear: () => { setResult(null); setError(null); } };
}

function Flag3({ name, value }: { name: string; value: unknown }) {
  if (typeof value !== 'boolean') return <Badge tone="neutral">{name}: not reported</Badge>;
  return <Badge tone={value ? 'warn' : 'ok'}>{name}: {value ? 'yes' : 'no'}</Badge>;
}

function TestOutcome({ result, error }: { result: TestResult | null; error: string | null }) {
  if (error) return <ErrorBanner message={error} />;
  if (!result) return null;
  if (!result.ok) return <ErrorBanner message={`${result.error ?? 'The provider did not answer'}${result.status ? ` (HTTP ${result.status})` : ''}`} />;
  const f = result.facts ?? {};
  const loc = f.location as { city?: string | null } | undefined;
  return (
    <div className="rounded-xl border border-ok/30 bg-ok-soft p-3.5 text-[13px]" role="status">
      <p className="font-medium text-ok">The provider answered in {result.latencyMs} ms</p>
      <div className="mt-2 flex flex-wrap gap-1.5">
        <Badge tone="info">Country: {(f.country as string) ?? 'not reported'}</Badge>
        <Badge tone="info">ASN: {f.asn ? `AS${String(f.asn)}${f.asnOrg ? ` ${String(f.asnOrg)}` : ''}` : 'not reported'}</Badge>
        {loc?.city && <Badge tone="info">{loc.city}</Badge>}
        {(['vpn', 'proxy', 'tor', 'datacenter', 'blocklisted'] as const).map((k) => <Flag3 key={k} name={k} value={f[k]} />)}
      </div>
      <p className="mt-2 text-xs text-ink-3">&ldquo;Not reported&rdquo; means this plan does not return that field, which is different from a no.</p>
    </div>
  );
}

function TestDialog({ title, body, onClose }: { title: string; body: (ip: string) => unknown; onClose: () => void }) {
  const [ip, setIp] = useState('8.8.8.8');
  const t = useTester();
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent title={title} description="Sends one real lookup to the provider with this key. It counts against the key's quota.">
        <div className="grid gap-4">
          <Field label="IP address" hint="A public address. Private and reserved ranges are never sent."><Input value={ip} onChange={(e) => setIp(e.target.value)} spellCheck={false} /></Field>
          <TestOutcome result={t.result} error={t.error} />
          <div className="flex justify-end gap-2">
            <DialogClose asChild><Button variant="outline">Close</Button></DialogClose>
            <Button variant="primary" disabled={t.busy || !ip.trim()} onClick={() => void t.run(body(ip.trim()))}>{t.busy ? <Spinner /> : <FlaskConical className="size-3.5" />} Run test</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/* ---------- add provider ---------- */

function AddProvider({ registry, added, open, onOpenChange, onDone }: { registry: ProviderInfo[]; added: string[]; open: boolean; onOpenChange: (o: boolean) => void; onDone: () => void }) {
  const [picked, setPicked] = useState<ProviderInfo | null>(null);
  const [values, setValues] = useState<Record<string, string>>({});
  const [label, setLabel] = useState('');
  const [share, setShare] = useState('100');
  const [priority, setPriority] = useState('100');
  const [dailyLimit, setDailyLimit] = useState('');
  const [strategy, setStrategy] = useState<'weighted' | 'failover'>('weighted');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const tester = useTester();
  const toast = useToast();

  const reset = () => { setPicked(null); setValues({}); setLabel(''); setShare('100'); setPriority('100'); setDailyLimit(''); setError(null); tester.clear(); };
  const choose = (p: ProviderInfo) => { setPicked(p); setValues(initialValues(p.fields)); setLabel(p.label); };

  const split = (p: ProviderInfo) => {
    const settings: Record<string, string> = {};
    const key: Record<string, string> = {};
    for (const f of p.fields) {
      const v = values[f.name]?.trim();
      if (v) (f.scope === 'key' ? key : settings)[f.name] = v;
    }
    return { settings, key };
  };

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!picked) return;
    setError(null);
    setBusy(true);
    const { settings, key } = split(picked);
    try {
      await api('/v1/ip-intel/providers', {
        method: 'POST',
        body: {
          provider: picked.id,
          label: label.trim() || picked.label,
          settings,
          sharePercent: Number(share),
          priority: Number(priority),
          dailyLimit: numberOrNull(dailyLimit),
          strategy,
          ...(Object.keys(key).length > 0 ? { key: { label: 'Key 1', values: key } } : {}),
        },
      });
      toast({ tone: 'ok', title: `${picked.label} added` });
      reset();
      onOpenChange(false);
      onDone();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  const keyFields = picked?.fields.filter((f) => f.scope === 'key') ?? [];
  const settingFields = picked?.fields.filter((f) => f.scope === 'provider') ?? [];

  return (
    <Dialog open={open} onOpenChange={(o) => { onOpenChange(o); if (!o) reset(); }}>
      <DialogContent
        className="max-w-3xl"
        title={picked ? `Add ${picked.label}` : 'Add an IP data provider'}
        description={picked ? picked.summary : 'Each provider you add is asked about visitor IPs, so name it on your privacy page. Answers are cached, so repeat visitors cost nothing.'}
      >
        {!picked ? (
          <ProviderPicker registry={registry} added={added} onPick={choose} />
        ) : (
          <form onSubmit={submit} className="grid gap-4">
            <p className="text-xs text-ink-3">
              Plans and limits change, so check them on the provider&rsquo;s site.{' '}
              <a href={picked.website} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-0.5 text-signal-ink underline">Open {picked.label} <ExternalLink className="size-3" /></a>
            </p>
            {picked.freeNote && <p className="rounded-lg bg-surface-2 px-3 py-2 text-xs text-ink-2">{picked.freeNote}</p>}
            <Field label="Name"><Input value={label} onChange={(e) => setLabel(e.target.value)} maxLength={100} /></Field>
            {keyFields.map((f) => <FieldInput key={f.name} spec={f} value={values[f.name] ?? ''} onChange={(v) => setValues((c) => ({ ...c, [f.name]: v }))} />)}
            {settingFields.map((f) => <FieldInput key={f.name} spec={f} value={values[f.name] ?? ''} onChange={(v) => setValues((c) => ({ ...c, [f.name]: v }))} />)}
            <details className="rounded-xl border border-line p-3 text-[13px]">
              <summary className="cursor-pointer font-medium text-ink-2">Traffic and limits</summary>
              <div className="mt-3 grid gap-4 sm:grid-cols-2">
                <Field label={`Share of addresses: ${share}%`} hint="Send only a fixed share of addresses to this provider, to spread a small quota. The same address always goes the same way.">
                  <input type="range" min={0} max={100} step={5} value={share} onChange={(e) => setShare(e.target.value)} className="accent-[var(--signal)]" />
                </Field>
                <Field label="Priority" hint="Lower runs first. For country, ASN and location the first provider that answers wins."><Input type="number" min={0} max={10000} value={priority} onChange={(e) => setPriority(e.target.value)} /></Field>
                <Field label="Daily limit (optional)" hint="Stop calling this provider after this many calls a day."><Input type="number" min={1} value={dailyLimit} onChange={(e) => setDailyLimit(e.target.value)} placeholder="No limit" /></Field>
                <Field label="Several keys" hint={strategy === 'weighted' ? 'Spread calls over keys by weight.' : 'Use the first key until it is out of quota or failing.'}>
                  <Segmented value={strategy} onChange={setStrategy} options={[{ value: 'weighted', label: 'Spread' }, { value: 'failover', label: 'Failover' }]} />
                </Field>
              </div>
            </details>
            <TestOutcome result={tester.result} error={tester.error} />
            <ErrorBanner message={error} />
            <div className="flex flex-wrap justify-between gap-2">
              <Button type="button" variant="ghost" onClick={reset}>Back</Button>
              <div className="flex gap-2">
                {picked.remote && (
                  <Button type="button" variant="outline" disabled={tester.busy} onClick={() => { const { settings, key } = split(picked); void tester.run({ provider: picked.id, ip: '8.8.8.8', settings, values: key }); }}>
                    {tester.busy ? <Spinner /> : <FlaskConical className="size-3.5" />} Test first
                  </Button>
                )}
                <Button type="submit" variant="primary" disabled={busy}>{busy ? <Spinner /> : <Plus className="size-3.5" />} Add provider</Button>
              </div>
            </div>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

/* ---------- add / edit key ---------- */

function KeyDialog({ provider, info, existing, onClose, onDone }: { provider: ProviderView; info: ProviderInfo; existing?: KeyView; onClose: () => void; onDone: () => void }) {
  const fields = info.fields.filter((f) => f.scope === 'key');
  const [values, setValues] = useState<Record<string, string>>({});
  const [label, setLabel] = useState(existing?.label ?? `Key ${provider.keys.length + 1}`);
  const [weight, setWeight] = useState(String(existing?.weight ?? 1));
  const [limit, setLimit] = useState(existing?.dailyLimit ? String(existing.dailyLimit) : '');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const tester = useTester();
  const toast = useToast();

  const keyValues = () => Object.fromEntries(Object.entries(values).filter(([, v]) => v.trim()));

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const body = { label: label.trim(), weight: Number(weight) || 1, dailyLimit: numberOrNull(limit), ...(Object.keys(keyValues()).length > 0 ? { values: keyValues() } : {}) };
    try {
      if (existing) await api(`/v1/ip-intel/providers/${provider.id}/keys/${existing.id}`, { method: 'PATCH', body });
      else await api(`/v1/ip-intel/providers/${provider.id}/keys`, { method: 'POST', body });
      toast({ tone: 'ok', title: existing ? 'Key updated' : 'Key added' });
      onClose();
      onDone();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent title={existing ? `Edit ${existing.label}` : `Add a key to ${provider.label}`} description={existing ? 'Leave the key fields empty to keep the saved key. A saved key is never shown again.' : 'More keys spread the load and keep lookups going when one hits its limit.'}>
        <form onSubmit={submit} className="grid gap-4">
          <Field label="Name"><Input value={label} onChange={(e) => setLabel(e.target.value)} maxLength={100} /></Field>
          {fields.map((f) => (
            <FieldInput key={f.name} spec={{ ...f, required: existing ? false : f.required }} value={values[f.name] ?? ''} onChange={(v) => setValues((c) => ({ ...c, [f.name]: v }))} optionalHint={existing ? `Saved: ${existing.hint}` : f.help} />
          ))}
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Weight" hint="A key with weight 3 gets three times the calls of weight 1."><Input type="number" min={1} max={1000} value={weight} onChange={(e) => setWeight(e.target.value)} /></Field>
            <Field label="Daily limit (optional)" hint="Calls per day for this key."><Input type="number" min={1} value={limit} onChange={(e) => setLimit(e.target.value)} placeholder="No limit" /></Field>
          </div>
          {!existing && <TestOutcome result={tester.result} error={tester.error} />}
          <ErrorBanner message={error} />
          <div className="flex justify-end gap-2">
            <DialogClose asChild><Button type="button" variant="outline">Cancel</Button></DialogClose>
            {!existing && (
              <Button type="button" variant="outline" disabled={tester.busy} onClick={() => void tester.run({ provider: provider.provider, ip: '8.8.8.8', settings: provider.settings, values: keyValues() })}>
                {tester.busy ? <Spinner /> : <FlaskConical className="size-3.5" />} Test first
              </Button>
            )}
            <Button type="submit" variant="primary" disabled={busy}>{busy ? <Spinner /> : null}{existing ? 'Save' : 'Add key'}</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/* ---------- provider settings ---------- */

function EditProvider({ provider, info, onClose, onDone }: { provider: ProviderView; info: ProviderInfo; onClose: () => void; onDone: () => void }) {
  const fields = info.fields.filter((f) => f.scope === 'provider');
  const [label, setLabel] = useState(provider.label);
  const [values, setValues] = useState<Record<string, string>>({ ...provider.settings });
  const [share, setShare] = useState(String(provider.sharePercent));
  const [priority, setPriority] = useState(String(provider.priority));
  const [limit, setLimit] = useState(provider.dailyLimit ? String(provider.dailyLimit) : '');
  const [strategy, setStrategy] = useState(provider.strategy);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const toast = useToast();

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api(`/v1/ip-intel/providers/${provider.id}`, {
        method: 'PATCH',
        body: { label: label.trim(), settings: Object.fromEntries(Object.entries(values).filter(([, v]) => v.trim())), sharePercent: Number(share), priority: Number(priority), dailyLimit: numberOrNull(limit), strategy },
      });
      toast({ tone: 'ok', title: 'Provider updated' });
      onClose();
      onDone();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent title={`Edit ${provider.label}`} className="max-w-xl">
        <form onSubmit={submit} className="grid gap-4">
          <Field label="Name"><Input value={label} onChange={(e) => setLabel(e.target.value)} maxLength={100} /></Field>
          {fields.map((f) => <FieldInput key={f.name} spec={f} value={values[f.name] ?? ''} onChange={(v) => setValues((c) => ({ ...c, [f.name]: v }))} />)}
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={`Share of addresses: ${share}%`} hint="Only this share of addresses goes to this provider."><input type="range" min={0} max={100} step={5} value={share} onChange={(e) => setShare(e.target.value)} className="accent-[var(--signal)]" /></Field>
            <Field label="Priority" hint="Lower runs first."><Input type="number" min={0} max={10000} value={priority} onChange={(e) => setPriority(e.target.value)} /></Field>
            <Field label="Daily limit (optional)" hint="Over all keys."><Input type="number" min={1} value={limit} onChange={(e) => setLimit(e.target.value)} placeholder="No limit" /></Field>
            <Field label="Several keys"><Segmented value={strategy} onChange={setStrategy} options={[{ value: 'weighted', label: 'Spread' }, { value: 'failover', label: 'Failover' }]} /></Field>
          </div>
          <ErrorBanner message={error} />
          <div className="flex justify-end gap-2">
            <DialogClose asChild><Button type="button" variant="outline">Cancel</Button></DialogClose>
            <Button type="submit" variant="primary" disabled={busy}>{busy ? <Spinner /> : null} Save</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/* ---------- provider cards ---------- */

function Meter({ used, limit }: { used: number; limit: number | null }) {
  if (limit === null) return <span className="tnum block text-right text-xs text-ink-2">{num(used)} today</span>;
  const pct = Math.min(100, (used / limit) * 100);
  return (
    <div className="ml-auto min-w-[120px]">
      <div className="flex justify-between text-xs text-ink-2"><span className="tnum">{num(used)}</span><span className="tnum text-ink-3">of {num(limit)}</span></div>
      <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-surface-3"><div className={cn('h-full rounded-full', pct >= 100 ? 'bg-bad' : pct >= 80 ? 'bg-warn' : 'bg-signal')} style={{ width: `${pct}%` }} /></div>
    </div>
  );
}

function KeyStatus({ k, providerOn }: { k: KeyView; providerOn: boolean }) {
  if (!k.enabled) return <Badge tone="neutral">Off</Badge>;
  if (k.broken) return <Badge tone="bad" title={k.broken}>Misconfigured</Badge>;
  if (k.coolingUntil) return <Badge tone="warn" title={k.lastError ?? undefined}>Cooling down</Badge>;
  if (k.dailyLimit !== null && k.usedToday >= k.dailyLimit) return <Badge tone="warn">Limit reached</Badge>;
  return <Badge tone={providerOn ? 'ok' : 'neutral'}>Ready</Badge>;
}

function ProviderCard({ p, info, usage, onChange, canEdit }: { p: ProviderView; info: ProviderInfo | undefined; usage: UsageTotals | undefined; onChange: () => void; canEdit: boolean }) {
  const [open, setOpen] = useState(p.keys.length > 0);
  const [edit, setEdit] = useState(false);
  const [keyDialog, setKeyDialog] = useState<KeyView | 'new' | null>(null);
  const [testing, setTesting] = useState<{ keyId?: string; label: string } | null>(null);
  const [confirm, setConfirm] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const toast = useToast();
  const st = STATUS[p.status];

  async function act(fn: () => Promise<unknown>, done?: string) {
    setError(null);
    try {
      await fn();
      if (done) toast({ tone: 'ok', title: done });
      setConfirm(null);
      onChange();
    } catch (e) {
      setError(errorMessage(e));
    }
  }
  const toggleProvider = () => act(() => api(`/v1/ip-intel/providers/${p.id}`, { method: 'PATCH', body: { enabled: !p.enabled } }));
  const toggleKey = (k: KeyView) => act(() => api(`/v1/ip-intel/providers/${p.id}/keys/${k.id}`, { method: 'PATCH', body: { enabled: !k.enabled } }));
  const removeKey = (k: KeyView) => act(() => api(`/v1/ip-intel/providers/${p.id}/keys/${k.id}`, { method: 'DELETE' }), 'Key removed');
  const removeProvider = () => act(() => api(`/v1/ip-intel/providers/${p.id}`, { method: 'DELETE' }), 'Provider removed');

  const needsKeys = info?.remote !== false;
  return (
    <Card className={cn('overflow-hidden', !p.enabled && 'opacity-75')}>
      <div className="flex flex-wrap items-start justify-between gap-3 p-4">
        <div className="flex min-w-0 items-start gap-3">
        {info && <ProviderMark p={info} size={40} />}
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-sm font-semibold tracking-tight text-ink">{p.label}</h3>
            <Badge tone={st.tone}>{st.label}</Badge>
            {p.sharePercent < 100 && <Badge tone="info">{p.sharePercent}% of addresses</Badge>}
            {p.keys.length > 1 && <Badge tone="outline">{p.strategy === 'weighted' ? 'Spread over keys' : 'Failover'}</Badge>}
          </div>
          {p.statusDetail && p.status !== 'ok' && <p className="mt-1 text-xs text-bad">{p.statusDetail}</p>}
          <div className="mt-2 flex flex-wrap gap-1">{(info?.provides ?? []).map((c) => <Badge key={c} tone="outline">{CAPABILITY[c]}</Badge>)}</div>
        </div>
        </div>
        <div className="flex flex-wrap items-center gap-4">
          <div className="text-right"><p className="text-[11px] uppercase tracking-wide text-ink-3">Today</p><Meter used={p.usedToday} limit={p.dailyLimit} /></div>
          {usage && usage.requests > 0 && <div className="text-right"><p className="text-[11px] uppercase tracking-wide text-ink-3">Success</p><p className="tnum text-sm font-semibold text-ink">{Math.round((usage.ok / usage.requests) * 100)}%</p></div>}
          {usage?.avgLatencyMs != null && <div className="text-right"><p className="text-[11px] uppercase tracking-wide text-ink-3">Avg time</p><p className="tnum text-sm font-semibold text-ink">{usage.avgLatencyMs} ms</p></div>}
        </div>
      </div>
      {canEdit && (
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line bg-surface-2/50 px-4 py-2">
          <div className="flex items-center gap-1">
            {needsKeys && <Button size="sm" variant="ghost" onClick={() => setOpen((o) => !o)}><ChevronDown className={cn('size-3.5 transition-transform', open && 'rotate-180')} /> {p.keys.length} key{p.keys.length === 1 ? '' : 's'}</Button>}
            {needsKeys && <Button size="sm" variant="ghost" onClick={() => setKeyDialog('new')}><Plus className="size-3.5" /> Add key</Button>}
            {needsKeys && <Button size="sm" variant="ghost" onClick={() => setTesting({ label: p.label })}><FlaskConical className="size-3.5" /> Test</Button>}
          </div>
          <div className="flex items-center gap-1">
            <Button size="sm" variant="ghost" onClick={() => void toggleProvider()}>{p.enabled ? 'Turn off' : 'Turn on'}</Button>
            <Button size="sm" variant="ghost" onClick={() => setEdit(true)}><Pencil className="size-3.5" /> Edit</Button>
            {confirm === p.id ? (
              <><Button size="sm" variant="danger" onClick={() => void removeProvider()}>Delete</Button><Button size="sm" variant="ghost" onClick={() => setConfirm(null)}>Cancel</Button></>
            ) : (
              <Button size="icon" variant="danger-ghost" aria-label="Delete provider" onClick={() => setConfirm(p.id)}><Trash2 className="size-3.5" /></Button>
            )}
          </div>
        </div>
      )}
      {error && <div className="px-4 pb-3"><ErrorBanner message={error} /></div>}
      {open && needsKeys && p.keys.length > 0 && (
        <Table>
          <thead><tr><Th>Key</Th><Th>Status</Th><Th>Weight</Th><Th>Today</Th><Th>Last problem</Th><Th /></tr></thead>
          <tbody>
            {p.keys.map((k) => (
              <Tr key={k.id}>
                <Td><span className="block text-[13px] font-medium text-ink">{k.label}</span><span className="font-mono text-xs text-ink-3">{k.hint}</span></Td>
                <Td><KeyStatus k={k} providerOn={p.enabled} /></Td>
                <Td className="tnum">{k.weight}</Td>
                <Td><Meter used={k.usedToday} limit={k.dailyLimit} /></Td>
                <Td className="max-w-[220px] text-xs text-ink-3">{k.lastError ? <span title={k.lastError}>{k.lastErrorAt ? `${timeAgo(k.lastErrorAt)}: ` : ''}<span className="line-clamp-1">{k.lastError}</span></span> : '-'}</Td>
                <Td className="text-right">
                  {canEdit && (
                    <div className="flex justify-end gap-1">
                      <Button size="sm" variant="ghost" onClick={() => setTesting({ keyId: k.id, label: `${p.label}: ${k.label}` })}>Test</Button>
                      <Button size="sm" variant="ghost" onClick={() => void toggleKey(k)}>{k.enabled ? 'Off' : 'On'}</Button>
                      <Button size="sm" variant="ghost" onClick={() => setKeyDialog(k)}>Edit</Button>
                      {confirm === k.id ? (
                        <><Button size="sm" variant="danger" onClick={() => void removeKey(k)}>Remove</Button><Button size="sm" variant="ghost" onClick={() => setConfirm(null)}>Cancel</Button></>
                      ) : (
                        <Button size="icon" variant="danger-ghost" aria-label="Remove key" onClick={() => setConfirm(k.id)}><Trash2 className="size-3.5" /></Button>
                      )}
                    </div>
                  )}
                </Td>
              </Tr>
            ))}
          </tbody>
        </Table>
      )}
      {edit && info && <EditProvider provider={p} info={info} onClose={() => setEdit(false)} onDone={onChange} />}
      {keyDialog && info && <KeyDialog provider={p} info={info} {...(keyDialog !== 'new' ? { existing: keyDialog } : {})} onClose={() => setKeyDialog(null)} onDone={onChange} />}
      {testing && <TestDialog title={`Test ${testing.label}`} body={(ip) => ({ providerId: p.id, ...(testing.keyId ? { keyId: testing.keyId } : {}), ip })} onClose={() => setTesting(null)} />}
    </Card>
  );
}

/* ---------- usage ---------- */

function UsageSection({ o, days, setDays }: { o: IpOverview; days: number; setDays: (d: number) => void }) {
  const usage = useApi<UsageResponse>(`/v1/ip-intel/usage?days=${days}`, { intervalMs: 60_000 });
  const nameOf = (ref: string): string => o.providers.find((p) => p.id === ref)?.label ?? (ref.startsWith('env:') ? `${ref.slice(4)} (environment)` : 'Removed provider');
  const { data, series, keyRows } = useMemo(() => {
    const u = usage.data;
    if (!u) return { data: [], series: [] as Series[], keyRows: [] };
    const refs = [...new Set(u.points.map((p) => p.providerRef))];
    const dayKeys: string[] = [];
    for (let i = days - 1; i >= 0; i--) dayKeys.push(new Date(Date.now() - i * 86_400_000).toISOString().slice(0, 10));
    const s: Series[] = refs.map((r, i) => ({ key: r, name: nameOf(r), color: COLORS[i % COLORS.length] ?? 'var(--signal)', area: true }));
    const d = dayKeys.map((day) => ({ label: day, values: Object.fromEntries(refs.map((r) => [r, u.points.filter((p) => p.day === day && p.providerRef === r).reduce((n, p) => n + p.requests, 0)])) }));
    const rows = o.providers.flatMap((p) => p.keys.map((k) => ({ key: k.id, label: `${p.label}: ${k.label}`, value: u.byKey[k.id]?.requests ?? 0, sub: u.byKey[k.id] ? `${u.byKey[k.id]?.errors ?? 0} errors` : '' })));
    return { data: d, series: s, keyRows: rows };
  }, [usage.data, days, o.providers]);

  return (
    <div className="grid gap-5 lg:grid-cols-3">
      <Card className="lg:col-span-2">
        <CardHeader title="Calls per day" description="Calls made to each provider. Cache hits do not appear here, because they cost nothing." action={<Segmented value={days} onChange={setDays} options={[{ value: 7, label: '7d' }, { value: 14, label: '14d' }, { value: 30, label: '30d' }]} />} />
        <div className="px-3 pb-4">
          {!usage.data ? <Skeleton className="m-2 h-48" /> : series.length === 0 ? <p className="px-3 py-10 text-center text-[13px] text-ink-3">No provider calls in this window yet.</p> : <AreaChart data={data} series={series} xLabel={(l) => l.slice(5)} />}
        </div>
      </Card>
      <Card>
        <CardHeader title="Calls by key" description="Over the selected window." />
        <BarList rows={keyRows} empty="No keys yet" />
      </Card>
    </div>
  );
}

/* ---------- cache and settings ---------- */

function SettingRow({ s, draft, setDraft }: { s: SettingView; draft: string | boolean | undefined; setDraft: (v: string | boolean | undefined) => void }) {
  const current = draft !== undefined ? draft : s.value;
  return (
    <div className="grid gap-1.5 border-t border-line py-4 first:border-t-0 first:pt-0 sm:grid-cols-[1fr_220px] sm:gap-6">
      <div>
        <p className="text-[13px] font-medium text-ink">{s.label}</p>
        <p className="mt-0.5 text-xs text-ink-3">{s.help}</p>
        <p className="mt-1 text-[11.5px] text-ink-3">Now: {s.source === 'dashboard' ? 'set here' : s.source === 'environment' ? 'from the environment' : 'default'}</p>
      </div>
      <div className="flex items-center gap-2 sm:justify-end">
        {s.kind === 'boolean' ? (
          <Segmented value={current === true ? 'on' : 'off'} onChange={(v) => setDraft(v === 'on')} options={[{ value: 'on', label: 'On' }, { value: 'off', label: 'Off' }]} />
        ) : (
          <Input type="number" min={s.min} max={s.max} className="w-28" value={String(current ?? '')} onChange={(e) => setDraft(e.target.value)} />
        )}
        {s.source === 'dashboard' && <Button size="sm" variant="ghost" onClick={() => setDraft(undefined)} title="Go back to the environment value" type="button">Reset</Button>}
      </div>
    </div>
  );
}

function CacheSection({ o, onSaved }: { o: IpOverview; onSaved: () => void }) {
  const [draft, setDraft] = useState<Record<string, string | boolean | undefined>>({});
  const [reset, setReset] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  const c = o.cache;
  const hits = c.memoryHits + c.sharedHits;
  const total = hits + c.providerCalls;

  const body = (): Record<string, unknown> => {
    const out: Record<string, unknown> = {};
    for (const s of o.settings) {
      if (reset.has(s.key)) { out[s.key] = null; continue; }
      const d = draft[s.key];
      if (d === undefined) continue;
      out[s.key] = s.kind === 'number' ? Number(d) : d;
    }
    return out;
  };
  const dirty = Object.keys(body()).length > 0;

  async function save(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api('/v1/instance/settings', { method: 'PATCH', body: body() });
      setDraft({});
      setReset(new Set());
      toast({ tone: 'ok', title: 'Settings saved', description: 'Applied now, no restart needed.' });
      onSaved();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid gap-5 lg:grid-cols-3">
      <Card className="lg:col-span-2">
        <CardHeader title="Cache and time budget" description="Every address is cached per provider, so the same visitor never costs a second call within the cache time." />
        <form onSubmit={save} className="px-5 pb-5">
          {o.settings.map((s) => (
            <SettingRow
              key={s.key}
              s={s}
              draft={reset.has(s.key) ? undefined : draft[s.key]}
              setDraft={(v) => {
                setReset((cur) => { const n = new Set(cur); if (v === undefined) n.add(s.key); else n.delete(s.key); return n; });
                setDraft((cur) => ({ ...cur, [s.key]: v }));
              }}
            />
          ))}
          <ErrorBanner message={error} />
          <div className="mt-4 flex justify-end"><Button type="submit" variant="primary" disabled={!dirty || busy}>{busy ? <Spinner /> : null} Save changes</Button></div>
        </form>
      </Card>
      <Card>
        <CardHeader title="Since the server started" />
        <div className="grid gap-3 px-5 pb-5 text-[13px]">
          <div className="flex items-center justify-between"><span className="text-ink-2">Redis</span><Badge tone={c.redis ? 'ok' : 'neutral'}>{c.redis ? 'Connected' : 'Not connected'}</Badge></div>
          <div className="flex items-center justify-between"><span className="text-ink-2">Shared cache</span><Badge tone={c.sharedEnabled && c.redis ? 'ok' : 'neutral'}>{c.sharedEnabled && c.redis ? 'In use' : 'Memory only'}</Badge></div>
          <div className="flex items-center justify-between"><span className="text-ink-2">Answered from cache</span><span className="tnum font-semibold text-ink">{total > 0 ? `${Math.round((hits / total) * 100)}%` : '-'}</span></div>
          <div className="flex items-center justify-between"><span className="text-ink-2">Memory hits</span><span className="tnum text-ink">{compact(c.memoryHits)}</span></div>
          <div className="flex items-center justify-between"><span className="text-ink-2">Redis hits</span><span className="tnum text-ink">{compact(c.sharedHits)}</span></div>
          <div className="flex items-center justify-between"><span className="text-ink-2">Provider calls</span><span className="tnum text-ink">{compact(c.providerCalls)}</span></div>
          <div className="flex items-center justify-between"><span className="text-ink-2">Failed calls</span><span className={cn('tnum', c.failures > 0 ? 'text-bad' : 'text-ink')}>{compact(c.failures)}</span></div>
          <div className="flex items-center justify-between"><span className="text-ink-2">Private addresses skipped</span><span className="tnum text-ink">{compact(c.skippedPrivate)}</span></div>
          {!c.redis && <p className="rounded-lg bg-surface-2 p-2.5 text-xs text-ink-3">Without Redis the cache is lost when the server restarts, and each server instance keeps its own. Set REDIS_URL to share it.</p>}
        </div>
      </Card>
    </div>
  );
}

/* ---------- the page ---------- */

function Stat({ icon, label, value, sub }: { icon: ReactNode; label: string; value: ReactNode; sub?: ReactNode }) {
  return (
    <Card className="p-4">
      <div className="flex items-center gap-2 text-xs text-ink-3">{icon}{label}</div>
      <p className="tnum mt-1.5 text-2xl font-semibold tracking-tight text-ink">{value}</p>
      {sub && <p className="mt-0.5 text-xs text-ink-3">{sub}</p>}
    </Card>
  );
}

function Admin() {
  const o = useApi<IpOverview>('/v1/ip-intel', { intervalMs: 15_000 });
  const [adding, setAdding] = useState(false);
  const [days, setDays] = useState(14);
  const usageToday = useApi<UsageResponse>('/v1/ip-intel/usage?days=1', { intervalMs: 15_000 });
  const data = o.data;

  if (!data) return o.error ? <ErrorBanner message={o.error} /> : <Skeleton className="h-64" />;
  const t = data.totalsToday;
  const c = data.cache;
  const hits = c.memoryHits + c.sharedHits;
  const working = data.providers.filter((p) => p.status === 'ok' || p.status === 'degraded').length + data.environment.length;

  return (
    <div className="grid gap-6">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Stat icon={<ShieldCheck className="size-3.5" />} label="Providers working" value={working} sub={`${data.providers.length + data.environment.length} set up`} />
        <Stat icon={<Zap className="size-3.5" />} label="Calls today" value={compact(t.requests)} sub={t.errors + t.rateLimited + t.authFailed > 0 ? `${t.errors + t.rateLimited + t.authFailed} failed` : 'none failed'} />
        <Stat icon={<Layers className="size-3.5" />} label="Answered from cache" value={hits + c.providerCalls > 0 ? `${Math.round((hits / (hits + c.providerCalls)) * 100)}%` : '-'} sub="since the server started" />
        <Stat icon={<Activity className="size-3.5" />} label="Lookups" value={compact(c.lookups)} sub="since the server started" />
      </div>

      <section className="grid gap-3">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-[15px] font-semibold tracking-tight text-ink">Providers</h2>
            <p className="text-[13px] text-ink-3">All providers are asked in parallel and their answers are merged. A flag fires when any provider reports it.</p>
          </div>
          <Button variant="primary" onClick={() => setAdding(true)}><Plus className="size-3.5" /> Add provider</Button>
        </div>
        {data.providers.length === 0 && data.environment.length === 0 ? (
          <Card><EmptyState icon={<KeyRound className="size-5" />} title="No IP data provider yet" description="Without one, VPN, proxy and Tor flags stay unchecked unless you load local lists. Add a provider and a key to start; free plans are enough to try it." action={<Button variant="primary" onClick={() => setAdding(true)}><Plus className="size-3.5" /> Add provider</Button>} /></Card>
        ) : (
          data.providers.map((p) => <ProviderCard key={p.id} p={p} info={infoFor(data.registry, p.provider)} usage={usageToday.data?.byProvider[p.id]} onChange={o.reload} canEdit />)
        )}
        {data.environment.length > 0 && (
          <Card className="p-4">
            <div className="flex items-center justify-between gap-3">
              <div><h3 className="text-sm font-semibold text-ink">Set in the server&rsquo;s environment</h3><p className="mt-0.5 text-xs text-ink-3">Named in IP_PROVIDERS. Change these in your deployment settings; they are counted here but not editable.</p></div>
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              {data.environment.map((e) => <Badge key={e.ref} tone="outline">{infoFor(data.registry, e.provider)?.label ?? e.provider}: {compact(e.usage.requests)} calls today</Badge>)}
            </div>
          </Card>
        )}
      </section>

      <section className="grid gap-3">
        <h2 className="text-[15px] font-semibold tracking-tight text-ink">Usage</h2>
        <UsageSection o={data} days={days} setDays={setDays} />
      </section>

      <section className="grid gap-3">
        <h2 className="text-[15px] font-semibold tracking-tight text-ink">Cache</h2>
        <CacheSection o={data} onSaved={o.reload} />
      </section>

      {data.files && (
        <Card className="p-4">
          <h3 className="text-sm font-semibold text-ink">Local lists and databases</h3>
          <p className="mt-0.5 text-xs text-ink-3">Free, instant and private: visitor IPs never leave your server. Set up with the ip-data command; see the self-hosting docs.</p>
          <div className="mt-3 flex flex-wrap gap-2">
            {Object.entries(data.files).map(([k, v]) => <Badge key={k} tone={v ? 'ok' : 'neutral'}>{k}: {typeof v === 'boolean' ? (v ? 'loaded' : 'not set') : v ? num(v) : 'not set'}</Badge>)}
          </div>
        </Card>
      )}

      <AddProvider registry={data.registry} added={data.providers.map((p) => p.provider)} open={adding} onOpenChange={setAdding} onDone={o.reload} />
      {o.error && <ErrorBanner message={o.error} />}
      <AlertTriangleNote />
    </div>
  );
}

function AlertTriangleNote() {
  return (
    <p className="flex items-start gap-2 text-xs text-ink-3"><AlertTriangle className="mt-0.5 size-3.5 shrink-0" /> Each provider receives the visitor&rsquo;s IP address and nothing else. That makes it a processor of personal data: have an agreement with it and name it in your privacy policy. Keys are stored encrypted and never shown again.</p>
  );
}

export function IpProviders() {
  const inst = useApi<{ admin: boolean }>('/v1/instance');
  if (inst.error) return <ErrorBanner message={inst.error} />;
  if (!inst.data) return <Skeleton className="h-48" />;
  if (!inst.data.admin) {
    return <Card><EmptyState icon={<ShieldCheck className="size-5" />} title="Only the administrator can change this" description="IP providers and the cache are shared by every project on this server, so the first account (the administrator) manages them." /></Card>;
  }
  return <Admin />;
}
