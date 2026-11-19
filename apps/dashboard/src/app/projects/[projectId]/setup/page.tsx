'use client';

import type { ApiKeyResponse, EventSearchResponse } from '@trace-id/signals/api';
import { Check, KeyRound, Radio, ServerCog, Code2 } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useState, type ReactNode } from 'react';
import { Badge, Button, Card, CopyButton, Field, Input, PageHeader } from '@/components/ui/primitives';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/overlay';
import { cn } from '@/lib/cn';
import { timeAgo } from '@/lib/format';
import { useProject } from '@/lib/project-context';
import { useApi } from '@/lib/use-api';

function Code({ children, label }: { children: string; label?: string }) {
  return (
    <div className="overflow-hidden rounded-xl border border-[#1f232b] bg-[#0d1014]">
      <div className="flex items-center justify-between border-b border-white/5 px-4 py-2">
        <span className="text-[11px] uppercase tracking-wider text-[#6f7782]">{label ?? 'Code'}</span>
        <CopyButton value={children} className="text-[#8a919b] hover:bg-white/10 hover:text-white" />
      </div>
      <pre className="overflow-x-auto p-4 font-mono text-[12px] leading-5 text-[#d7dbe0]">{children}</pre>
    </div>
  );
}

function Step({ n, state, icon, title, summary, children, last }: { n: number; state: 'done' | 'current' | 'todo'; icon: ReactNode; title: string; summary: ReactNode; children: ReactNode; last?: boolean }) {
  return (
    <li className="relative flex gap-5">
      {!last && <span className={cn('absolute bottom-[-20px] left-[19px] top-11 w-px', state === 'done' ? 'bg-ok/50' : 'bg-line')} aria-hidden />}
      <span className={cn('relative z-[1] mt-1 grid size-10 shrink-0 place-items-center rounded-full border-2 text-sm font-semibold', state === 'done' ? 'border-ok bg-ok text-white' : state === 'current' ? 'border-signal bg-signal-soft text-signal-ink' : 'border-line-strong bg-surface text-ink-3')}>
        {state === 'done' ? <Check className="size-[18px]" strokeWidth={3} /> : n}
      </span>
      <Card className={cn('mb-5 min-w-0 flex-1 p-6', state === 'current' && 'ring-2 ring-signal/20')}>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <span className="grid size-9 place-items-center rounded-lg bg-surface-3 text-ink-2 [&>svg]:size-[18px]">{icon}</span>
            <div>
              <h2 className="text-[15px] font-semibold tracking-tight">{title}</h2>
              <div className="mt-0.5 text-xs text-ink-3">{summary}</div>
            </div>
          </div>
        </div>
        <div className="mt-4 grid gap-4 text-[13px] leading-relaxed text-ink-2">{children}</div>
      </Card>
    </li>
  );
}

