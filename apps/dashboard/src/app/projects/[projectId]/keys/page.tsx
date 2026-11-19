'use client';

import type { ApiKeyResponse } from '@trace-id/signals/api';
import { Globe, KeyRound, Lock, Pencil, Plus, ShieldOff, TriangleAlert } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { Badge, Button, Card, CopyButton, EmptyState, ErrorBanner, Field, Input, PageHeader, Select, Skeleton, Table, Td, Textarea, Th, Tr } from '@/components/ui/primitives';
import { Dialog, DialogClose, DialogContent, DialogTrigger } from '@/components/ui/overlay';
import { api, errorMessage } from '@/lib/api';
import { formatDate } from '@/lib/format';
import { useProject } from '@/lib/project-context';
import { useApi } from '@/lib/use-api';

function parseOrigins(text: string): string[] {
  return text.split(/[\s,]+/).map((o) => o.trim()).filter(Boolean);
}

function SecretOnce({ k, onDone }: { k: ApiKeyResponse; onDone: () => void }) {
  return (
    <Card className="mb-4 border-signal/40 bg-signal-soft p-5">
      <p className="text-[13px] font-semibold text-signal-ink">Your new {k.type} key</p>
      <p className="mt-0.5 text-[13px] text-signal-ink/80">Copy it now. For security it is shown only once{k.type === 'secret' ? ' and must stay on your server' : ''}.</p>
      <div className="mt-3 flex items-center gap-2 rounded-xl border border-signal/30 bg-surface px-3 py-2">
        <code className="min-w-0 flex-1 break-all font-mono text-xs">{k.key}</code>
        <CopyButton value={k.key ?? ''} />
      </div>
      <Button size="sm" variant="outline" className="mt-3" onClick={onDone}>I have saved it</Button>
    </Card>
  );
}

