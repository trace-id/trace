'use client';

import type { FraudModelsResponse } from '@trace-id/signals/api';
import { Brain, RefreshCw } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { Badge, Button, Card, CardHeader, EmptyState, ErrorBanner, PageHeader, Skeleton } from '@/components/ui/primitives';
import { api, errorMessage } from '@/lib/api';
import { formatDate, pct } from '@/lib/format';
import { useProject } from '@/lib/project-context';
import { signalTitle } from '@/lib/signals';
import { useApi } from '@/lib/use-api';

export default function FraudPage() {
  const { project, canEdit } = useProject();
  const models = useApi<FraudModelsResponse>(`/v1/projects/${project.id}/fraud-models`);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function train() {
    setBusy(true);
    setError(null);
    try {
      await api(`/v1/projects/${project.id}/fraud-models/train`, { method: 'POST' });
      models.reload();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  const d = models.data;
  return (
    <>
      <PageHeader
        title="Fraud models"
        description="Label events as fraud or not fraud, and Trace learns what each fraud type looks like in your traffic. Each type gets a probability on every new event."
        actions={canEdit && <Button variant="outline" onClick={train} disabled={busy}><RefreshCw className={busy ? 'size-3.5 animate-spin' : 'size-3.5'} /> Retrain now</Button>}
      />
      <ErrorBanner message={error ?? models.error} />
      {!d ? (
        <Skeleton className="h-48" />
      ) : d.models.length === 0 && d.untrained.length === 0 ? (
        <div className="grid gap-5">
          <Card>
            <EmptyState
              icon={<Brain className="size-5" />}
              title="No labels yet"
              description="Open an event, pick a fraud type such as account_takeover, and mark it. Once a type has about 30 labels including 5 fraud cases, Trace trains a model for it."
              action={<Button asChild variant="primary"><Link href={`/projects/${project.id}/events?minScore=70`}>Review high-risk events</Link></Button>}
            />
          </Card>
          <div className="grid gap-4 md:grid-cols-3">
            {[
              ['1', 'Label real outcomes', 'Mark events you have confirmed as fraud, and some you are sure were fine. Both matter.'],
              ['2', 'Trace learns your fraud', 'At about 30 labels with 5 fraud cases, a model trains on which signals separated them in your own traffic.'],
              ['3', 'Every event gets a probability', 'New events carry a score per fraud type, with the signals that raised it, next to the usual suspect score.'],
            ].map(([n, t, d]) => (
              <Card key={n} className="p-5">
                <span className="grid size-7 place-items-center rounded-full bg-signal-soft text-xs font-semibold text-signal-ink">{n}</span>
                <h3 className="mt-3 text-sm font-semibold">{t}</h3>
                <p className="mt-1 text-[13px] leading-relaxed text-ink-3">{d}</p>
              </Card>
            ))}
          </div>
        </div>
      ) : (
        <div className="grid gap-4">
          {d.models.map((m) => (
            <Card key={m.label} className="p-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h3 className="font-mono text-[15px] font-semibold">{m.label}</h3>
                  <p className="mt-0.5 text-xs text-ink-3">Trained {formatDate(m.trainedAt)} on {m.n} labelled events ({m.positives} fraud)</p>
                </div>
                <Badge tone={m.cvAuc === null ? 'neutral' : m.cvAuc >= 0.8 ? 'ok' : m.cvAuc >= 0.65 ? 'warn' : 'bad'}>
                  {m.cvAuc === null ? 'Quality unknown' : `AUC ${m.cvAuc.toFixed(2)}`}
                </Badge>
              </div>
              <div className="mt-4 grid gap-2">
                <p className="text-[11px] font-semibold uppercase tracking-wider text-ink-3">What pushes the probability up</p>
                {Object.entries(m.coefficients)
                  .filter(([, c]) => (c ?? 0) > 0)
                  .sort((a, b) => (b[1] ?? 0) - (a[1] ?? 0))
                  .slice(0, 6)
                  .map(([f, c]) => (
                    <div key={f} className="flex items-center gap-3 text-[13px]">
                      <span className="w-44 shrink-0 truncate text-ink-2">{signalTitle(f)}</span>
                      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-3"><div className="h-full rounded-full bg-bad" style={{ width: `${Math.min(100, ((c ?? 0) / 4) * 100)}%` }} /></div>
                      <span className="tnum w-10 text-right text-ink-3">+{(c ?? 0).toFixed(1)}</span>
                    </div>
                  ))}
              </div>
              {m.cvAuc !== null && <p className="mt-4 text-xs text-ink-3">Cross-validated: this model ranks a random fraud event above a random clean one {pct(m.cvAuc, 0)} of the time.</p>}
            </Card>
          ))}
          {d.untrained.length > 0 && (
            <Card>
              <CardHeader title="Not enough labels yet" description="A type needs at least 30 labels with 5 fraud cases before a model is trained." />
              <ul className="px-5 pb-4">
                {d.untrained.map((u) => (
                  <li key={u.label} className="flex items-center justify-between border-b border-line py-2.5 text-[13px] last:border-b-0">
                    <span className="font-mono">{u.label}</span>
                    <span className="text-ink-3">{u.n} labels · {u.positives} fraud</span>
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </div>
      )}
    </>
  );
}
