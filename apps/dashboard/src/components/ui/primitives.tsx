'use client';

import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import { AlertTriangle, Check, Copy, Inbox } from 'lucide-react';
import {
  forwardRef,
  useState,
  type ButtonHTMLAttributes,
  type HTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from 'react';
import { cn } from '@/lib/cn';

/* ---------- Button ---------- */

const button = cva(
  'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-[10px] text-[13px] font-medium transition-[background,color,box-shadow,transform] duration-150 disabled:pointer-events-none disabled:opacity-50 active:scale-[0.98] cursor-pointer',
  {
    variants: {
      variant: {
        primary: 'bg-ink text-bg hover:bg-ink/90 shadow-card',
        signal: 'bg-signal text-white hover:brightness-110 shadow-card dark:text-[#04120d]',
        outline: 'border border-line-strong bg-surface text-ink hover:bg-surface-3 shadow-card',
        ghost: 'text-ink-2 hover:bg-surface-3 hover:text-ink',
        danger: 'bg-bad text-white hover:brightness-110 shadow-card',
        'danger-ghost': 'text-bad hover:bg-bad-soft',
      },
      size: { sm: 'h-8 px-3', md: 'h-9 px-3.5', lg: 'h-10 px-5 text-sm', icon: 'h-8 w-8' },
    },
    defaultVariants: { variant: 'outline', size: 'md' },
  },
);

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof button> {
  asChild?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button({ className, variant, size, asChild, ...props }, ref) {
  const Comp = asChild ? Slot : 'button';
  return <Comp ref={ref} className={cn(button({ variant, size }), className)} {...props} />;
});

/* ---------- Card ---------- */

export function Card({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('rounded-2xl border border-line bg-surface', className)} {...props} />;
}

export function CardHeader({ title, description, action, className }: { title: ReactNode; description?: ReactNode; action?: ReactNode; className?: string }) {
  return (
    <div className={cn('flex items-start justify-between gap-4 px-5 pt-5 pb-3', className)}>
      <div className="min-w-0">
        <h3 className="text-sm font-semibold tracking-tight text-ink">{title}</h3>
        {description && <p className="mt-0.5 text-[12.5px] leading-snug text-ink-3">{description}</p>}
      </div>
      {action}
    </div>
  );
}

/* ---------- Badge ---------- */

const badge = cva('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium leading-4 whitespace-nowrap', {
  variants: {
    tone: {
      neutral: 'bg-surface-3 text-ink-2',
      ok: 'bg-ok-soft text-ok',
      warn: 'bg-warn-soft text-warn',
      bad: 'bg-bad-soft text-bad',
      info: 'bg-info-soft text-info',
      signal: 'bg-signal-soft text-signal-ink',
      outline: 'border border-line-strong text-ink-2',
    },
  },
  defaultVariants: { tone: 'neutral' },
});

export function Badge({ tone, className, ...props }: HTMLAttributes<HTMLSpanElement> & VariantProps<typeof badge>) {
  return <span className={cn(badge({ tone }), className)} {...props} />;
}

/* ---------- Form controls ---------- */

const field =
  'w-full rounded-[10px] border border-line-strong bg-surface px-3 text-[13px] text-ink shadow-card placeholder:text-ink-3 transition-shadow focus:border-signal focus:outline-none focus:ring-2 focus:ring-signal/25 disabled:opacity-60';

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function Input({ className, ...props }, ref) {
  return <input ref={ref} className={cn(field, 'h-9', className)} {...props} />;
});

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(function Textarea({ className, ...props }, ref) {
  return <textarea ref={ref} className={cn(field, 'min-h-20 py-2 leading-5', className)} {...props} />;
});

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(function Select({ className, children, ...props }, ref) {
  return (
    <select ref={ref} className={cn(field, 'h-9 cursor-pointer appearance-none bg-no-repeat pr-8', className)} style={{ backgroundImage: 'url("data:image/svg+xml,%3Csvg xmlns=%27http://www.w3.org/2000/svg%27 width=%2712%27 height=%2712%27 viewBox=%270 0 24 24%27 fill=%27none%27 stroke=%27%23868b94%27 stroke-width=%272.5%27 stroke-linecap=%27round%27 stroke-linejoin=%27round%27%3E%3Cpath d=%27m6 9 6 6 6-6%27/%3E%3C/svg%3E")', backgroundPosition: 'right 10px center' }} {...props}>
      {children}
    </select>
  );
});

export function Field({ label, hint, children, className }: { label: string; hint?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <label className={cn('grid gap-1.5', className)}>
      <span className="text-xs font-medium text-ink-2">{label}</span>
      {children}
      {hint && <span className="text-xs text-ink-3">{hint}</span>}
    </label>
  );
}

