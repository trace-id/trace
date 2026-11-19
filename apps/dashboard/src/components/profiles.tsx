'use client';

import type { EventResponse } from '@trace-id/signals/api';
import { TriangleAlert } from 'lucide-react';
import type { ReactNode } from 'react';
import { BrowserLogo, DeviceTypeIcon, Flag, OsLogo } from '@/components/logos';
import { Badge, Card, CardHeader, CopyButton } from '@/components/ui/primitives';
import { countryName } from '@/lib/country';
import { cn } from '@/lib/cn';
import { parseUa } from '@/lib/ua-parse';

function Fact({ label, children, mono }: { label: string; children: ReactNode; mono?: boolean }) {
  return (
    <div className="min-w-0 rounded-xl border border-line bg-surface-2/50 px-3.5 py-3">
      <dt className="text-[11px] font-medium uppercase tracking-wider text-ink-3">{label}</dt>
      <dd className={cn('mt-1 break-words text-[13px] font-medium text-ink', mono && 'font-mono text-xs')}>{children}</dd>
    </div>
  );
}

/** Everything known about the device behind an event: what it claims to be, its hardware and its locale. */
export function DeviceProfile({ event }: { event: EventResponse }) {
  const ua = event.attributes.userAgent ?? '';
  const p = parseUa(ua);
  const raw = event.rawAttributes;
  const app = event.app;
  const screen = event.attributes.screenWidth && event.attributes.screenHeight ? `${event.attributes.screenWidth} × ${event.attributes.screenHeight}${raw?.pixelRatio ? ` @${raw.pixelRatio}x` : ''}` : null;

  // A user agent is a claim; flag the cheap contradictions so they are visible at a glance.
  const notes: string[] = [];
  const platform = event.attributes.platform ?? '';
  if (p.os === 'Windows' && platform && !/win/i.test(platform)) notes.push(`The user agent says Windows but the platform reports ${platform}.`);
  if ((p.os === 'macOS' || p.os === 'iOS') && platform && !/mac|iphone|ipad|ios/i.test(platform)) notes.push(`The user agent says ${p.os} but the platform reports ${platform}.`);
  if (p.os === 'Android' && platform && !/linux|android/i.test(platform)) notes.push(`The user agent says Android but the platform reports ${platform}.`);
  if (p.deviceKind === 'Mobile' && (raw?.maxTouchPoints ?? 1) === 0) notes.push('Presents as a phone but reports no touch support.');
  if (p.deviceKind === 'Desktop' && (event.attributes.screenWidth ?? 9999) < 700) notes.push('Presents as a desktop but the screen is phone-sized.');

  return (
    <Card>
      <div className="flex flex-wrap items-center gap-4 p-5">
        <span className="relative grid size-14 shrink-0 place-items-center rounded-2xl bg-surface-3">
          <BrowserLogo name={p.browser} size={34} />
          <span className="absolute -bottom-1.5 -right-1.5 grid size-7 place-items-center rounded-full bg-surface ring-1 ring-line"><OsLogo name={p.os} size={16} /></span>
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-base font-semibold tracking-tight text-ink">{p.browser}{p.browserVersion && <span className="font-normal text-ink-3"> {p.browserVersion.split('.')[0]}</span>}</p>
          <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[13px] text-ink-3">
            <span className="inline-flex items-center gap-1.5"><OsLogo name={p.os} size={13} /> {p.os}{p.osVersion && ` ${p.osVersion}`}</span>
            <span>·</span>
            <span className="inline-flex items-center gap-1.5"><DeviceTypeIcon type={p.deviceKind} size={14} /> {p.deviceKind}{p.model && ` (${p.model})`}</span>
          </p>
        </div>
        {p.deviceKind === 'Bot' && <Badge tone="bad">Automation</Badge>}
      </div>
      {notes.length > 0 && (
        <div className="mx-5 mb-4 grid gap-1.5 rounded-xl bg-warn-soft px-4 py-3 text-[13px] text-warn">
          {notes.map((n) => <p key={n} className="flex items-start gap-2"><TriangleAlert className="mt-0.5 size-4 shrink-0" />{n}</p>)}
        </div>
      )}
      <dl className="grid gap-2.5 px-5 pb-5 sm:grid-cols-2 xl:grid-cols-3">
        <Fact label="Browser">{p.browser}{p.browserVersion ? ` ${p.browserVersion}` : ''}</Fact>
        <Fact label="Engine">{p.engine ?? '-'}</Fact>
        <Fact label="Operating system">{p.os}{p.osVersion ? ` ${p.osVersion}` : ''}</Fact>
        <Fact label="Screen">{screen ?? '-'}</Fact>
        <Fact label="Languages">{event.attributes.languages.join(', ') || '-'}</Fact>
        <Fact label="Time zone">{event.attributes.timezone ?? '-'}</Fact>
        <Fact label="CPU cores">{raw?.hardwareConcurrency ?? '-'}</Fact>
        <Fact label="Memory">{raw?.deviceMemory ? `${raw.deviceMemory} GB` : '-'}</Fact>
        <Fact label="Touch points">{raw?.maxTouchPoints ?? '-'}</Fact>
        <Fact label="Platform" mono>{platform || '-'}</Fact>
        <Fact label="Graphics" mono>{raw?.webglRenderer ?? '-'}</Fact>
        {app && <Fact label="Mobile app" mono>{app.appId ?? '-'}{app.appVersion ? ` ${app.appVersion}` : ''}</Fact>}
      </dl>
      <div className="flex items-start justify-between gap-3 border-t border-line px-5 py-3.5">
        <div className="min-w-0">
          <p className="text-[11px] font-medium uppercase tracking-wider text-ink-3">User agent</p>
          <p className="mt-1 break-all font-mono text-[11.5px] leading-relaxed text-ink-2">{ua || '-'}</p>
        </div>
        {ua && <CopyButton value={ua} />}
      </div>
    </Card>
  );
}

