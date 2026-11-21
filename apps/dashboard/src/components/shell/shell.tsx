'use client';

import {
  Activity,
  Check,
  ChevronsUpDown,
  CornerDownLeft,
  Fingerprint,
  KeyRound,
  LayoutDashboard,
  LogOut,
  Menu,
  Monitor,
  Moon,
  Plus,
  Radar,
  Search,
  Settings,
  ShieldAlert,
  Sun,
  Users,
  Webhook,
  Plug,
  Bell,
  ListChecks,
  UsersRound,
  Brain,
  Rocket,
  Network,
  SlidersHorizontal,
  Gauge,
  PanelLeftClose,
  PanelLeftOpen,
  type LucideIcon,
} from 'lucide-react';
import { Command } from 'cmdk';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState, type ReactNode } from 'react';
import { Dropdown, DropdownContent, DropdownItem, DropdownLabel, DropdownSeparator, DropdownTrigger } from '@/components/ui/overlay';
import { Kbd } from '@/components/ui/primitives';
import { cn } from '@/lib/cn';
import { useProject } from '@/lib/project-context';
import { useTheme } from '@/lib/theme';

/* ---------- Brand ---------- */

/** The Trace mark: a T drawn as a device graph. Two browsers meet at one bar; the stem lands on the same node. */
export function GraphMark({ size = 20, color = 'currentColor' }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" fill={color}>
      <circle cx="4" cy="5" r="3" />
      <circle cx="20" cy="5" r="3" />
      <rect x="4" y="3.75" width="16" height="2.5" />
      <rect x="10.75" y="5" width="2.5" height="7.5" />
      <circle cx="12" cy="19" r="3" />
    </svg>
  );
}

/** App icon: the mark in lime on an ink disc, as on the website. */
export function Mark({ size = 28 }: { size?: number }) {
  return (
    <span className="grid shrink-0 place-items-center rounded-full bg-[#111318]" style={{ width: size, height: size }}>
      <GraphMark size={Math.round(size * 0.58)} color="#e2f04f" />
    </span>
  );
}

export function Wordmark({ className }: { className?: string }) {
  return (
    <span className={cn('flex items-center gap-2.5', className)}>
      <Mark />
      <b className="text-[17px] font-bold tracking-tight text-ink">trace</b>
    </span>
  );
}

/* ---------- Navigation ---------- */

interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  /** Matches subpaths too. */
  prefix?: boolean;
}

function groups(base: string): { title: string; items: NavItem[] }[] {
  return [
    {
      title: 'Monitor',
      items: [
        { href: base, label: 'Overview', icon: LayoutDashboard },
        { href: `${base}/events`, label: 'Events', icon: Activity, prefix: true },
        { href: `${base}/visitors`, label: 'Visitors', icon: Fingerprint, prefix: true },
        { href: `${base}/accounts`, label: 'Accounts', icon: Users, prefix: true },
        { href: `${base}/investigate`, label: 'Investigate', icon: Network },
        { href: `${base}/alerts`, label: 'Alerts', icon: Bell },
      ],
    },
    {
      title: 'Intelligence',
      items: [
        { href: `${base}/signals`, label: 'Signals', icon: Radar },
        { href: `${base}/policy`, label: 'Policy simulator', icon: SlidersHorizontal },
        { href: `${base}/fraud`, label: 'Fraud models', icon: Brain },
        { href: `${base}/lists`, label: 'Allow and block lists', icon: ListChecks },
        { href: `${base}/quality`, label: 'Data quality', icon: Gauge },
      ],
    },
    {
      title: 'Integrate',
      items: [
        { href: `${base}/setup`, label: 'Get started', icon: Rocket },
        { href: `${base}/keys`, label: 'API keys', icon: KeyRound },
        { href: `${base}/webhooks`, label: 'Webhooks', icon: Webhook },
        { href: `${base}/integrations`, label: 'Integrations', icon: Plug },
      ],
    },
    {
      title: 'Project',
      items: [
        { href: `${base}/team`, label: 'Team', icon: UsersRound },
        { href: `${base}/settings`, label: 'Settings', icon: Settings },
      ],
    },
  ];
}