/* ---------- Feedback ---------- */

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn('skeleton', className)} />;
}

export function ErrorBanner({ message }: { message: string | null | undefined }) {
  if (!message) return null;
  return (
    <div role="alert" className="flex items-start gap-2.5 rounded-xl border border-bad/30 bg-bad-soft px-3.5 py-2.5 text-[13px] text-bad">
      <AlertTriangle className="mt-0.5 size-4 shrink-0" />
      <span>{message}</span>
    </div>
  );
}

export function EmptyState({ title, description, action, icon }: { title: string; description?: ReactNode; action?: ReactNode; icon?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-6 py-14 text-center">
      <div className="grid size-11 place-items-center rounded-full bg-surface-3 text-ink-3">{icon ?? <Inbox className="size-5" />}</div>
      <p className="text-sm font-medium text-ink">{title}</p>
      {description && <p className="max-w-sm text-[13px] text-ink-3">{description}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}

export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="inline-flex h-5 min-w-5 items-center justify-center rounded-md border border-line-strong bg-surface-2 px-1 font-mono text-[10px] text-ink-3">{children}</kbd>;
}

/* ---------- Copy ---------- */

export function CopyButton({ value, label, className }: { value: string; label?: string; className?: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      aria-label={label ?? 'Copy'}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setDone(true);
          setTimeout(() => setDone(false), 1400);
        } catch {
          /* clipboard blocked */
        }
      }}
      className={cn('inline-grid size-6 place-items-center rounded-md text-ink-3 transition-colors hover:bg-surface-3 hover:text-ink', className)}
    >
      {done ? <Check className="size-3.5 text-ok" /> : <Copy className="size-3.5" />}
    </button>
  );
}

/** Identifier in mono with a copy button. */
export function Id({ value, short, className }: { value: string; short?: number; className?: string }) {
  return (
    <span className={cn('inline-flex items-center gap-1 font-mono text-xs text-ink-2', className)}>
      <span title={value}>{short && value.length > short ? `${value.slice(0, short)}…` : value}</span>
      <CopyButton value={value} />
    </span>
  );
}

/* ---------- Layout ---------- */

export function PageHeader({ title, description, actions, back }: { title: ReactNode; description?: ReactNode; actions?: ReactNode; back?: ReactNode }) {
  return (
    <div className="mb-6">
      {back && <div className="mb-2">{back}</div>}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-[22px] font-semibold tracking-tight text-ink">{title}</h1>
          {description && <p className="mt-1 max-w-2xl text-[13px] text-ink-3">{description}</p>}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
    </div>
  );
}

/** Pill toggle group (single select). */
export function Segmented<T extends string | number>({ value, onChange, options, className }: { value: T; onChange: (v: T) => void; options: { value: T; label: ReactNode }[]; className?: string }) {
  return (
    <div role="radiogroup" className={cn('inline-flex rounded-[10px] border border-line-strong bg-surface-2 p-0.5', className)}>
      {options.map((o) => (
        <button
          key={String(o.value)}
          type="button"
          role="radio"
          aria-checked={o.value === value}
          onClick={() => onChange(o.value)}
          className={cn(
            'h-7 cursor-pointer rounded-lg px-3 text-xs font-medium transition-colors',
            o.value === value ? 'bg-surface text-ink shadow-card' : 'text-ink-3 hover:text-ink',
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/* ---------- Table ---------- */

export function Table({ className, ...props }: HTMLAttributes<HTMLTableElement>) {
  return (
    <div className="w-full overflow-x-auto">
      <table className={cn('w-full border-collapse text-[13px]', className)} {...props} />
    </div>
  );
}
export function Th({ className, ...props }: HTMLAttributes<HTMLTableCellElement>) {
  return <th className={cn('whitespace-nowrap border-b border-line bg-surface-2 px-4 py-2.5 text-left text-[11px] font-medium uppercase tracking-wide text-ink-3 first:rounded-tl-[13px] last:rounded-tr-[13px]', className)} {...props} />;
}
export function Td({ className, ...props }: HTMLAttributes<HTMLTableCellElement>) {
  return <td className={cn('border-b border-line px-4 py-3 align-middle', className)} {...props} />;
}
export function Tr({ className, interactive, ...props }: HTMLAttributes<HTMLTableRowElement> & { interactive?: boolean }) {
  return <tr className={cn('last:[&>td]:border-b-0', interactive && 'cursor-pointer transition-colors hover:bg-surface-2', className)} {...props} />;
}

export function Spinner({ className }: { className?: string }) {
  return <span className={cn('inline-block size-4 animate-spin rounded-full border-2 border-line-strong border-t-signal', className)} aria-label="Loading" />;
}
