'use client';

import { Ban, Check, Flag, Ghost, KeyRound, MapPin, Network, Repeat, Route, Search, Server, ShieldAlert, Sparkles, type LucideIcon } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Tip } from '@/components/ui/overlay';
import { Input } from '@/components/ui/primitives';
import { cn } from '@/lib/cn';
import type { Capability, ProviderInfo } from '@/lib/ip-intel-types';

export const CAP: Record<Capability, { label: string; icon: LucideIcon; hint: string }> = {
  country: { label: 'Country', icon: Flag, hint: 'Which country the address is in' },
  asn: { label: 'Network', icon: Network, hint: 'The network (ASN) and who runs it' },
  location: { label: 'City', icon: MapPin, hint: 'City-level location' },
  vpn: { label: 'VPN', icon: ShieldAlert, hint: 'Known VPN exit addresses' },
  proxy: { label: 'Proxy', icon: Route, hint: 'Open, residential and other proxies' },
  tor: { label: 'Tor', icon: Ghost, hint: 'Tor exit nodes' },
  datacenter: { label: 'Datacenter', icon: Server, hint: 'Hosting and cloud ranges, where bots usually run' },
  blocklisted: { label: 'Abuse', icon: Ban, hint: 'Addresses reported for abuse or attacks' },
  relay: { label: 'Relay', icon: Repeat, hint: 'Privacy relays such as iCloud Private Relay' },
};

/** What a person usually wants to catch. Choosing some ranks the providers by how much of it they cover. */
const GOALS: Capability[] = ['vpn', 'proxy', 'tor', 'datacenter', 'blocklisted', 'location'];

const PALETTE = ['#2b3fd6', '#0f766e', '#b45309', '#7c3aed', '#be123c', '#0369a1', '#4d7c0f', '#a21caf'];
const tint = (id: string): string => PALETTE[[...id].reduce((n, c) => n + c.charCodeAt(0), 0) % PALETTE.length] as string;
const initials = (label: string): string => {
  const words = label.replace(/[^\p{L}\p{N} .]/gu, '').split(/[ .]+/).filter(Boolean);
  return ((words[0]?.[0] ?? '?') + (words[1]?.[0] ?? words[0]?.[1] ?? '')).toUpperCase();
};

const needsKey = (p: ProviderInfo): boolean => p.remote && p.fields.some((f) => f.scope === 'key' && f.required);
const hasFreePlan = (p: ProviderInfo): boolean => !p.remote || /free|trial|credits/i.test(p.freeNote ?? '');
/** Some of what it detects needs a paid plan or add-on, going by its own description. */
const planGated = (p: ProviderInfo): boolean => p.remote && /(^|[^a-z])(needs?|paid|add-on|business plan|security plan)([^a-z]|$)/i.test(`${p.summary} ${p.freeNote ?? ''}`);
const freeWord = (p: ProviderInfo): string => (!p.remote ? 'Free' : /credits|trial/i.test(p.freeNote ?? '') && !/free (plan|tier|key|monthly)/i.test(p.freeNote ?? '') ? 'Free credits' : 'Free plan');

export function ProviderMark({ p, size = 40 }: { p: ProviderInfo; size?: number }) {
  const c = tint(p.id);
  return (
    <span className="grid shrink-0 place-items-center rounded-xl font-semibold tracking-tight" style={{ width: size, height: size, background: `${c}1a`, color: c, fontSize: size * 0.36 }} aria-hidden>
      {initials(p.label)}
    </span>
  );
}

/**
 * Choose a provider: say what you want to catch, and the list reorders by how much of it each one covers. Tiles show
 * what a provider detects as icons (the ones you asked for lit up), whether it has a free plan or needs a key, and
 * which ones you have already added.
 */
