'use client';

import type { QualityResponse } from '@trace-id/signals/api';
import { CheckCircle2, TriangleAlert } from 'lucide-react';
import { BarList, Donut, Histogram } from '@/components/charts/charts';
import { StatStrip } from '@/components/domain';
import { Card, CardHeader, ErrorBanner, PageHeader, Segmented, Skeleton } from '@/components/ui/primitives';
import { compact, pct } from '@/lib/format';
import { RANGES, useProject } from '@/lib/project-context';
import { useApi } from '@/lib/use-api';

const CONF_LABELS = ['0-9%', '10-19%', '20-29%', '30-39%', '40-49%', '50-59%', '60-69%', '70-79%', '80-89%', '90%+'];

function Check({ ok, title, detail }: { ok: boolean; title: string; detail: string }) {
  const I = ok ? CheckCircle2 : TriangleAlert;
  return (
    <li className="flex items-start gap-3 py-2.5">
      <I className={ok ? 'mt-0.5 size-4 shrink-0 text-ok' : 'mt-0.5 size-4 shrink-0 text-warn'} />
      <div>
        <p className="text-[13px] font-medium text-ink">{title}</p>
        <p className="text-xs text-ink-3">{detail}</p>
      </div>
    </li>
  );
}

export default function QualityPage() {
  const { project, range, setRange } = useProject();
  const q = useApi<QualityResponse>(`/v1/projects/${project.id}/quality?days=${Math.max(range, 7)}`);
  const d = q.data;

  const advice: { ok: boolean; title: string; detail: string }[] = d
    ? [
        { ok: d.coverage.linkedId >= 0.5, title: 'Accounts are linked', detail: d.coverage.linkedId >= 0.5 ? `${pct(d.coverage.linkedId, 0)} of events carry a linkedId, so account sharing and rings can be found.` : `Only ${pct(d.coverage.linkedId, 0)} of events carry a linkedId. Pass your user id at sign-in, sign-up and checkout to unlock account signals.` },
        { ok: d.coverage.tags >= 0.5, title: 'Events are tagged', detail: d.coverage.tags >= 0.5 ? 'Tags such as the action name make events easier to filter.' : 'Add tags (for example action: signup) so you can tell what each event was for.' },
        { ok: d.coverage.country >= 0.9, title: 'IP geolocation', detail: d.coverage.country >= 0.9 ? 'Nearly every event has a country.' : 'Many events have no country. Configure a GeoIP database on the server.' },
        { ok: (d.collectMs.p95 ?? 0) < 1500, title: 'Collection speed', detail: d.collectMs.p95 === null ? 'No timing data yet.' : `95% of collections finish within ${Math.round(d.collectMs.p95)} ms. Slow collection delays your form submit.` },
        { ok: d.identification.conflict < 0.05, title: 'Identification conflicts', detail: d.identification.conflict < 0.05 ? 'Conflicts are rare.' : `${pct(d.identification.conflict)} of events had a token that disagreed with the device signals, which can mean shared browsers or tampering.` },
      ]
    : [];

  return (
    <>
      <PageHeader title="Data quality" description="How healthy your integration is: what you send, how fast it collects, and how well devices are recognised." actions={<Segmented value={range} onChange={setRange} options={RANGES.filter((r) => r.days >= 7).map((r) => ({ value: r.days, label: r.label }))} />} />
      <ErrorBanner message={q.error} />
      {d ? (
        <StatStrip
          items={[
            { label: 'Events analysed', value: compact(d.events) },
            { label: 'Collection time (median)', value: d.collectMs.p50 != null ? `${Math.round(d.collectMs.p50)} ms` : '-', hint: d.collectMs.p95 != null ? `p95 ${Math.round(d.collectMs.p95)} ms · p99 ${Math.round(d.collectMs.p99 ?? 0)} ms` : undefined },
            { label: 'Linked to accounts', value: pct(d.coverage.linkedId, 0), tone: d.coverage.linkedId < 0.5 ? 'warn' : undefined, hint: 'Events with a linkedId' },
            { label: 'Returning recognised', value: pct(d.identification.token + d.identification.match, 0), hint: 'By token or by signals' },
          ]}
        />
      ) : <Skeleton className="h-24" />}

      <div className="mt-5 grid gap-5 lg:grid-cols-[1fr_1fr]">
        <Card>
          <CardHeader title="Health checks" description="What to fix first" />
          <ul className="divide-y divide-line px-5 pb-3">{d ? advice.map((a) => <Check key={a.title} {...a} />) : <Skeleton className="my-3 h-40" />}</ul>
        </Card>
        <Card>
          <CardHeader title="How devices are recognised" />
          <div className="px-5 pb-5">
            {d ? (
              <Donut
                slices={[
                  { key: 'new', label: 'New device', value: Math.round(d.identification.new * 1000), color: 'var(--signal)' },
                  { key: 'token', label: 'Returning (token)', value: Math.round(d.identification.token * 1000), color: 'var(--info)' },
                  { key: 'match', label: 'Matched by signals', value: Math.round(d.identification.match * 1000), color: 'var(--warn)' },
                  { key: 'conflict', label: 'Conflict', value: Math.round(d.identification.conflict * 1000), color: 'var(--bad)' },
                ]}
              />
            ) : <Skeleton className="h-40" />}
            <p className="mt-3 text-xs text-ink-3">A high share matched by signals, rather than by token, means visitors often lose their token: cleared cookies, private windows or Safari limits. Serving the SDK from your own domain helps.</p>
          </div>
        </Card>
      </div>

      <div className="mt-5 grid gap-5 lg:grid-cols-2">
        <Card>
          <CardHeader title="Match confidence" description="Returning events by how sure Trace was" />
          <div className="px-5 pb-5">{d ? <Histogram values={d.confidenceBuckets} labels={CONF_LABELS} colorFor={(i) => (i >= 8 ? 'var(--ok)' : i >= 6 ? 'var(--warn)' : 'var(--bad)')} /> : <Skeleton className="h-40" />}</div>
        </Card>
        <Card>
          <CardHeader title="Fingerprint components collected" description="Share of events that included each reading" />
          <div className="max-h-72 overflow-y-auto">
            <BarList color="var(--info)" rows={(d?.components ?? []).map((c) => ({ key: c.name, label: c.name, value: Math.round(c.share * 100), sub: undefined }))} empty="No component data" />
          </div>
          <p className="px-5 pb-4 text-xs text-ink-3">Values are percentages of events. A reading missing on many events usually means a browser or privacy setting blocks it.</p>
        </Card>
      </div>
    </>
  );
}
