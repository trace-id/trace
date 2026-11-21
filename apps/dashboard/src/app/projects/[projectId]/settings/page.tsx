'use client';

import type { AnalyticsResponse, ProjectResponse } from '@trace-id/signals/api';
import { Check, Database, KeyRound, LogOut, Monitor, Moon, Palette, Settings2, Sun, TriangleAlert, UserRound, Webhook } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { KV } from '@/components/domain';
import { Button, Card, CardHeader, ErrorBanner, Field, Id, Input, PageHeader, Segmented } from '@/components/ui/primitives';
import { useToast } from '@/components/ui/toast';
import { api, errorMessage } from '@/lib/api';
import { cn } from '@/lib/cn';
import { formatDate, num } from '@/lib/format';
import { RANGES, useProject } from '@/lib/project-context';
import { useTheme, type ThemeChoice } from '@/lib/theme';
import { useApi } from '@/lib/use-api';

const SECTIONS = [
  { id: 'general', label: 'General', icon: Settings2 },
  { id: 'data', label: 'Data and privacy', icon: Database },
  { id: 'appearance', label: 'Preferences', icon: Palette },
  { id: 'account', label: 'Your account', icon: UserRound },
  { id: 'developer', label: 'Developer', icon: KeyRound },
  { id: 'danger', label: 'Delete project', icon: TriangleAlert },
] as const;

