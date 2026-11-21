'use client';

import { Ban, ShieldCheck } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/primitives';
import { useToast } from '@/components/ui/toast';
import { api, errorMessage } from '@/lib/api';
import type { ListKind } from '@/lib/manage-types';
import { useProject } from '@/lib/project-context';

export const KIND_LABEL: Record<ListKind, string> = { ip: 'IP address', cidr: 'IP range', visitor: 'Visitor', device: 'Device', linked: 'Linked id' };

/** One-click add to the block or allow list from an event or visitor page. Admins only; renders nothing for viewers. */
export function QuickList({ kind, value, label }: { kind: ListKind; value: string; label?: string }) {
  const { project, canEdit } = useProject();
  const toast = useToast();
  const [busy, setBusy] = useState<'allow' | 'block' | null>(null);
  if (!canEdit || !value) return null;

  async function add(action: 'allow' | 'block') {
    setBusy(action);
    try {
      await api(`/v1/projects/${project.id}/lists`, { method: 'POST', body: { kind, value, action } });
      toast({ tone: 'ok', title: `${KIND_LABEL[kind]} ${action === 'block' ? 'blocked' : 'allowed'}`, description: `${value}. New events from it score ${action === 'block' ? '100' : '0'}.` });
    } catch (err) {
      toast({ tone: 'error', title: 'Could not update the list', description: errorMessage(err) });
    } finally {
      setBusy(null);
    }
  }

  return (
    <span className="inline-flex items-center gap-1">
      {label && <span className="mr-1 text-xs text-ink-3">{label}</span>}
      <Button size="sm" variant="outline" disabled={busy !== null} onClick={() => void add('block')} title={`Always score ${KIND_LABEL[kind].toLowerCase()} ${value} as 100`}><Ban className="size-3.5" /> Block</Button>
      <Button size="sm" variant="outline" disabled={busy !== null} onClick={() => void add('allow')} title={`Always score ${KIND_LABEL[kind].toLowerCase()} ${value} as 0`}><ShieldCheck className="size-3.5" /> Allow</Button>
    </span>
  );
}