export default function SetupPage() {
  const { project } = useProject();
  const base = `/projects/${project.id}`;
  const keys = useApi<{ keys: ApiKeyResponse[] }>(`/v1/projects/${project.id}/keys`);
  const events = useApi<EventSearchResponse>(`/v1/projects/${project.id}/events?limit=1`, { intervalMs: 4000 });
  const [endpoint, setEndpoint] = useState('https://id.example.com');
  useEffect(() => setEndpoint(window.location.origin), []);

  const live = (keys.data?.keys ?? []).filter((k) => !k.revokedAt);
  const pub = live.find((k) => k.type === 'public');
  const sec = live.find((k) => k.type === 'secret');
  const last = events.data?.events[0];
  const keysDone = Boolean(pub && sec);
  const done = [keysDone, keysDone, keysDone, Boolean(last)];
  const progress = Math.round(([keysDone, Boolean(last)].filter(Boolean).length / 2) * 100);
  const pk = pub ? `${pub.prefix}…` : 'pk_…';
  const current = !keysDone ? 0 : !last ? 1 : 3;

  return (
    <>
      <PageHeader title="Get started" description="From an empty project to your first scored event. Most teams finish in about ten minutes." />

      <Card className="mb-8 overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-4 p-5">
          <div>
            <p className="text-sm font-semibold">{last ? 'You are live' : keysDone ? 'Keys are ready. Add the SDK next.' : 'Create your keys to begin'}</p>
            <p className="mt-0.5 text-xs text-ink-3">{last ? `Latest event ${timeAgo(last.createdAt)}, scored ${last.suspectScore}.` : 'This page checks for your first event every few seconds.'}</p>
          </div>
          {last ? <Button asChild variant="primary"><Link href={base}>Go to overview</Link></Button> : <Badge tone="signal" className="gap-1.5 py-1"><span className="live-dot" /> Waiting for events</Badge>}
        </div>
        <div className="h-1.5 bg-surface-3"><div className="h-full bg-signal transition-[width] duration-500" style={{ width: `${progress || 8}%` }} /></div>
      </Card>

      <ol className="max-w-4xl">
        <Step n={1} state={done[0] ? 'done' : current === 0 ? 'current' : 'todo'} icon={<KeyRound />} title="Create your keys" summary={done[0] ? 'A public and a secret key exist.' : 'You need one of each.'}>
          <p>A <b className="text-ink">public key</b> goes in your site or app. A <b className="text-ink">secret key</b> stays on your server. Full keys are shown once, when you create them.</p>
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={pub ? 'ok' : 'neutral'}>{pub ? `Public ${pub.prefix}…` : 'No public key'}</Badge>
            <Badge tone={sec ? 'ok' : 'neutral'}>{sec ? `Secret ${sec.prefix}…` : 'No secret key'}</Badge>
            <Button asChild size="sm" variant={keysDone ? 'outline' : 'primary'}><Link href={`${base}/keys`}>{keysDone ? 'Manage keys' : 'Create keys'}</Link></Button>
          </div>
          {pub && pub.allowedOrigins.length === 0 && <p className="rounded-lg bg-warn-soft px-3 py-2 text-warn">Your public key has no allowed origins, so browsers are refused. Add your site on the keys page.</p>}
        </Step>

        <Step n={2} state={done[3] ? 'done' : keysDone ? 'current' : 'todo'} icon={<Code2 />} title="Add the SDK to your site" summary="Pick the way that fits your stack.">
          <Field label="Your Trace server URL" hint="Where the SDK sends requests. Use your public server address in production.">
            <Input value={endpoint} onChange={(e) => setEndpoint(e.target.value)} className="max-w-md font-mono text-xs" />
          </Field>
          <Tabs defaultValue="script">
            <TabsList>
              <TabsTrigger value="script">Script tag</TabsTrigger>
              <TabsTrigger value="npm">JavaScript</TabsTrigger>
              <TabsTrigger value="react">React</TabsTrigger>
            </TabsList>
            <TabsContent value="script" className="mt-3">
              <Code label="HTML">{`<script type="module">
  import { createClient } from '${endpoint}/sdk/sdk.esm.js';

  const trace = createClient({ apiKey: '${pk}', endpoint: '${endpoint}' });
  const result = await trace.get({ linkedId: userId });
  // send result.eventId to your backend with the request
</script>`}</Code>
            </TabsContent>
            <TabsContent value="npm" className="mt-3">
              <Code label="JavaScript">{`npm install @trace-id/sdk-js

import { createClient } from '@trace-id/sdk-js';

const trace = createClient({ apiKey: '${pk}', endpoint: '${endpoint}' });
const result = await trace.get({ linkedId: userId, tags: { action: 'signup' } });`}</Code>
            </TabsContent>
            <TabsContent value="react" className="mt-3">
              <Code label="React">{`npm install @trace-id/sdk-react

<IdentifyProvider apiKey="${pk}" endpoint="${endpoint}">
  <App />
</IdentifyProvider>

const { data, getData } = useVisitorData({ immediate: false });
const result = await getData({ linkedId: user.id });`}</Code>
            </TabsContent>
          </Tabs>
          <p className="text-ink-3">Using another stack? The docs cover Next.js, Vue, Svelte, Angular, mobile and server frameworks.</p>
        </Step>

        <Step n={3} state={done[3] ? 'done' : 'todo'} icon={<ServerCog />} title="Verify the event on your server" summary="Never trust the browser result on its own.">
          <p>Send the <code className="font-mono text-xs">eventId</code> to your backend and check it with your secret key before acting on it.</p>
          <Code label="Node.js">{`npm install @trace-id/sdk-node

import { verifyEvent } from '@trace-id/sdk-node';

const event = await verifyEvent(eventId, {
  secretKey: process.env.TRACE_SECRET_KEY,
  endpoint: '${endpoint}',
});

if (event.suspectScore >= 70) {
  // challenge, review or block
}`}</Code>
          <p className="text-ink-3">Start in shadow mode: log the score for a week before blocking anyone. The <Link href={`${base}/policy`} className="text-signal hover:underline">policy simulator</Link> shows what a threshold would have caught.</p>
        </Step>

        <Step n={4} state={done[3] ? 'done' : current === 3 ? 'current' : 'todo'} icon={<Radio />} title="See your first event" summary={last ? 'Receiving events.' : 'Open your site and trigger identify.'} last>
          {last ? (
            <p className="flex flex-wrap items-center gap-2"><Badge tone="ok">Receiving events</Badge> Latest event {timeAgo(last.createdAt)}, scored {last.suspectScore}. <Link href={`${base}/events/${last.eventId}`} className="text-signal hover:underline">Open it</Link></p>
          ) : (
            <p className="flex items-center gap-2"><span className="live-dot" /> Waiting for your first event. This page checks every few seconds.</p>
          )}
        </Step>
      </ol>
    </>
  );
}