/** Owners only: removes the project and everything in it, after typing its name. */
function DeleteProject({ id, name }: { id: string; name: string }) {
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function remove() {
    setBusy(true);
    setError(null);
    try {
      await api(`/v1/projects/${id}`, { method: 'DELETE', body: { name: typed } });
      window.location.assign('/');
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  }
  return (
    <div className="grid gap-3">
      <p className="text-[13px] leading-relaxed text-ink-2">This permanently deletes the project with its API keys, events, visitors, webhooks, lists, alerts and team. It cannot be undone, and applications using its keys stop working.</p>
      <Field label={`Type ${name} to confirm`}><Input value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" spellCheck={false} /></Field>
      <ErrorBanner message={error} />
      <div><Button variant="danger" disabled={busy || typed.trim() !== name} onClick={() => void remove()}>{busy ? 'Deleting…' : 'Delete this project'}</Button></div>
    </div>
  );
}

const RETENTION = [
  { days: 7, label: '7 days' },
  { days: 30, label: '30 days' },
  { days: 90, label: '90 days' },
  { days: 180, label: '6 months' },
  { days: 365, label: '1 year' },
];

function Section({ id, title, description, children }: { id: string; title: string; description: string; children: ReactNode }) {
  return (
    <section id={id} className="scroll-mt-24">
      <Card>
        <CardHeader title={title} description={description} className="px-6 pt-6" />
        <div className="px-6 pb-6">{children}</div>
      </Card>
    </section>
  );
}

function ThemeCard({ value, label, current, onPick, icon: Icon }: { value: ThemeChoice; label: string; current: ThemeChoice; onPick: (v: ThemeChoice) => void; icon: typeof Sun }) {
  const on = current === value;
  const dark = value === 'dark';
  return (
    <button
      type="button"
      onClick={() => onPick(value)}
      aria-pressed={on}
      className={cn('cursor-pointer rounded-xl border p-2.5 text-left transition-colors', on ? 'border-signal bg-signal-soft/60 ring-2 ring-signal/25' : 'border-line-strong hover:bg-surface-2')}
    >
      <span
        className="mb-2 flex h-16 overflow-hidden rounded-lg border border-line"
        style={{ background: value === 'system' ? 'linear-gradient(90deg,#f8f8f6 50%,#0c0d10 50%)' : dark ? '#0c0d10' : '#f8f8f6' }}
        aria-hidden
      >
        <span className="m-2 w-7 rounded-md" style={{ background: dark ? '#15171d' : '#f4f4f1', border: `1px solid ${dark ? '#23262e' : '#e6e6e1'}` }} />
        <span className="my-2 mr-2 grid flex-1 gap-1">
          <span className="rounded-sm" style={{ background: dark ? '#1c1f26' : '#fff' }} />
          <span className="rounded-sm" style={{ background: '#2b3fd6', opacity: 0.8 }} />
        </span>
      </span>
      <span className="flex items-center justify-between text-[13px] font-medium text-ink">
        <span className="flex items-center gap-1.5"><Icon className="size-3.5 text-ink-3" /> {label}</span>
        {on && <Check className="size-4 text-signal" />}
      </span>
    </button>
  );
}

export default function SettingsPage() {
  const { project, user, canEdit, reloadProject, range, setRange } = useProject();
  const toast = useToast();
  const { choice, setChoice } = useTheme();
  const usage = useApi<AnalyticsResponse>(`/v1/projects/${project.id}/analytics?days=30`);
  const [name, setName] = useState(project.name);
  const [retention, setRetention] = useState(project.retentionDays);
  const [custom, setCustom] = useState(!RETENTION.some((r) => r.days === project.retentionDays));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<'general' | 'data' | null>(null);
  const [dense, setDense] = useState(false);
  const [active, setActive] = useState<string>('general');
  const [origin, setOrigin] = useState('');

  useEffect(() => {
    setOrigin(window.location.origin);
    try {
      setDense(localStorage.getItem('trace-events-dense') === '1');
    } catch {
      /* storage blocked */
    }
    const obs = new IntersectionObserver((entries) => {
      const v = entries.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
      if (v) setActive(v.target.id);
    }, { rootMargin: '-90px 0px -60% 0px' });
    SECTIONS.forEach((s) => {
      const el = document.getElementById(s.id);
      if (el) obs.observe(el);
    });
    return () => obs.disconnect();
  }, []);

  async function save(part: 'general' | 'data', e?: FormEvent) {
    e?.preventDefault();
    setError(null);
    setBusy(part);
    try {
      await api<ProjectResponse>(`/v1/projects/${project.id}`, { method: 'PATCH', body: part === 'general' ? { name } : { retentionDays: retention } });
      reloadProject();
      toast({ tone: 'ok', title: 'Saved', description: part === 'general' ? 'Project name updated.' : `Events are now kept for ${retention} days.` });
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(null);
    }
  }

  async function signOut() {
    await fetch('/api/auth/sign-out', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    window.location.assign('/login');
  }

  const perDay = usage.data ? usage.data.totals.events / 30 : null;
  const estimate = perDay !== null ? Math.round(perDay * retention) : null;
  const shorter = retention < project.retentionDays;

  return (
    <>
      <PageHeader title="Settings" description="Manage this project, how long data is kept, and how the dashboard looks for you." />
      <div className="grid items-start gap-6 lg:grid-cols-[220px_1fr]">
        <nav aria-label="Settings sections" className="sticky top-20 hidden lg:block">
          <ul className="grid gap-0.5">
            {SECTIONS.filter((s) => s.id !== 'danger' || project.role === 'owner').map((s) => (
              <li key={s.id}>
                <a
                  href={`#${s.id}`}
                  onClick={() => setActive(s.id)}
                  className={cn('flex items-center gap-2.5 rounded-[9px] px-3 py-2 text-[13px] font-medium transition-colors', active === s.id ? 'bg-surface text-ink ring-1 ring-line' : 'text-ink-2 hover:bg-surface-3 hover:text-ink')}
                >
                  <s.icon className={cn('size-4', active === s.id ? 'text-signal' : 'text-ink-3')} strokeWidth={1.9} />
                  {s.label}
                </a>
              </li>
            ))}
          </ul>
        </nav>

        <div className="grid max-w-4xl gap-5">
          <ErrorBanner message={error} />

          <Section id="general" title="General" description="How this project appears across the dashboard.">
            <form onSubmit={(e) => save('general', e)} className="grid gap-4">
              <Field label="Project name" hint="Shown in the sidebar and in notifications.">
                <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={200} required disabled={!canEdit} />
              </Field>
              <div className="flex items-center gap-3">
                {canEdit ? <Button type="submit" variant="primary" disabled={busy === 'general' || name === project.name || !name.trim()}>{busy === 'general' ? 'Saving…' : 'Save name'}</Button> : <p className="text-xs text-ink-3">Viewers cannot change settings.</p>}
              </div>
            </form>
            <dl className="mt-5 rounded-xl border border-line px-4">
              <KV label="Project id"><Id value={project.id} /></KV>
              <KV label="Your role"><span className="capitalize">{project.role}</span></KV>
              <KV label="Created">{formatDate(project.createdAt)}</KV>
            </dl>
          </Section>

          <Section id="data" title="Data and privacy" description="Trace deletes events and idle visitors older than the retention period. Keep only what you need to investigate fraud. Your server may cap the maximum.">
            <div className="grid gap-4">
              <div>
                <p className="mb-2 text-xs font-medium text-ink-2">Keep events for</p>
                <div className="flex flex-wrap gap-2">
                  {RETENTION.map((r) => (
                    <button
                      key={r.days}
                      type="button"
                      disabled={!canEdit}
                      onClick={() => { setRetention(r.days); setCustom(false); }}
                      aria-pressed={!custom && retention === r.days}
                      className={cn('cursor-pointer rounded-lg border px-3.5 py-2 text-[13px] font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-60', !custom && retention === r.days ? 'border-signal bg-signal-soft text-signal-ink' : 'border-line-strong text-ink-2 hover:bg-surface-3')}
                    >
                      {r.label}
                    </button>
                  ))}
                  <button type="button" disabled={!canEdit} onClick={() => setCustom(true)} aria-pressed={custom} className={cn('cursor-pointer rounded-lg border px-3.5 py-2 text-[13px] font-medium transition-colors disabled:opacity-60', custom ? 'border-signal bg-signal-soft text-signal-ink' : 'border-line-strong text-ink-2 hover:bg-surface-3')}>Custom</button>
                </div>
                {custom && (
                  <div className="mt-3 flex items-center gap-2">
                    <Input type="number" min={1} max={3650} value={retention} onChange={(e) => setRetention(Math.max(1, Math.min(3650, Number(e.target.value) || 1)))} className="w-28" disabled={!canEdit} />
                    <span className="text-[13px] text-ink-3">days (1 to 3650)</span>
                  </div>
                )}
              </div>
              <div className="grid gap-px overflow-hidden rounded-xl border border-line bg-line text-[13px] sm:grid-cols-3">
                <div className="bg-surface px-4 py-3"><p className="text-xs text-ink-3">Current traffic</p><p className="tnum mt-0.5 font-semibold">{perDay === null ? '-' : `${num(Math.round(perDay))} events a day`}</p></div>
                <div className="bg-surface px-4 py-3"><p className="text-xs text-ink-3">Stored at steady state</p><p className="tnum mt-0.5 font-semibold">{estimate === null ? '-' : `about ${num(estimate)} events`}</p></div>
                <div className="bg-surface px-4 py-3"><p className="text-xs text-ink-3">Also deleted</p><p className="mt-0.5 font-semibold">Visitors idle for {retention} days</p></div>
              </div>
              {shorter && <p className="rounded-xl bg-warn-soft px-4 py-3 text-[13px] text-warn">Shortening retention to {retention} days permanently deletes older events the next time maintenance runs. This cannot be undone.</p>}
              <div>{canEdit && <Button variant="primary" disabled={busy === 'data' || retention === project.retentionDays} onClick={() => save('data')}>{busy === 'data' ? 'Saving…' : 'Save retention'}</Button>}</div>
              <p className="border-t border-line pt-4 text-[13px] leading-relaxed text-ink-3">To delete one person&apos;s data on request, open their visitor page and use <b className="text-ink-2">Delete data</b>. Browser readings are hashed before they leave the page, and raw IP addresses follow the same retention.</p>
            </div>
          </Section>

          <Section id="appearance" title="Preferences" description="Saved in this browser only. They do not affect other people.">
            <div className="grid gap-6">
              <div>
                <p className="mb-2 text-xs font-medium text-ink-2">Theme</p>
                <div className="grid grid-cols-3 gap-3">
                  <ThemeCard value="light" label="Light" current={choice} onPick={setChoice} icon={Sun} />
                  <ThemeCard value="dark" label="Dark" current={choice} onPick={setChoice} icon={Moon} />
                  <ThemeCard value="system" label="System" current={choice} onPick={setChoice} icon={Monitor} />
                </div>
              </div>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div><p className="text-[13px] font-medium text-ink">Default time range</p><p className="text-xs text-ink-3">Used by Overview, Signals and Data quality.</p></div>
                <Segmented value={range} onChange={setRange} options={RANGES.map((r) => ({ value: r.days, label: r.label }))} />
              </div>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div><p className="text-[13px] font-medium text-ink">Table density</p><p className="text-xs text-ink-3">Compact rows fit more events on screen.</p></div>
                <Segmented
                  value={dense ? 'compact' : 'comfortable'}
                  onChange={(v) => {
                    setDense(v === 'compact');
                    try {
                      localStorage.setItem('trace-events-dense', v === 'compact' ? '1' : '0');
                    } catch {
                      /* ignore */
                    }
                  }}
                  options={[{ value: 'comfortable', label: 'Comfortable' }, { value: 'compact', label: 'Compact' }]}
                />
              </div>
              <p className="text-xs text-ink-3">Press <kbd className="rounded border border-line-strong bg-surface-2 px-1 font-mono text-[10px]">?</kbd> anywhere for keyboard shortcuts.</p>
            </div>
          </Section>

          <Section id="account" title="Your account" description="The person signed in on this browser.">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div className="flex items-center gap-3.5">
                <span className="grid size-12 place-items-center rounded-full bg-ink text-lg font-semibold text-bg">{(user.name || user.email).slice(0, 1).toUpperCase()}</span>
                <div><p className="text-sm font-semibold text-ink">{user.name}</p><p className="text-[13px] text-ink-3">{user.email}</p></div>
              </div>
              <Button variant="outline" onClick={signOut}><LogOut className="size-3.5" /> Sign out</Button>
            </div>
          </Section>

          <Section id="developer" title="Developer" description="Values you need when wiring Trace into your own code.">
            <dl className="rounded-xl border border-line px-4">
              <KV label="API base URL"><Id value={origin || '…'} /></KV>
              <KV label="Project id"><Id value={project.id} /></KV>
            </dl>
            <div className="mt-4 flex flex-wrap gap-2">
              <Button asChild variant="outline"><Link href={`/projects/${project.id}/keys`}><KeyRound className="size-3.5" /> API keys</Link></Button>
              <Button asChild variant="outline"><Link href={`/projects/${project.id}/webhooks`}><Webhook className="size-3.5" /> Webhooks</Link></Button>
              <Button asChild variant="outline"><Link href={`/projects/${project.id}/setup`}>Setup guide</Link></Button>
            </div>
          </Section>
          {project.role === 'owner' && (
            <Section id="danger" title="Delete project" description="Only owners can do this.">
              <DeleteProject id={project.id} name={project.name} />
            </Section>
          )}
        </div>
      </div>
    </>
  );
}