function NavList({ onNavigate, collapsed }: { onNavigate?: () => void; collapsed?: boolean }) {
  const { project } = useProject();
  const pathname = usePathname();
  const base = `/projects/${project.id}`;
  return (
    <nav className={cn('grid gap-5', collapsed ? 'px-2' : 'px-3')}>
      {groups(base).map((g) => (
        <div key={g.title}>
          {collapsed ? <div className="mx-3 mb-1 h-px bg-line" /> : <div className="mb-1 px-2.5 text-[10.5px] font-semibold uppercase tracking-wider text-ink-3">{g.title}</div>}
          <ul className="grid gap-0.5">
            {g.items.map((item) => {
              const active = item.href === base ? pathname === base : item.prefix ? pathname.startsWith(item.href) : pathname === item.href;
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    onClick={onNavigate}
                    aria-current={active ? 'page' : undefined}
                    title={collapsed ? item.label : undefined}
                    className={cn(
                      'group flex items-center gap-2.5 rounded-[9px] px-2.5 py-[7px] text-[13px] font-medium transition-colors',
                      collapsed && 'justify-center px-0',
                      active ? 'bg-surface text-ink shadow-card ring-1 ring-line' : 'text-ink-2 hover:bg-surface-3 hover:text-ink',
                    )}
                  >
                    <item.icon className={cn('size-4 shrink-0', active ? 'text-signal' : 'text-ink-3 group-hover:text-ink-2')} strokeWidth={1.9} />
                    {!collapsed && item.label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );
}

function ProjectSwitcher() {
  const { project, projects } = useProject();
  const router = useRouter();
  return (
    <Dropdown>
      <DropdownTrigger asChild>
        <button className="mx-3 flex w-[calc(100%-24px)] cursor-pointer items-center gap-2.5 rounded-xl border border-line-strong bg-surface px-2.5 py-2 text-left shadow-card transition-colors hover:bg-surface-2">
          <span className="grid size-7 shrink-0 place-items-center rounded-lg bg-signal-soft text-xs font-semibold text-signal-ink">{project.name.slice(0, 1).toUpperCase()}</span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[13px] font-medium text-ink">{project.name}</span>
            <span className="block text-[11px] capitalize text-ink-3">{project.role}</span>
          </span>
          <ChevronsUpDown className="size-3.5 shrink-0 text-ink-3" />
        </button>
      </DropdownTrigger>
      <DropdownContent align="start" className="w-64">
        <DropdownLabel>Projects</DropdownLabel>
        {projects.map((p) => (
          <DropdownItem key={p.id} onSelect={() => router.push(`/projects/${p.id}`)}>
            <span className="grid size-5 place-items-center rounded-md bg-surface-3 text-[10px] font-semibold">{p.name.slice(0, 1).toUpperCase()}</span>
            <span className="flex-1 truncate">{p.name}</span>
            {p.id === project.id && <Check className="size-3.5 text-signal" />}
          </DropdownItem>
        ))}
        <DropdownSeparator />
        <DropdownItem onSelect={() => router.push('/projects/new')}>
          <Plus className="size-4 text-ink-3" /> New project
        </DropdownItem>
      </DropdownContent>
    </Dropdown>
  );
}

export function Sidebar() {
  const [collapsed, setCollapsed] = useState(false);
  useEffect(() => {
    try {
      setCollapsed(localStorage.getItem('trace-sidebar') === '1');
    } catch {
      /* storage blocked */
    }
  }, []);
  function toggle() {
    setCollapsed((c) => {
      try {
        localStorage.setItem('trace-sidebar', c ? '0' : '1');
      } catch {
        /* ignore */
      }
      return !c;
    });
  }
  return (
    <aside
      className={cn(
        'sticky top-0 hidden h-screen shrink-0 flex-col gap-5 overflow-y-auto overflow-x-hidden border-r border-line bg-surface-2 py-4 transition-[width] duration-200 lg:flex',
        collapsed ? 'w-[68px]' : 'w-[248px]',
      )}
    >
      <Link href="/" className={cn(collapsed ? 'mx-auto' : 'px-5')} aria-label="Trace home">
        {collapsed ? <Mark /> : <Wordmark />}
      </Link>
      {!collapsed && <ProjectSwitcher />}
      <NavList collapsed={collapsed} />
      <button
        onClick={toggle}
        aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        className={cn('mt-auto flex cursor-pointer items-center gap-2 text-[12px] text-ink-3 hover:text-ink', collapsed ? 'mx-auto' : 'px-5 pb-1')}
      >
        {collapsed ? <PanelLeftOpen className="size-4" /> : <><PanelLeftClose className="size-4" /> Collapse</>}
      </button>
    </aside>
  );
}

/* ---------- Top bar ---------- */

function ThemeMenu() {
  const { choice, setChoice } = useTheme();
  const Icon = choice === 'dark' ? Moon : choice === 'light' ? Sun : Monitor;
  return (
    <Dropdown>
      <DropdownTrigger asChild>
        <button aria-label="Theme" className="grid size-9 cursor-pointer place-items-center rounded-[10px] text-ink-2 transition-colors hover:bg-surface-3 hover:text-ink">
          <Icon className="size-[17px]" />
        </button>
      </DropdownTrigger>
      <DropdownContent className="w-40">
        {(
          [
            ['light', 'Light', Sun],
            ['dark', 'Dark', Moon],
            ['system', 'System', Monitor],
          ] as const
        ).map(([value, label, I]) => (
          <DropdownItem key={value} onSelect={() => setChoice(value)}>
            <I className="size-4 text-ink-3" /> {label}
            {choice === value && <Check className="ml-auto size-3.5 text-signal" />}
          </DropdownItem>
        ))}
      </DropdownContent>
    </Dropdown>
  );
}

function UserMenu() {
  const { user } = useProject();
  async function signOut() {
    await fetch('/api/auth/sign-out', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    window.location.assign('/login');
  }
  return (
    <Dropdown>
      <DropdownTrigger asChild>
        <button aria-label="Account" className="grid size-9 cursor-pointer place-items-center rounded-full bg-ink text-[13px] font-semibold text-bg">
          {(user.name || user.email).slice(0, 1).toUpperCase()}
        </button>
      </DropdownTrigger>
      <DropdownContent className="w-60">
        <div className="px-2.5 py-2">
          <p className="truncate text-[13px] font-medium text-ink">{user.name}</p>
          <p className="truncate text-xs text-ink-3">{user.email}</p>
        </div>
        <DropdownSeparator />
        <DropdownItem onSelect={signOut} danger>
          <LogOut className="size-4" /> Sign out
        </DropdownItem>
      </DropdownContent>
    </Dropdown>
  );
}

const SECTION: Record<string, string> = {
  events: 'Events', visitors: 'Visitors', accounts: 'Accounts', investigate: 'Investigate', signals: 'Signals', policy: 'Policy simulator',
  fraud: 'Fraud models', quality: 'Data quality', setup: 'Get started', keys: 'API keys', webhooks: 'Webhooks', integrations: 'Integrations', alerts: 'Alerts', lists: 'Allow and block lists', team: 'Team', settings: 'Settings',
};

function Crumbs() {
  const { project } = useProject();
  const pathname = usePathname();
  const seg = pathname.split('/')[3];
  const label = seg ? (SECTION[seg] ?? seg) : 'Overview';
  return (
    <div className="hidden min-w-0 items-center gap-2 text-[13px] md:flex">
      <span className="truncate text-ink-3">{project.name}</span>
      <span className="text-ink-3/60">/</span>
      <span className="truncate font-medium text-ink">{label}</span>
    </div>
  );
}

export function Topbar({ onOpenPalette }: { onOpenPalette: () => void }) {
  const [menu, setMenu] = useState(false);
  return (
    <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-line bg-bg/85 px-4 backdrop-blur-md sm:px-6">
      <DialogPrimitive.Root open={menu} onOpenChange={setMenu}>
        <DialogPrimitive.Trigger asChild>
          <button aria-label="Menu" className="grid size-9 cursor-pointer place-items-center rounded-[10px] text-ink-2 hover:bg-surface-3 lg:hidden">
            <Menu className="size-5" />
          </button>
        </DialogPrimitive.Trigger>
        <DialogPrimitive.Portal>
          <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/40 [animation:fade-in_.15s_ease-out]" />
          <DialogPrimitive.Content className="fixed inset-y-0 left-0 z-50 flex w-[272px] flex-col gap-5 overflow-y-auto bg-surface-2 py-4 shadow-pop [animation:slide-in_.2s_ease-out]">
            <DialogPrimitive.Title className="sr-only">Navigation</DialogPrimitive.Title>
            <DialogPrimitive.Description className="sr-only">Site navigation</DialogPrimitive.Description>
            <div className="px-5">
              <Wordmark />
            </div>
            <ProjectSwitcher />
            <NavList onNavigate={() => setMenu(false)} />
          </DialogPrimitive.Content>
        </DialogPrimitive.Portal>
      </DialogPrimitive.Root>
      <Crumbs />
      <button
        onClick={onOpenPalette}
        className="ml-auto flex h-9 w-full max-w-sm cursor-pointer items-center gap-2.5 rounded-[10px] border border-line-strong bg-surface px-3 text-[13px] text-ink-3 shadow-card transition-colors hover:border-ink-3/50"
      >
        <Search className="size-4" />
        <span className="flex-1 text-left">Search visitors, events, pages…</span>
        <span className="hidden items-center gap-1 sm:flex">
          <Kbd>⌘</Kbd>
          <Kbd>K</Kbd>
        </span>
      </button>
      <div className="flex items-center gap-1">
        <ThemeMenu />
        <UserMenu />
      </div>
    </header>
  );
}

/* ---------- Command palette ---------- */

const ID20 = /^[0-9A-Za-z]{20}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function CommandPalette({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const { project, projects } = useProject();
  const router = useRouter();
  const { setChoice } = useTheme();
  const [query, setQuery] = useState('');
  const base = `/projects/${project.id}`;

  useEffect(() => {
    if (!open) setQuery('');
  }, [open]);

  function go(path: string) {
    onOpenChange(false);
    router.push(path);
  }

  const q = query.trim();
  const pages: [string, string, LucideIcon][] = [
    ['Overview', base, LayoutDashboard],
    ['Events', `${base}/events`, Activity],
    ['Visitors', `${base}/visitors`, Fingerprint],
    ['Accounts', `${base}/accounts`, Users],
    ['Investigate rings and graph', `${base}/investigate`, Network],
    ['Policy simulator', `${base}/policy`, SlidersHorizontal],
    ['Data quality', `${base}/quality`, Gauge],
    ['Signals', `${base}/signals`, Radar],
    ['Fraud models', `${base}/fraud`, Brain],
    ['Get started', `${base}/setup`, Rocket],
    ['API keys', `${base}/keys`, KeyRound],
    ['Webhooks', `${base}/webhooks`, Webhook],
    ['Integrations and IP providers', `${base}/integrations`, Plug],
    ['Alerts', `${base}/alerts`, Bell],
    ['Allow and block lists', `${base}/lists`, ListChecks],
    ['Team and invitations', `${base}/team`, UsersRound],
    ['Settings', `${base}/settings`, Settings],
  ];

  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-[70] bg-black/40 backdrop-blur-[2px] [animation:fade-in_.12s_ease-out]" />
        <DialogPrimitive.Content className="fixed left-1/2 top-[14vh] z-[70] w-[calc(100vw-32px)] max-w-xl -translate-x-1/2 overflow-hidden rounded-2xl border border-line bg-surface shadow-pop [animation:pop-in_.15s_ease-out]">
          <DialogPrimitive.Title className="sr-only">Command palette</DialogPrimitive.Title>
          <DialogPrimitive.Description className="sr-only">Search and jump to anything</DialogPrimitive.Description>
          <Command label="Command palette" shouldFilter loop>
            <div className="flex items-center gap-2.5 border-b border-line px-4">
              <Search className="size-4 text-ink-3" />
              <Command.Input value={query} onValueChange={setQuery} placeholder="Paste a visitor or event id, or jump to a page…" className="h-12 flex-1 bg-transparent text-sm text-ink outline-none placeholder:text-ink-3" />
              <Kbd>esc</Kbd>
            </div>
            <Command.List className="max-h-[360px] overflow-y-auto p-2">
              <Command.Empty className="px-3 py-8 text-center text-[13px] text-ink-3">Nothing matches “{q}”.</Command.Empty>
              {ID20.test(q) && (
                <Command.Group heading="Open" className="text-[11px] [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-wide [&_[cmdk-group-heading]]:text-ink-3">
                  <Item value={`visitor ${q}`} onSelect={() => go(`${base}/visitors/${q}`)} icon={Fingerprint}>
                    Visitor <span className="font-mono text-xs">{q}</span>
                  </Item>
                </Command.Group>
              )}
              {UUID.test(q) && (
                <Command.Group heading="Open">
                  <Item value={`event ${q}`} onSelect={() => go(`${base}/events/${q}`)} icon={Activity}>
                    Event <span className="font-mono text-xs">{q}</span>
                  </Item>
                </Command.Group>
              )}
              {q.length > 1 && !ID20.test(q) && !UUID.test(q) && (
                <Command.Group heading="Search">
                  <Item value={`account ${q}`} forceMount onSelect={() => go(`${base}/accounts?q=${encodeURIComponent(q)}`)} icon={Users}>
                    Accounts starting with “{q}”
                  </Item>
                  <Item value={`ip ${q}`} forceMount onSelect={() => go(`${base}/events?ip=${encodeURIComponent(q)}`)} icon={Activity}>
                    Events from IP “{q}”
                  </Item>
                </Command.Group>
              )}
              <Command.Group heading="Pages">
                {pages.map(([label, href, Icon]) => (
                  <Item key={href} value={`page ${label}`} onSelect={() => go(href)} icon={Icon}>
                    {label}
                  </Item>
                ))}
              </Command.Group>
              {projects.length > 1 && (
                <Command.Group heading="Switch project">
                  {projects
                    .filter((p) => p.id !== project.id)
                    .map((p) => (
                      <Item key={p.id} value={`project ${p.name}`} onSelect={() => go(`/projects/${p.id}`)} icon={ShieldAlert}>
                        {p.name}
                      </Item>
                    ))}
                </Command.Group>
              )}
              <Command.Group heading="Preferences">
                <Item value="theme light" onSelect={() => { setChoice('light'); onOpenChange(false); }} icon={Sun}>
                  Light theme
                </Item>
                <Item value="theme dark" onSelect={() => { setChoice('dark'); onOpenChange(false); }} icon={Moon}>
                  Dark theme
                </Item>
              </Command.Group>
            </Command.List>
          </Command>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

function Item({ icon: Icon, children, ...props }: { icon: LucideIcon; children: ReactNode; value: string; onSelect: () => void; forceMount?: boolean }) {
  return (
    <Command.Item {...props} className="flex cursor-pointer items-center gap-3 rounded-lg px-3 py-2.5 text-[13px] text-ink data-[selected=true]:bg-surface-3">
      <Icon className="size-4 text-ink-3" />
      <span className="flex-1">{children}</span>
      <CornerDownLeft className="size-3.5 text-ink-3 opacity-0 [[data-selected=true]_&]:opacity-100" />
    </Command.Item>
  );
}

/** Opens the palette on Cmd/Ctrl+K and `/`. */
export function usePaletteShortcut(setOpen: (fn: (o: boolean) => boolean) => void): void {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const target = e.target as HTMLElement | null;
      const typing = target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable);
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setOpen((o) => !o);
      } else if (e.key === '/' && !typing) {
        e.preventDefault();
        setOpen(() => true);
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [setOpen]);
}