export function ProviderPicker({ registry, added, onPick }: { registry: ProviderInfo[]; added: string[]; onPick: (p: ProviderInfo) => void }) {
  const [goals, setGoals] = useState<Set<Capability>>(new Set());
  const [query, setQuery] = useState('');
  const [freeOnly, setFreeOnly] = useState(false);

  const ranked = useMemo(() => {
    const q = query.trim().toLowerCase();
    return registry
      .map((p) => ({ p, hits: [...goals].filter((g) => p.provides.includes(g)).length }))
      .filter(({ p }) => (!q || `${p.label} ${p.summary}`.toLowerCase().includes(q)) && (!freeOnly || hasFreePlan(p)))
      .sort((a, b) => b.hits - a.hits || Number(planGated(a.p)) - Number(planGated(b.p)) || Number(hasFreePlan(b.p)) - Number(hasFreePlan(a.p)) || a.p.label.localeCompare(b.p.label));
  }, [registry, goals, query, freeOnly]);
  const best = goals.size > 0 ? ranked[0] : undefined;

  const toggle = (g: Capability) => setGoals((cur) => { const n = new Set(cur); if (n.has(g)) n.delete(g); else n.add(g); return n; });

  return (
    <div className="grid gap-4">
      <div className="grid gap-2.5">
        <p className="text-xs font-semibold uppercase tracking-wider text-ink-3">What do you want to catch?</p>
        <div className="flex flex-wrap gap-1.5">
          {GOALS.map((g) => {
            const on = goals.has(g);
            const Icon = CAP[g].icon;
            return (
              <Tip key={g} label={CAP[g].hint}>
                <button type="button" aria-pressed={on} onClick={() => toggle(g)} className={cn('inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-full border px-3 text-[13px] font-medium transition-colors', on ? 'border-signal bg-signal-soft text-signal-ink' : 'border-line-strong text-ink-2 hover:bg-surface-2')}>
                  {on ? <Check className="size-3.5" /> : <Icon className="size-3.5" />} {CAP[g].label}
                </button>
              </Tip>
            );
          })}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-[200px] flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-ink-3" />
            <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search providers" className="pl-9" aria-label="Search providers" />
          </div>
          <label className="inline-flex h-9 cursor-pointer items-center gap-2 rounded-[10px] border border-line-strong px-3 text-[13px] text-ink-2 hover:bg-surface-2">
            <input type="checkbox" className="size-3.5 accent-[var(--signal)]" checked={freeOnly} onChange={(e) => setFreeOnly(e.target.checked)} /> Has a free plan
          </label>
        </div>
      </div>

      <ul className="grid max-h-[52vh] gap-2.5 overflow-y-auto pr-1 sm:grid-cols-2">
        {ranked.map(({ p, hits }) => {
          const isAdded = added.includes(p.id);
          const isBest = best?.p.id === p.id && hits > 0;
          return (
            <li key={p.id}>
              <button
                type="button"
                onClick={() => onPick(p)}
                className={cn('group flex h-full w-full cursor-pointer flex-col rounded-2xl border p-3.5 text-left transition-all hover:-translate-y-px hover:border-signal hover:shadow-card', isBest ? 'border-signal/60 bg-signal-soft/40' : 'border-line bg-surface', goals.size > 0 && hits === 0 && 'opacity-60')}
              >
                <span className="flex items-start gap-3">
                  <ProviderMark p={p} />
                  <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      <span className="text-[13.5px] font-semibold text-ink">{p.label}</span>
                      {isBest && <span className="inline-flex items-center gap-1 rounded-full bg-signal px-2 py-0.5 text-[10.5px] font-semibold text-white"><Sparkles className="size-3" /> Best match</span>}
                      {isAdded && <span className="rounded-full bg-ok-soft px-2 py-0.5 text-[10.5px] font-semibold text-ok">Added</span>}
                    </span>
                    <span className="mt-0.5 line-clamp-2 block text-xs leading-snug text-ink-3">{p.summary}</span>
                  </span>
                </span>

                <span className="mt-3 flex flex-wrap items-center gap-1">
                  {p.provides.map((c) => {
                    const Icon = CAP[c].icon;
                    const lit = goals.has(c);
                    return (
                      <Tip key={c} label={`${CAP[c].label}: ${CAP[c].hint}`}>
                        <span className={cn('inline-flex h-6 items-center gap-1 rounded-md px-1.5 text-[11px] font-medium', lit ? 'bg-signal text-white' : 'bg-surface-2 text-ink-2')}>
                          <Icon className="size-3" /> {CAP[c].label}
                        </span>
                      </Tip>
                    );
                  })}
                </span>

                <span className="mt-auto flex flex-wrap items-center justify-between gap-2 pt-3 text-[11.5px] text-ink-3">
                  <span className="flex flex-wrap items-center gap-1.5">
                    {hasFreePlan(p) && <span className="rounded-full bg-ok-soft px-2 py-0.5 font-semibold text-ok">{freeWord(p)}</span>}
                    {needsKey(p) ? <span className="inline-flex items-center gap-1"><KeyRound className="size-3" /> API key</span> : <span>No key needed</span>}
                  </span>
                  {goals.size > 0 && <span className={cn('font-medium', hits === goals.size ? 'text-ok' : 'text-ink-3')}>Covers {hits} of {goals.size}</span>}
                </span>
                {p.freeNote && <span className="mt-1.5 block text-[11.5px] leading-snug text-ink-3">{p.freeNote}</span>}
                {planGated(p) && <span className="mt-1 block text-[11.5px] leading-snug text-warn">Some detections need a paid plan.</span>}
              </button>
            </li>
          );
        })}
        {ranked.length === 0 && <li className="col-span-full rounded-xl border border-dashed border-line-strong px-4 py-8 text-center text-[13px] text-ink-3">No provider matches. Clear a filter to see more.</li>}
      </ul>
    </div>
  );
}
