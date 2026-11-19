'use client';

import type { PolicySimulation } from '@trace-id/signals/api';
import { FlaskConical, ShieldCheck } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { AreaChart, BarList, Histogram, type Series } from '@/components/charts/charts';
import { CopyButton, Badge, Button, Card, CardHeader, Field, Input, PageHeader, Segmented, Select, Skeleton } from '@/components/ui/primitives';
import { EntityLink, StatStrip } from '@/components/domain';
import { Flag } from '@/components/logos';
import { cn } from '@/lib/cn';
import { compact, num, pct, shortDay } from '@/lib/format';
import { useProject } from '@/lib/project-context';
import { SIGNALS, signalTitle } from '@/lib/signals';
import { useApi } from '@/lib/use-api';

interface Rule {
  minScore: number | null;
  signals: string[];
  countries: string;
  notCountries: string;
  matchKind: string;
}

const EMPTY: Rule = { minScore: 70, signals: [], countries: '', notCountries: '', matchKind: '' };

const PRESETS: { label: string; hint: string; rule: Rule }[] = [
  { label: 'Balanced', hint: 'Score 70 or higher', rule: { ...EMPTY, minScore: 70 } },
  { label: 'Strict', hint: 'Score 50 or higher', rule: { ...EMPTY, minScore: 50 } },
  { label: 'Automation', hint: 'Bots, scripted input, AI agents', rule: { ...EMPTY, minScore: null, signals: ['bot', 'automatedInput', 'aiAgent'] } },
  { label: 'Hidden network', hint: 'VPN, Tor or proxy', rule: { ...EMPTY, minScore: null, signals: ['vpn', 'tor', 'proxy'] } },
  { label: 'Shared accounts', hint: 'Many accounts or devices', rule: { ...EMPTY, minScore: null, signals: ['multiAccount', 'accountSharing'] } },
];

const SCORE_LABELS = ['0-9', '10-19', '20-29', '30-39', '40-49', '50-59', '60-69', '70-79', '80-89', '90+'];
const SERIES: Series[] = [{ key: 'matched', name: 'Would be flagged', color: 'var(--bad)', area: true }];

function queryOf(days: number, r: Rule): string | null {
  const q = new URLSearchParams({ days: String(days) });
  if (r.minScore !== null) q.set('minScore', String(r.minScore));
  if (r.signals.length) q.set('signals', r.signals.join(','));
  const cl = (t: string) => t.split(/[\s,]+/).filter((c) => /^[A-Za-z]{2}$/.test(c)).join(',');
  if (cl(r.countries)) q.set('countries', cl(r.countries));
  if (cl(r.notCountries)) q.set('notCountries', cl(r.notCountries));
  if (r.matchKind) q.set('matchKind', r.matchKind);
  return q.size > 1 ? q.toString() : null;
}

function Flags({ text }: { text: string }) {
  const codes = text.split(/[\s,]+/).filter((c) => /^[A-Za-z]{2}$/.test(c));
  if (codes.length === 0) return null;
  return <span className="mt-1.5 flex flex-wrap gap-1.5">{codes.map((c) => <span key={c} className="inline-flex items-center gap-1.5 rounded-md bg-surface-3 px-1.5 py-1 text-[11px] text-ink-2"><Flag code={c} />{c.toUpperCase()}</span>)}</span>;
}