function EditOrigins({ k, onSaved }: { k: ApiKeyResponse; onSaved: () => void }) {
  const { project } = useProject();
  const [text, setText] = useState(k.allowedOrigins.join('\n'));
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild><Button size="icon" variant="ghost" aria-label="Edit allowed origins"><Pencil className="size-3.5" /></Button></DialogTrigger>
      <DialogContent title="Allowed origins" description="Browser calls with this key only work from these origins. Use app:com.example.app for a mobile app and https://*.example.com for subdomains.">
        <Textarea rows={5} value={text} onChange={(e) => setText(e.target.value)} className="font-mono text-xs" />
        <div className="mt-3"><ErrorBanner message={error} /></div>
        <div className="mt-4 flex justify-end gap-2">
          <DialogClose asChild><Button variant="outline">Cancel</Button></DialogClose>
          <Button
            variant="primary"
            onClick={async () => {
              try {
                await api(`/v1/projects/${project.id}/keys/${k.id}`, { method: 'PATCH', body: { allowedOrigins: parseOrigins(text) } });
                setOpen(false);
                onSaved();
              } catch (e) {
                setError(errorMessage(e));
              }
            }}
          >
            Save origins
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function CreateKey({ onCreated }: { onCreated: (k: ApiKeyResponse) => void }) {
  const { project } = useProject();
  const [open, setOpen] = useState(false);
  const [type, setType] = useState<'public' | 'secret'>('public');
  const [name, setName] = useState('');
  const [origins, setOrigins] = useState('');
  const [error, setError] = useState<string | null>(null);

  async function create(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      const body = type === 'public' ? { type, name: name || undefined, allowedOrigins: parseOrigins(origins) } : { type, name: name || undefined };
      const k = await api<ApiKeyResponse>(`/v1/projects/${project.id}/keys`, { method: 'POST', body });
      setName('');
      setOrigins('');
      setOpen(false);
      onCreated(k);
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild><Button variant="primary"><Plus className="size-3.5" /> Create key</Button></DialogTrigger>
      <DialogContent title="Create an API key" description="Public keys go in your site or app. Secret keys stay on your server.">
        <form onSubmit={create} className="grid gap-4">
          <Field label="Type">
            <Select value={type} onChange={(e) => setType(e.target.value as 'public' | 'secret')}>
              <option value="public">Public (pk_), for browsers and apps</option>
              <option value="secret">Secret (sk_), for your server</option>
            </Select>
          </Field>
          <Field label="Name" hint="Optional. Helps you tell keys apart.">
            <Input value={name} maxLength={200} onChange={(e) => setName(e.target.value)} placeholder="Production site" />
          </Field>
          {type === 'public' && (
            <Field label="Allowed origins" hint="One per line or comma separated. Mobile apps use app:<bundle id>.">
              <Textarea rows={3} value={origins} onChange={(e) => setOrigins(e.target.value)} placeholder="https://app.example.com&#10;https://*.example.com" className="font-mono text-xs" />
            </Field>
          )}
          <ErrorBanner message={error} />
          <div className="flex justify-end gap-2">
            <DialogClose asChild><Button type="button" variant="outline">Cancel</Button></DialogClose>
            <Button type="submit" variant="primary">Create key</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export default function KeysPage() {
  const { project, canEdit } = useProject();
  const keys = useApi<{ keys: ApiKeyResponse[] }>(`/v1/projects/${project.id}/keys`);
  const [created, setCreated] = useState<ApiKeyResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<string | null>(null);

  async function revoke(id: string) {
    try {
      await api(`/v1/projects/${project.id}/keys/${id}/revoke`, { method: 'POST' });
      setConfirm(null);
      keys.reload();
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  const list = keys.data?.keys ?? [];
  return (
    <>
      <PageHeader title="API keys" description="Public keys (pk_) identify visitors from your site or app. Secret keys (sk_) let your server verify events and read data." actions={canEdit && <CreateKey onCreated={(k) => { setCreated(k); keys.reload(); }} />} />
      <ErrorBanner message={error ?? keys.error} />
      {created?.key && <SecretOnce k={created} onDone={() => setCreated(null)} />}
      {list.some((k) => k.type === 'public' && !k.revokedAt && k.allowedOrigins.length === 0) && (
        <div className="mb-4 flex items-start gap-3 rounded-xl border border-warn/30 bg-warn-soft px-4 py-3 text-[13px] text-warn">
          <TriangleAlert className="mt-0.5 size-4 shrink-0" />
          <span>A public key has no allowed origins, so browsers are refused. Use the pencil next to it to add your site, for example <code className="font-mono text-xs">https://www.example.com</code>.</span>
        </div>
      )}
      <Card className="overflow-hidden">
        {!keys.data ? (
          <Skeleton className="m-5 h-32" />
        ) : list.length === 0 ? (
          <EmptyState icon={<KeyRound className="size-5" />} title="No keys yet" description="Create a public key for your site and a secret key for your server." />
        ) : (
          <Table>
            <thead><tr><Th>Key</Th><Th>Type</Th><Th>Allowed origins</Th><Th>Created</Th><Th /></tr></thead>
            <tbody>
              {list.map((k) => (
                <Tr key={k.id} className={k.revokedAt ? 'opacity-50' : undefined}>
                  <Td>
                    <div className="flex items-center gap-2.5">
                      <span className={`grid size-8 place-items-center rounded-lg ${k.type === 'secret' ? 'bg-warn-soft text-warn' : 'bg-signal-soft text-signal-ink'}`}>{k.type === 'secret' ? <Lock className="size-4" /> : <Globe className="size-4" />}</span>
                      <div>
                        <div className="font-mono text-xs text-ink">{k.prefix}…</div>
                        <div className="text-xs text-ink-3">{k.name ?? 'Unnamed'}</div>
                      </div>
                    </div>
                  </Td>
                  <Td><Badge tone={k.type === 'secret' ? 'warn' : 'signal'}>{k.type}</Badge></Td>
                  <Td className="max-w-xs">
                    {k.type === 'public' ? (
                      <div className="flex items-center gap-1">
                        <span className="truncate text-xs text-ink-2">{k.allowedOrigins.length ? k.allowedOrigins.join(', ') : <span className="text-ink-3">None, browser calls are refused</span>}</span>
                        {canEdit && !k.revokedAt && <EditOrigins k={k} onSaved={keys.reload} />}
                      </div>
                    ) : <span className="text-ink-3">Server only</span>}
                  </Td>
                  <Td className="text-ink-2">{formatDate(k.createdAt)}</Td>
                  <Td className="text-right">
                    {k.revokedAt ? <Badge tone="bad">Revoked</Badge> : canEdit && (
                      confirm === k.id ? (
                        <span className="inline-flex gap-1"><Button size="sm" variant="danger" onClick={() => revoke(k.id)}>Revoke now</Button><Button size="sm" variant="ghost" onClick={() => setConfirm(null)}>Cancel</Button></span>
                      ) : (
                        <Button size="sm" variant="danger-ghost" onClick={() => setConfirm(k.id)}><ShieldOff className="size-3.5" /> Revoke</Button>
                      )
                    )}
                  </Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
      <div className="mt-5 grid gap-4 md:grid-cols-2">
        <Card className="p-5">
          <div className="flex items-center gap-2.5"><span className="grid size-8 place-items-center rounded-lg bg-signal-soft text-signal-ink"><Globe className="size-4" /></span><h3 className="text-sm font-semibold">Public key (pk_)</h3></div>
          <p className="mt-3 text-[13px] leading-relaxed text-ink-3">Goes in your site or mobile app. It can only identify visitors, and only from the origins you allow, so it is safe to ship. For apps, allow <code className="font-mono text-xs">app:your.bundle.id</code>.</p>
        </Card>
        <Card className="p-5">
          <div className="flex items-center gap-2.5"><span className="grid size-8 place-items-center rounded-lg bg-warn-soft text-warn"><Lock className="size-4" /></span><h3 className="text-sm font-semibold">Secret key (sk_)</h3></div>
          <p className="mt-3 text-[13px] leading-relaxed text-ink-3">Stays on your server. It reads event results to verify them and must never reach a browser or app. Rotate it by creating a new one and revoking the old.</p>
        </Card>
      </div>
    </>
  );
}