/** Where the request came from, and whether the browser's own time zone agrees. */
export function NetworkProfile({ event }: { event: EventResponse }) {
  const ip = event.ip;
  const loc = ip.location;
  const browserTz = event.attributes.timezone;
  const mismatch = Boolean(loc?.timezone && browserTz && loc.timezone !== browserTz);
  return (
    <Card>
      <CardHeader title="Network" description="Where the request came from" />
      <div className="flex flex-wrap items-center gap-4 px-5 pb-4">
        <span className="grid h-14 w-[74px] shrink-0 place-items-center rounded-xl bg-surface-3"><Flag code={ip.country} className="!h-8 !w-[42px]" /></span>
        <div className="min-w-0 flex-1">
          <p className="text-base font-semibold tracking-tight text-ink">{ip.country ? countryName(ip.country) : 'Unknown location'}</p>
          <p className="mt-0.5 text-[13px] text-ink-3">{[loc?.city, loc?.region].filter(Boolean).join(', ') || 'City not available'}</p>
        </div>
        {mismatch && <Badge tone="warn">Time zone mismatch</Badge>}
      </div>
      <dl className="grid gap-2.5 px-5 pb-5 sm:grid-cols-2 xl:grid-cols-3">
        <Fact label="IP address" mono>{ip.address ?? '-'}</Fact>
        <Fact label="Network (ASN)">{ip.asn ? `AS${ip.asn}` : '-'}</Fact>
        <Fact label="Coordinates" mono>{loc?.latitude != null && loc.longitude != null ? `${loc.latitude}, ${loc.longitude}` : '-'}</Fact>
        <Fact label="Location time zone">{loc?.timezone ?? '-'}</Fact>
        <Fact label="Browser time zone">{browserTz ?? '-'}</Fact>
        <Fact label="Accuracy radius">{loc?.accuracyRadiusKm ? `${loc.accuracyRadiusKm} km` : '-'}</Fact>
      </dl>
      {mismatch && <p className="border-t border-line px-5 py-3.5 text-[13px] text-ink-3">The IP address points to <b className="text-ink-2">{loc?.timezone}</b> but the browser is set to <b className="text-ink-2">{browserTz}</b>. A VPN, proxy or travel can cause this; so can a spoofed time zone.</p>}
    </Card>
  );
}