export default function PolicyPage() {
  const { project } = useProject();
  const base = `/projects/${project.id}`;
  const [days, setDays] = useState(30);
  const [rule, setRule] = useState<Rule>(PRESETS[0]!.rule);
  const [debounced, setDebounced] = useState(rule);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(rule), 350);
    return () => clearTimeout(t);
  }, [rule]);

  const qs = useMemo(() => queryOf(days, debounced), [days, debounced]);
  const sim = useApi<PolicySimulation>(qs ? `/v1/projects/${project.id}/policy/simulate?${qs}` : null);
  const d = qs ? sim.data : null;
  const set = (patch: Partial<Rule>) => setRule((r) => ({ ...r, ...patch }));
  const toggle = (id: string) => set({ signals: rule.signals.includes(id) ? rule.signals.filter((s) => s !== id) : [...rule.signals, id] });

  const code = useMemo(() => {
    const parts: string[] = [];
    if (rule.minScore !== null) parts.push(`event.suspectScore >= ${rule.minScore}`);
    if (rule.signals.length) parts.push(`[${rule.signals.map((s) => `'${s}'`).join(', ')}].some((s) => event.signals[s].detected)`);
    const cl = (t: string) => t.split(/[\s,]+/).filter((c) => /^[A-Za-z]{2}$/.test(c)).map((c) => `'${c.toUpperCase()}'`);
    if (cl(rule.countries).length) parts.push(`[${cl(rule.countries).join(', ')}].includes(event.ip.country)`);
    if (cl(rule.notCountries).length) parts.push(`![${cl(rule.notCountries).join(', ')}].includes(event.ip.country)`);
    if (rule.matchKind) parts.push(`event.matchKind === '${rule.matchKind}'`);
    return `// Log first, enforce later.\nconst flagged =\n  ${parts.join('\n  && ') || 'false'};\n\nif (flagged) {\n  logger.warn('trace shadow flag', { eventId: event.eventId });\n  // challenge or block only once the numbers look right\n}`;
  }, [rule]);

  return (
    <>
      <PageHeader
        title="Policy simulator"
        description="Test a rule against your own past traffic before it blocks anyone. Nothing here changes behaviour: it shows what would have happened."
        actions={<Badge tone="signal" className="gap-1.5 py-1"><ShieldCheck className="size-3.5" /> Shadow mode</Badge>}
      />
      <div className="mb-5 flex flex-wrap items-center gap-2">
        <span className="mr-1 text-xs font-medium text-ink-3">Presets</span>
        {PRESETS.map((p) => (
          <button key={p.label} onClick={() => setRule(p.rule)} title={p.hint} className="cursor-pointer rounded-full border border-line-strong bg-surface px-3.5 py-1.5 text-[13px] font-medium text-ink-2 transition-colors hover:border-signal hover:text-signal-ink">
            {p.label}
          </button>
        ))}
      </div>
      <div className="grid items-start gap-5 xl:grid-cols-[360px_1fr]">
        <div className="grid content-start gap-4">
          <Card>
            <CardHeader title="Rule" description="A visit matches when every condition you set is true." />
            <div className="grid gap-4 px-5 pb-5">
              <Field label={`Minimum score: ${rule.minScore ?? 'off'}`}>
                <div className="flex items-center gap-3">
                  <input type="range" min={0} max={100} step={5} value={rule.minScore ?? 0} onChange={(e) => set({ minScore: Number(e.target.value) })} className="flex-1 accent-[var(--signal)]" />
                  <Button size="sm" variant="ghost" onClick={() => set({ minScore: rule.minScore === null ? 70 : null })}>{rule.minScore === null ? 'Use' : 'Off'}</Button>
                </div>
              </Field>
              <div className="grid gap-1.5">
                <span className="text-xs font-medium text-ink-2">Any of these signals ({rule.signals.length || 'none'})</span>
                <div className="flex flex-wrap gap-1.5">
                  {SIGNALS.map((s) => (
                    <button key={s.id} onClick={() => toggle(s.id)} aria-pressed={rule.signals.includes(s.id)} className={cn('cursor-pointer rounded-md border px-2 py-1 text-[11px] font-medium transition-colors', rule.signals.includes(s.id) ? 'border-signal bg-signal-soft text-signal-ink' : 'border-line-strong text-ink-2 hover:bg-surface-3')}>
                      {s.title}
                    </button>
                  ))}
                </div>
              </div>
              <Field label="Only from countries" hint="Two-letter codes, comma separated. Leave empty for all."><Input value={rule.countries} onChange={(e) => set({ countries: e.target.value })} placeholder="RU, NG" className="font-mono text-xs uppercase" /><Flags text={rule.countries} /></Field>
              <Field label="Except from countries"><Input value={rule.notCountries} onChange={(e) => set({ notCountries: e.target.value })} placeholder="US, GB" className="font-mono text-xs uppercase" /><Flags text={rule.notCountries} /></Field>
              <Field label="Identification">
                <Select value={rule.matchKind} onChange={(e) => set({ matchKind: e.target.value })}>
                  <option value="">Any</option>
                  <option value="new">New devices only</option>
                  <option value="token">Returning (token)</option>
                  <option value="match">Matched by signals</option>
                  <option value="conflict">Conflicts</option>
                </Select>
              </Field>
            </div>
          </Card>
        </div>

        <div className="grid min-w-0 content-start gap-4">
          <div className="flex items-center justify-between">
            <h2 className="flex items-center gap-2 text-sm font-semibold"><FlaskConical className="size-4 text-signal" /> Result over the last</h2>
            <Segmented value={days} onChange={setDays} options={[{ value: 7, label: '7d' }, { value: 30, label: '30d' }, { value: 90, label: '90d' }]} />
          </div>
          {!qs ? (
            <Card className="p-10 text-center text-[13px] text-ink-3">Set at least one condition to see what it would catch.</Card>
          ) : (
            <>
              {d ? (
                <StatStrip
                  items={[
                    { label: 'Would flag', value: compact(d.matchedEvents), tone: d.matchRate > 0.2 ? 'warn' : undefined, hint: `${pct(d.matchRate, d.matchRate < 0.01 ? 2 : 1)} of ${compact(d.totalEvents)} events` },
                    { label: 'Devices affected', value: compact(d.matchedVisitors), hint: `of ${compact(d.totalVisitors)} devices` },
                    { label: 'Accounts affected', value: compact(d.matchedAccounts), hint: 'Distinct linked ids' },
                    { label: 'Per day', value: compact(Math.round(d.matchedEvents / d.days)), hint: 'Average flagged events' },
                  ]}
                />
              ) : <Skeleton className="h-24" />}
              <Card>
                <CardHeader title="Flagged per day" description="Spikes here are what your rule would have caught on those days" />
                <div className="px-3 pb-4">{d ? <AreaChart data={d.series.map((p) => ({ label: p.t, values: { matched: p.matched } }))} series={SERIES} xLabel={shortDay} height={210} /> : <Skeleton className="mx-2 h-52" />}</div>
              </Card>
              <div className="grid gap-4 lg:grid-cols-2">
                <Card>
                  <CardHeader title="Scores of flagged events" description="A rule that mostly catches low scores deserves a second look" />
                  <div className="px-5 pb-5">{d ? <Histogram values={d.scoreBands} labels={SCORE_LABELS} colorFor={(i) => (i >= 7 ? 'var(--bad)' : i >= 3 ? 'var(--warn)' : 'var(--ok)')} /> : <Skeleton className="h-40" />}</div>
                </Card>
                <Card>
                  <CardHeader title="Accounts hit most" description="Check these are not good customers" />
                  <BarList color="var(--bad)" rows={(d?.topAccounts ?? []).map((a) => ({ key: a.linkedId, label: <EntityLink href={`${base}/accounts/${encodeURIComponent(a.linkedId)}`} mono>{a.linkedId}</EntityLink>, value: a.hits }))} empty="No linked accounts among the matches" />
                </Card>
              </div>
              <Card>
                <CardHeader title="Use this rule on your server" description="Run it in shadow mode first: log what it flags, then enforce when the numbers match what you saw here." action={<CopyButton value={code} />} />
                <pre className="mx-5 mb-5 overflow-x-auto rounded-xl bg-[#0d1014] p-4 font-mono text-[12px] leading-5 text-[#d7dbe0]">{code}</pre>
                {rule.minScore !== null && rule.signals.length === 0 && !rule.countries && !rule.notCountries && !rule.matchKind && (
                  <p className="border-t border-line px-5 py-3 text-xs text-ink-3">A score-only rule can also be sent to you as a webhook: set the flag threshold to {rule.minScore} on the <Link href={`${base}/webhooks`} className="text-signal hover:underline">webhooks page</Link>. Signals named: {rule.signals.map(signalTitle).join(', ') || 'none'}.</p>
                )}
              </Card>
              <p className="text-xs text-ink-3">{d ? `${num(d.totalEvents)} events analysed.` : ''} Past traffic includes visitors Trace already knew were risky, so treat the result as an estimate of volume, not accuracy. Label events on the Events page to measure precision.</p>
            </>
          )}
        </div>
      </div>
    </>
  );
}
