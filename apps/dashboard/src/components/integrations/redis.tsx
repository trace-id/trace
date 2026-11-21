'use client';

import { CheckCircle2, Database, FlaskConical, ShieldCheck } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { Badge, Button, Card, CardHeader, EmptyState, ErrorBanner, Field, Input, Skeleton, Spinner } from '@/components/ui/primitives';
import { useToast } from '@/components/ui/toast';
import { api, errorMessage } from '@/lib/api';
import { useApi } from '@/lib/use-api';

interface RedisStatus {
  status: 'off' | 'connected' | 'connecting' | 'failing';
  target: string | null;
  source: 'dashboard' | 'environment' | 'none';
}
interface Probe {
  ok: boolean;
  latencyMs: number;
  error?: string;
}

const STATE: Record<RedisStatus['status'], { tone: 'ok' | 'warn' | 'bad' | 'neutral'; label: string }> = {
  connected: { tone: 'ok', label: 'Connected' },
  connecting: { tone: 'warn', label: 'Connecting' },
  failing: { tone: 'bad', label: 'Not reachable' },
  off: { tone: 'neutral', label: 'Not set up' },
};
const SOURCE = { dashboard: 'set here', environment: 'from the REDIS_URL environment variable', none: 'nothing set' } as const;

function RedisAdmin() {
  const s = useApi<RedisStatus>('/v1/instance/redis', { intervalMs: 10_000 });
  const [url, setUrl] = useState('');
  const [probe, setProbe] = useState<Probe | null>(null);
  const [testing, setTesting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const toast = useToast();

  async function test() {
    setTesting(true);
    setProbe(null);
    setError(null);
    try {
      setProbe(await api<Probe>('/v1/instance/redis/test', { method: 'POST', body: url.trim() ? { url: url.trim() } : {} }));
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setTesting(false);
    }
  }

  async function save(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await api('/v1/instance/settings', { method: 'PATCH', body: { 'redis.url': url.trim() } });
      setUrl('');
      setProbe(null);
      toast({ tone: 'ok', title: 'Redis address saved', description: 'Applied now, no restart needed.' });
      s.reload();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  async function useEnvironment() {
    setError(null);
    try {
      await api('/v1/instance/settings', { method: 'PATCH', body: { 'redis.url': null } });
      toast({ tone: 'ok', title: 'Back to the environment value' });
      s.reload();
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  if (!s.data) return s.error ? <ErrorBanner message={s.error} /> : <Skeleton className="h-48" />;
  const st = STATE[s.data.status];
  return (
    <div className="grid gap-5 lg:grid-cols-3">
      <Card className="lg:col-span-2">
        <CardHeader title="Redis" description="Optional. Trace runs without it, but a few things get better when it is there." />
        <form onSubmit={save} className="grid gap-4 px-5 pb-5">
          <div className="flex flex-wrap items-center gap-3 rounded-xl border border-line bg-surface-2/50 p-3.5">
            <Badge tone={st.tone}>{st.label}</Badge>
            <span className="text-[13px] text-ink-2">{s.data.target ? <>Using <span className="font-mono text-ink">{s.data.target}</span>, {SOURCE[s.data.source]}</> : 'No Redis address is set.'}</span>
          </div>
          <Field label="Redis address" hint="Saved encrypted and never shown again. Use rediss:// when your provider requires TLS. Leave empty to test the address already in use.">
            <Input type="password" autoComplete="off" spellCheck={false} value={url} onChange={(e) => setUrl(e.target.value)} placeholder="rediss://default:password@host:6379" />
          </Field>
          {probe && (probe.ok ? (
            <div className="flex items-center gap-2 rounded-xl border border-ok/30 bg-ok-soft p-3 text-[13px] text-ok" role="status"><CheckCircle2 className="size-4" /> Connected and answered in {probe.latencyMs} ms</div>
          ) : <ErrorBanner message={`Could not connect: ${probe.error ?? 'no answer'}`} />)}
          <ErrorBanner message={error} />
          <div className="flex flex-wrap justify-between gap-2">
            <div>{s.data.source === 'dashboard' && <Button type="button" variant="ghost" onClick={() => void useEnvironment()}>Use the environment value</Button>}</div>
            <div className="flex gap-2">
              <Button type="button" variant="outline" disabled={testing || (!url.trim() && s.data.status === 'off')} onClick={() => void test()}>{testing ? <Spinner /> : <FlaskConical className="size-3.5" />} Test connection</Button>
              <Button type="submit" variant="primary" disabled={saving || !url.trim()}>{saving ? <Spinner /> : null} Save</Button>
            </div>
          </div>
        </form>
      </Card>
      <Card>
        <CardHeader title="What it is used for" />
        <ul className="grid gap-3 px-5 pb-5 text-[13px] text-ink-2">
          <li className="flex gap-2.5"><ShieldCheck className="mt-0.5 size-4 shrink-0 text-signal" /><span><b className="text-ink">Rate limits</b> that hold across several server instances.</span></li>
          <li className="flex gap-2.5"><ShieldCheck className="mt-0.5 size-4 shrink-0 text-signal" /><span><b className="text-ink">Velocity signals</b> (many events from one device or network in a short time).</span></li>
          <li className="flex gap-2.5"><ShieldCheck className="mt-0.5 size-4 shrink-0 text-signal" /><span><b className="text-ink">A shared IP cache</b>, so a provider is asked about an address once however many servers see it, and answers survive restarts.</span></li>
          <li className="rounded-lg bg-surface-2 p-2.5 text-xs text-ink-3">Without Redis the server still runs and identifies visitors. Velocity signals and rate limits are off, and the IP cache lives in memory. If Redis goes down the server carries on the same way.</li>
        </ul>
      </Card>
    </div>
  );
}

export function RedisSettings() {
  const inst = useApi<{ admin: boolean }>('/v1/instance');
  if (inst.error) return <ErrorBanner message={inst.error} />;
  if (!inst.data) return <Skeleton className="h-48" />;
  if (!inst.data.admin) return <Card><EmptyState icon={<Database className="size-5" />} title="Only the administrator can change this" description="Redis is shared by every project on this server, so the first account (the administrator) manages it." /></Card>;
  return <RedisAdmin />;
}
