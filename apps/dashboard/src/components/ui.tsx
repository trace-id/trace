'use client';

import { useState, type ReactNode } from 'react';
import { scoreTone } from '@/lib/format';

export function ScoreBadge({ score }: { score: number }) {
  return <span className={`badge ${scoreTone(score)}`}>{score}</span>;
}

export function Badge({ children, tone = 'neutral' }: { children: ReactNode; tone?: 'ok' | 'warn' | 'bad' | 'neutral' }) {
  return <span className={`badge ${tone}`}>{children}</span>;
}

export function ErrorBox({ message }: { message: string | null }) {
  return message ? (
    <div className="error" role="alert">
      {message}
    </div>
  ) : null;
}

export function Loading() {
  return <p className="muted">Loading…</p>;
}

/** Two-step confirmation instead of a blocking browser dialog. */
export function ConfirmButton({
  label,
  confirmLabel,
  onConfirm,
  disabled,
}: {
  label: string;
  confirmLabel: string;
  onConfirm: () => Promise<void> | void;
  disabled?: boolean;
}) {
  const [armed, setArmed] = useState(false);
  const [busy, setBusy] = useState(false);
  if (!armed) {
    return (
      <button className="danger" disabled={disabled} onClick={() => setArmed(true)}>
        {label}
      </button>
    );
  }
  return (
    <span className="row">
      <button
        className="danger"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          try {
            await onConfirm();
          } finally {
            setBusy(false);
            setArmed(false);
          }
        }}
      >
        {confirmLabel}
      </button>
      <button onClick={() => setArmed(false)} disabled={busy}>
        Cancel
      </button>
    </span>
  );
}

/** Shows a key or secret exactly once, with copy. */
export function SecretOnce({ title, value, onDone }: { title: string; value: string; onDone: () => void }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="notice">
      <strong>{title}</strong>
      <p className="small">Copy it now. It is stored only as a hash (or encrypted) and will not be shown again.</p>
      <pre>{value}</pre>
      <div className="row">
        <button
          onClick={async () => {
            await navigator.clipboard.writeText(value);
            setCopied(true);
          }}
        >
          {copied ? 'Copied' : 'Copy'}
        </button>
        <button onClick={onDone}>I stored it</button>
      </div>
    </div>
  );
}
