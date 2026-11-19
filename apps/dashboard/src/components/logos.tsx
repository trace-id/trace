import brave from '@browser-logos/brave/brave.svg';
import chrome from '@browser-logos/chrome/chrome.svg';
import chromium from '@browser-logos/chromium/chromium.svg';
import edge from '@browser-logos/edge/edge.svg';
import firefox from '@browser-logos/firefox/firefox.svg';
import opera from '@browser-logos/opera/opera.svg';
import safari from '@browser-logos/safari/safari.svg';
import samsung from '@browser-logos/samsung-internet/samsung-internet.svg';
import vivaldi from '@browser-logos/vivaldi/vivaldi.svg';
import { AppWindow, Bot, Globe, Laptop, LayoutGrid, Monitor, Smartphone, Tablet } from 'lucide-react';
import { siAndroid, siApple, siGooglechrome, siLinux } from 'simple-icons';
import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';
import { countryName } from '@/lib/country';

/* Browser logos come from the alrra/browser-logos project, OS marks from simple-icons (CC0), flags from flag-icons (MIT).
   They only show which browser, system or country Trace detected. Trademarks belong to their owners. */

type Img = { src: string } | string;
const src = (i: Img) => (typeof i === 'string' ? i : i.src);

function pick(name: string): { img: Img; alt: string } | null {
  const n = name.toLowerCase();
  if (n.includes('edge')) return { img: edge, alt: 'Edge' };
  if (n.includes('samsung')) return { img: samsung, alt: 'Samsung Internet' };
  if (n.includes('opera')) return { img: opera, alt: 'Opera' };
  if (n.includes('brave')) return { img: brave, alt: 'Brave' };
  if (n.includes('vivaldi')) return { img: vivaldi, alt: 'Vivaldi' };
  if (n.includes('firefox')) return { img: firefox, alt: 'Firefox' };
  if (n.includes('safari')) return { img: safari, alt: 'Safari' };
  if (n.includes('chromium')) return { img: chromium, alt: 'Chromium' };
  if (n.includes('chrome')) return { img: chrome, alt: 'Chrome' };
  return null;
}

export function BrowserLogo({ name, size = 18 }: { name: string; size?: number }) {
  if (name.toLowerCase().includes('headless')) return <Bot size={size} strokeWidth={1.75} className="shrink-0 text-bad" aria-hidden="true" />;
  const p = pick(name);
  if (!p) return <AppWindow size={size} strokeWidth={1.75} className="shrink-0 text-ink-3" aria-hidden="true" />;
  return <img src={src(p.img)} width={size} height={size} alt="" aria-hidden="true" draggable={false} className="block shrink-0" />;
}

type SimpleIcon = { path: string; hex: string };
function Simple({ icon, size, mono }: { icon: SimpleIcon; size: number; mono?: boolean }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" className={cn('shrink-0', mono && 'text-ink')} fill={mono ? 'currentColor' : `#${icon.hex}`}>
      <path d={icon.path} />
    </svg>
  );
}

function Windows({ size }: { size: number }) {
  // A plain four-pane grid in Windows blue: a generic glyph, not a redrawn trademark.
  return <LayoutGrid size={size} strokeWidth={2.4} className="shrink-0 text-[#0078d4]" aria-hidden="true" />;
}

export function OsLogo({ name, size = 16 }: { name: string; size?: number }) {
  const n = name.toLowerCase();
  if (n.includes('mac') || n.includes('ios')) return <Simple icon={siApple} size={size} mono />;
  if (n.includes('android')) return <Simple icon={siAndroid} size={size} />;
  if (n.includes('linux')) return <Simple icon={siLinux} size={size} mono />;
  if (n.includes('chromeos')) return <Simple icon={siGooglechrome} size={size} />;
  if (n.includes('windows')) return <Windows size={size} />;
  return <Monitor size={size} strokeWidth={1.75} className="shrink-0 text-ink-3" aria-hidden="true" />;
}

export function DeviceTypeIcon({ type, size = 16 }: { type: string; size?: number }) {
  const t = type.toLowerCase();
  const cls = 'shrink-0 text-ink-2';
  if (t === 'mobile') return <Smartphone size={size} strokeWidth={1.75} className={cls} aria-hidden="true" />;
  if (t === 'tablet') return <Tablet size={size} strokeWidth={1.75} className={cls} aria-hidden="true" />;
  if (t === 'bot') return <Bot size={size} strokeWidth={1.75} className="shrink-0 text-bad" aria-hidden="true" />;
  if (t === 'desktop') return <Laptop size={size} strokeWidth={1.75} className={cls} aria-hidden="true" />;
  return <Monitor size={size} strokeWidth={1.75} className="shrink-0 text-ink-3" aria-hidden="true" />;
}

/** A real flag image (SVG, fetched only when shown). Unknown codes get a globe. */
export function Flag({ code, className }: { code: string | null | undefined; className?: string }) {
  if (!code || !/^[A-Za-z]{2}$/.test(code)) return <Globe size={14} strokeWidth={1.75} className={cn('shrink-0 text-ink-3', className)} aria-hidden="true" />;
  return (
    <span
      role="img"
      aria-label={countryName(code)}
      title={countryName(code)}
      className={cn(`fi fi-${code.toLowerCase()} shrink-0 rounded-[3px] shadow-[0_0_0_1px_rgb(0_0_0/0.08)]`, className)}
      style={{ width: 20, height: 15, backgroundSize: 'cover' }}
    />
  );
}

/** Browser logo with its name. */
export function BrowserLabel({ name, size = 18, className }: { name: string; size?: number; className?: string }) {
  return (
    <span className={cn('inline-flex items-center gap-2', className)}>
      <BrowserLogo name={name} size={size} />
      <span>{name}</span>
    </span>
  );
}

export function OsLabel({ name, size = 16, className }: { name: string; size?: number; className?: string }) {
  return (
    <span className={cn('inline-flex items-center gap-2', className)}>
      <OsLogo name={name} size={size} />
      <span>{name}</span>
    </span>
  );
}

export function TypeLabel({ name, className }: { name: string; className?: string }) {
  return (
    <span className={cn('inline-flex items-center gap-2', className)}>
      <DeviceTypeIcon type={name} />
      <span>{name}</span>
    </span>
  );
}

/** Browser + OS (+ device type) as one compact cell. */
export function DeviceCell({ browser, os, deviceType, size = 18 }: { browser?: string | null; os?: string | null; deviceType?: string | null; size?: number }): ReactNode {
  if (!browser && !os) return <span className="text-ink-3">Unknown</span>;
  return (
    <span className="inline-flex items-center gap-2 text-ink-2">
      <span className="relative inline-flex shrink-0">
        <BrowserLogo name={browser ?? ''} size={size} />
        {os && <span className="absolute -bottom-1 -right-1.5 grid place-items-center rounded-full bg-surface p-[1px] ring-1 ring-line"><OsLogo name={os} size={Math.round(size * 0.55)} /></span>}
      </span>
      <span className="leading-tight">
        <span className="block text-[13px] text-ink">{browser ?? 'Unknown'}</span>
        <span className="block text-[11px] text-ink-3">{[os, deviceType && deviceType !== 'Desktop' ? deviceType : null].filter(Boolean).join(' · ')}</span>
      </span>
    </span>
  );
}
